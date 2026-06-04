"use client";

import { useEffect, useRef } from "react";
import type { GazeCoordinates } from "@charivo/core";
// Type-only import: erased at build time, so it does NOT pull MediaPipe into
// the initial bundle. The single value-level load is the dynamic import inside
// loadFaceDetector().
import type { FaceDetector } from "@mediapipe/tasks-vision";
import { boundingBoxToGaze, createGazeSmoother } from "../lib/face-gaze";

// One-time third-party asset fetches. These are the ONLY bytes that cross the
// network for the gaze feature: the WASM runtime and the model weights. Video
// frames never leave the device — getUserMedia frames are read straight into
// the in-page detector. Self-hosting these under public/ (so nothing hits a
// third-party CDN) is the production follow-up.
const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

// ~15fps detection throttle. Detection runs on rAF but only fires the model
// when at least this many ms have elapsed.
const DETECT_INTERVAL_MS = 66;
// How long detection must stay empty before onFaceLost() fires once.
const FACE_LOST_GRACE_MS = 500;
// Upper bound on waiting for the hidden <video> to report its dimensions.
const METADATA_TIMEOUT_MS = 5000;

// Dynamic import keeps MediaPipe out of the initial bundle: the value-level
// module only loads when the camera is enabled.
async function loadFaceDetector(): Promise<FaceDetector> {
  const mediapipe = await import("@mediapipe/tasks-vision");
  const { FilesetResolver, FaceDetector } = mediapipe;
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
  return FaceDetector.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
    runningMode: "VIDEO",
  });
}

// idle: not running. starting: camera/model coming up. live: detecting.
// denied: permission blocked. unavailable: no camera device. error: anything
// else. denied vs. unavailable are DISTINCT so the UI can show the right hint.
export type GazeStatus =
  | "idle"
  | "starting"
  | "live"
  | "denied"
  | "unavailable"
  | "error";

export interface UseFaceGazeOptions {
  enabled: boolean;
  onGaze: (coords: GazeCoordinates) => void;
  onFaceLost: () => void;
  onStatus: (status: GazeStatus) => void;
}

// Classify a getUserMedia rejection by its DOMException .name. NotAllowed /
// Security mean the user (or policy) blocked the camera; NotFound /
// Overconstrained / DevicesNotFound mean there is no usable device.
function classifyGetUserMediaError(error: unknown): GazeStatus {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name: unknown }).name)
      : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (
    name === "NotFoundError" ||
    name === "OverconstrainedError" ||
    name === "DevicesNotFoundError"
  ) {
    return "unavailable";
  }
  return "error";
}

/**
 * Browser-only webcam face-gaze hook. Owns the camera lifecycle, a hidden
 * <video>, a throttled MediaPipe detection loop, and emits smoothed gaze
 * samples through callbacks. It is a peer to mouse-tracking and has NO renderer
 * coupling — the caller decides what to do with each sample.
 *
 * The effect depends ONLY on `enabled`; callbacks are read through refs so a
 * parent passing fresh closures never restarts the camera.
 */
export function useFaceGaze({
  enabled,
  onGaze,
  onFaceLost,
  onStatus,
}: UseFaceGazeOptions): void {
  // Keep callbacks in refs so the effect does not re-run on new closures.
  const onGazeRef = useRef(onGaze);
  const onFaceLostRef = useRef(onFaceLost);
  const onStatusRef = useRef(onStatus);
  onGazeRef.current = onGaze;
  onFaceLostRef.current = onFaceLost;
  onStatusRef.current = onStatus;

  useEffect(() => {
    if (!enabled) return;

    // Effect-scoped: a fresh effect run (re-enable) starts with disposed=false.
    let disposed = false;
    // Set once a terminal status (denied/unavailable/error) is emitted so the
    // cleanup never stomps it with a trailing "idle".
    let terminal = false;

    // Survive the async gaps within this one effect run.
    const detectorRef = { current: null as FaceDetector | null };
    const streamRef = { current: null as MediaStream | null };
    const videoRef = { current: null as HTMLVideoElement | null };
    const rafRef = { current: 0 };
    const metadataTimeoutRef = { current: 0 };
    const metadataListenerRef = { current: null as (() => void) | null };
    const lastDetectRef = { current: 0 };
    const faceLostAtRef = { current: 0 };
    // Latches so onFaceLost() fires once per loss, not every empty frame.
    const faceLostFiredRef = { current: false };

    // STATUS-FREE, idempotent teardown. Both the normal-disable path and every
    // failure path call it. Sets `disposed` so any in-flight async bails, then
    // releases timers, listeners, rAF, the detector, camera tracks, and the
    // hidden <video> source.
    const releaseResources = () => {
      disposed = true;
      if (metadataTimeoutRef.current) {
        clearTimeout(metadataTimeoutRef.current);
        metadataTimeoutRef.current = 0;
      }
      if (metadataListenerRef.current && videoRef.current) {
        videoRef.current.removeEventListener(
          "loadedmetadata",
          metadataListenerRef.current,
        );
      }
      metadataListenerRef.current = null;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      detectorRef.current?.close();
      detectorRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current = null;
      }
    };

    // Mark a startup failure: set the terminal status FIRST (so the cleanup's
    // "idle" guard sees `terminal` and leaves it standing), then release.
    const failWith = (status: GazeStatus) => {
      terminal = true;
      onStatusRef.current(status);
      releaseResources();
    };

    // The throttled detection loop. Runs on rAF but only invokes the model once
    // per DETECT_INTERVAL_MS. A present box maps -> smoother -> onGaze and
    // resets the face-lost grace; an absent box starts/continues the countdown
    // and fires onFaceLost() exactly once when it expires.
    const smooth = createGazeSmoother();
    const tick = () => {
      if (disposed) return;
      const video = videoRef.current;
      const detector = detectorRef.current;
      const now = performance.now();
      if (
        video &&
        detector &&
        video.videoWidth > 0 &&
        now - lastDetectRef.current >= DETECT_INTERVAL_MS
      ) {
        lastDetectRef.current = now;
        const result = detector.detectForVideo(video, now);
        const box = result.detections[0]?.boundingBox;
        if (box) {
          faceLostAtRef.current = 0;
          faceLostFiredRef.current = false;
          onGazeRef.current(
            smooth(boundingBoxToGaze(box, video.videoWidth, video.videoHeight)),
          );
        } else {
          if (faceLostAtRef.current === 0) faceLostAtRef.current = now;
          if (
            !faceLostFiredRef.current &&
            now - faceLostAtRef.current >= FACE_LOST_GRACE_MS
          ) {
            faceLostFiredRef.current = true;
            onFaceLostRef.current();
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    void (async () => {
      onStatusRef.current("starting");

      let stream: MediaStream;
      try {
        // The stream stays local — frames are read by the in-page detector and
        // never uploaded.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 320, height: 240 },
          audio: false,
        });
      } catch (error) {
        if (disposed) {
          releaseResources();
          return;
        }
        failWith(classifyGetUserMediaError(error));
        return;
      }

      if (disposed) {
        stream.getTracks().forEach((track) => track.stop());
        releaseResources();
        return;
      }
      streamRef.current = stream;

      // Hidden <video>: created in-memory, never inserted into the DOM tree.
      const video = document.createElement("video");
      video.playsInline = true;
      video.muted = true;
      video.srcObject = stream;
      videoRef.current = video;

      try {
        await video.play();
      } catch {
        if (disposed) {
          releaseResources();
          return;
        }
        failWith("error");
        return;
      }
      if (disposed) {
        releaseResources();
        return;
      }

      // Wait for the video to report real dimensions before detecting, bounded
      // by METADATA_TIMEOUT_MS. Both the listener and the timeout id are tracked
      // so releaseResources() can tear them down.
      const dimensionsReady = await new Promise<boolean>((resolve) => {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          resolve(true);
          return;
        }
        const onLoaded = () => {
          if (disposed) return;
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            metadataListenerRef.current = null;
            video.removeEventListener("loadedmetadata", onLoaded);
            if (metadataTimeoutRef.current) {
              clearTimeout(metadataTimeoutRef.current);
              metadataTimeoutRef.current = 0;
            }
            resolve(true);
          }
        };
        metadataListenerRef.current = onLoaded;
        video.addEventListener("loadedmetadata", onLoaded);
        metadataTimeoutRef.current = window.setTimeout(() => {
          // Guard: a teardown may have fired between scheduling and now.
          if (disposed) return;
          metadataTimeoutRef.current = 0;
          resolve(false);
        }, METADATA_TIMEOUT_MS);
      });

      if (disposed) {
        releaseResources();
        return;
      }
      if (!dimensionsReady) {
        // Dimensions never arrived within the bound — startup failure.
        failWith("error");
        return;
      }

      onStatusRef.current("live");

      // Load the detector once per enable, AFTER the camera is live.
      let detector: FaceDetector;
      try {
        detector = await loadFaceDetector();
      } catch {
        if (disposed) {
          releaseResources();
          return;
        }
        failWith("error");
        return;
      }
      if (disposed) {
        // Toggled off mid-load: release the just-built detector + camera only.
        detector.close();
        releaseResources();
        return;
      }
      detectorRef.current = detector;

      rafRef.current = requestAnimationFrame(tick);
    })();

    return () => {
      // Normal teardown: release resources, then return to idle — but only if no
      // terminal status was emitted (the `terminal` guard keeps denied /
      // unavailable / error standing so the UI hint survives).
      releaseResources();
      if (!terminal) onStatusRef.current("idle");
    };
  }, [enabled]);
}
