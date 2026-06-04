"use client";

// Settings panel. Slides in from the right as a frosted sheet. Only what the
// user asked for: change name, manage memory, plus the caption toggle + session
// control. Memory rows come from the real client store via memory-facts; the
// adapter lets errors propagate, so every store call here is wrapped in
// try/catch + console.warn.

import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { sanitizeUserName } from "../lib/user-name-store";
import {
  addFact,
  deleteFact,
  listFacts,
  type MemoryFactView,
} from "../lib/memory-facts";
import { makeMemoryScope } from "../lib/memory-scope";
import { type GazeStatus } from "../hooks/useFaceGaze";

type Status = "dormant" | "connecting" | "connected";

export function SettingsPanel({
  open,
  onClose,
  name,
  onRename,
  onChangeName,
  captions,
  onCaptions,
  gazeTracking,
  onGazeTracking,
  gazeStatus,
  status,
  onDisconnect,
  onReconnect,
  characterId,
}: {
  open: boolean;
  onClose: () => void;
  name: string | null;
  onRename: (next: string) => void;
  onChangeName: () => void;
  captions: boolean;
  onCaptions: (v: boolean) => void;
  gazeTracking: boolean;
  onGazeTracking: (v: boolean) => void;
  gazeStatus: GazeStatus;
  status: Status;
  onDisconnect: () => void;
  onReconnect: () => void;
  characterId: string;
}) {
  const [tab, setTab] = useState<"you" | "mem">("you");
  const [draft, setDraft] = useState(name ?? "");
  const [adding, setAdding] = useState("");
  const [mem, setMem] = useState<MemoryFactView[]>([]);
  const [memLoading, setMemLoading] = useState(false);

  // Keep the rename draft in sync when the page's name changes.
  useEffect(() => {
    setDraft(name ?? "");
  }, [name]);

  // Load memories only when the memory tab is showing on an open sheet.
  useEffect(() => {
    if (!open || tab !== "mem") return;
    let cancelled = false;
    setMemLoading(true);
    (async () => {
      try {
        const facts = await listFacts(makeMemoryScope(characterId));
        if (!cancelled) setMem(facts);
      } catch (error) {
        console.warn("[settings] listFacts failed", error);
      } finally {
        if (!cancelled) setMemLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, tab, characterId]);

  async function refreshMem() {
    try {
      setMem(await listFacts(makeMemoryScope(characterId)));
    } catch (error) {
      console.warn("[settings] listFacts failed", error);
    }
  }

  // In-place Save is a forward rename: she uses it the next time she wakes.
  const cleanDraft = sanitizeUserName(draft);
  function saveName() {
    if (cleanDraft !== "" && cleanDraft !== (name ?? "")) onRename(cleanDraft);
  }

  async function addMem() {
    const text = adding.trim();
    if (text === "") return;
    try {
      await addFact(makeMemoryScope(characterId), text);
      setAdding("");
      await refreshMem();
    } catch (error) {
      console.warn("[settings] addFact failed", error);
    }
  }

  async function removeMem(id: string) {
    try {
      await deleteFact(id);
      await refreshMem();
    } catch (error) {
      console.warn("[settings] deleteFact failed", error);
    }
  }

  return (
    <>
      <div
        className="sheet-scrim"
        style={{
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
        }}
        onClick={onClose}
      />
      <aside
        className="sheet"
        style={{ transform: open ? "translateX(0)" : "translateX(100%)" }}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="sheet-head">
          <h2 className="sheet-title">Settings</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={19} />
          </button>
        </div>

        <div className="sheet-tabs">
          <button
            className={tab === "you" ? "on" : ""}
            onClick={() => setTab("you")}
          >
            You &amp; her
          </button>
          <button
            className={tab === "mem" ? "on" : ""}
            onClick={() => setTab("mem")}
          >
            Memory
          </button>
        </div>

        {tab === "you" && (
          <div className="sheet-body">
            <section className="set-group">
              <label className="set-label">What she calls you</label>
              <div className="set-inline">
                <input
                  className="set-input"
                  value={draft}
                  maxLength={40}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveName()}
                />
                <button
                  className="set-btn"
                  onClick={saveName}
                  disabled={cleanDraft === "" || cleanDraft === (name ?? "")}
                >
                  Save
                </button>
              </div>
              <p className="set-hint">
                She’ll use this name warmly, the way someone close would. She’ll
                use this the next time she wakes.
              </p>
              {/* Full reset back to the intro (clears name); the Save above is
                  only a forward rename for her next wake. */}
              <button
                className="set-btn ghost"
                onClick={onChangeName}
                disabled={status === "connecting"}
                style={{ marginTop: 12 }}
              >
                Start over with a new name
              </button>
            </section>

            <section className="set-group">
              <div className="set-row">
                <div>
                  <label className="set-label">Show captions</label>
                  <p className="set-hint">
                    Quiet subtitles low on screen when she speaks.
                  </p>
                </div>
                <button
                  className={"toggle" + (captions ? " on" : "")}
                  onClick={() => onCaptions(!captions)}
                  aria-label="Toggle captions"
                >
                  <span className="knob" />
                </button>
              </div>
            </section>

            <section className="set-group">
              <div className="set-row">
                <div>
                  <label className="set-label">Let her look back at you</label>
                  <p className="set-hint">
                    Uses your webcam to follow your face. Your video stays on
                    your device and is never uploaded. (Turning this on
                    downloads the face-detection model once.) Off by default.
                  </p>
                  {gazeStatus === "denied" && (
                    <p className="set-hint" style={{ marginTop: 6 }}>
                      Camera permission is blocked - allow it in your browser to
                      use this.
                    </p>
                  )}
                  {gazeStatus === "unavailable" && (
                    <p className="set-hint" style={{ marginTop: 6 }}>
                      No camera was found on this device.
                    </p>
                  )}
                  {gazeStatus === "error" && (
                    <p className="set-hint" style={{ marginTop: 6 }}>
                      Couldn&apos;t start the camera.
                    </p>
                  )}
                </div>
                <button
                  className={"toggle" + (gazeTracking ? " on" : "")}
                  onClick={() => onGazeTracking(!gazeTracking)}
                  aria-label="Toggle face gaze"
                >
                  <span className="knob" />
                </button>
              </div>
            </section>

            <section className="set-group">
              <label className="set-label">Connection</label>
              <p className="set-hint" style={{ marginBottom: 12 }}>
                {status === "connected"
                  ? "She’s here, listening."
                  : status === "connecting"
                    ? "Reaching her…"
                    : "She’s asleep."}
              </p>
              {status === "connected" ? (
                <button className="set-btn ghost wide" onClick={onDisconnect}>
                  Let her rest
                </button>
              ) : (
                <button
                  className="set-btn wide"
                  onClick={onReconnect}
                  disabled={status === "connecting"}
                >
                  {status === "connecting" ? "Waking…" : "Wake her"}
                </button>
              )}
            </section>
          </div>
        )}

        {tab === "mem" && (
          <div className="sheet-body">
            <p className="set-hint" style={{ marginBottom: 14 }}>
              Little things she’s remembered about you. Remove anything she
              should forget.
            </p>
            <div className="mem-add">
              <input
                className="set-input"
                value={adding}
                placeholder="Teach her something new…"
                onChange={(e) => setAdding(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addMem()}
              />
              <button
                className="icon-btn solid"
                onClick={addMem}
                disabled={memLoading}
                aria-label="Add memory"
              >
                <Icon name="plus" size={18} />
              </button>
            </div>
            <ul className="mem-list">
              {memLoading && mem.length === 0 && (
                <li className="mem-empty">loading her memories…</li>
              )}
              {mem.map((m) => (
                <li key={m.id} className="mem-item">
                  <span className="mem-dot" />
                  <span className="mem-text">{m.text}</span>
                  <span className="mem-tag">{m.kind}</span>
                  <button
                    className="mem-del"
                    onClick={() => removeMem(m.id)}
                    aria-label="Forget"
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </li>
              ))}
              {!memLoading && mem.length === 0 && (
                <li className="mem-empty">
                  She’s starting fresh — a clean slate.
                </li>
              )}
            </ul>
          </div>
        )}
      </aside>
    </>
  );
}
