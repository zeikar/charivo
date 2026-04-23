import { subscribeBrowserLifecycle } from "@charivo/core";
import { acquireMicrophoneStream } from "./microphone";

export const DEFAULT_ICE_DISCONNECTED_DEBOUNCE_MS = 1_000;

export interface TransportLifecycleCallbacks {
  onHidden?(): void;
  onOnline?(): void;
  onPageHide?(): void;
  onPageShow?(event: PageTransitionEvent): void;
  onVisible?(): void;
  onDeviceChange?(): void;
}

export function bindTransportLifecycle(
  callbacks: TransportLifecycleCallbacks,
): () => void {
  const teardownBrowserLifecycle = subscribeBrowserLifecycle({
    onHidden: callbacks.onHidden,
    onOnline: callbacks.onOnline,
    onPageHide: callbacks.onPageHide,
    onPageShow: callbacks.onPageShow,
    onVisible: callbacks.onVisible,
  });

  if (callbacks.onDeviceChange) {
    navigator.mediaDevices?.addEventListener?.(
      "devicechange",
      callbacks.onDeviceChange,
    );
  }

  return () => {
    teardownBrowserLifecycle();
    if (callbacks.onDeviceChange) {
      navigator.mediaDevices?.removeEventListener?.(
        "devicechange",
        callbacks.onDeviceChange,
      );
    }
  };
}

export interface AudioSenderTrackState {
  audioSender: RTCRtpSender | null;
  mediaStream: MediaStream | null;
  peerConnection: RTCPeerConnection | null;
}

export async function replaceMicrophoneTrack(
  state: AudioSenderTrackState,
): Promise<{ audioSender: RTCRtpSender; mediaStream: MediaStream }> {
  if (!state.peerConnection) {
    throw new Error("Realtime transport not active");
  }

  const nextStream = await acquireMicrophoneStream();
  const nextTrack = nextStream.getAudioTracks()[0];
  if (!nextTrack) {
    throw new Error("Microphone access required for Realtime API");
  }

  const sender =
    state.audioSender ??
    (typeof state.peerConnection.getSenders === "function"
      ? (state.peerConnection
          .getSenders()
          .find((candidate) => candidate.track?.kind === "audio") ?? null)
      : null);
  if (!sender) {
    throw new Error("No outbound audio sender available");
  }

  await sender.replaceTrack(nextTrack);
  state.mediaStream?.getTracks().forEach((track) => track.stop());

  return {
    audioSender: sender,
    mediaStream: nextStream,
  };
}

export function createIceDisconnectDebouncer(
  onDisconnect: () => void,
  delayMs = DEFAULT_ICE_DISCONNECTED_DEBOUNCE_MS,
): {
  schedule(): void;
  cancel(): void;
} {
  let pending: ReturnType<typeof setTimeout> | null = null;

  return {
    schedule() {
      if (pending) {
        return;
      }

      pending = setTimeout(() => {
        pending = null;
        onDisconnect();
      }, delayMs);
    },
    cancel() {
      if (!pending) {
        return;
      }

      clearTimeout(pending);
      pending = null;
    },
  };
}
