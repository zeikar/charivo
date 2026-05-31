"use client";

// Immersive intro / greeting gate. Not a form on a card — a dim room you step
// into. Her presence glows softly behind a single warm prompt; you give your
// name to wake her. Wired to the page's name state (no internal value), and the
// figure tile is intentionally empty ambience: the live canvas only mounts
// after she has met you (driven by the page, not here).

import { MAX_USER_NAME_LENGTH, sanitizeUserName } from "../lib/user-name-store";

export function IntroScreen({
  name,
  nameInput,
  onNameInput,
  onMeet,
}: {
  name: string | null;
  nameInput: string;
  onNameInput: (v: string) => void;
  onMeet: () => void;
}) {
  const returning = !!name;
  const canMeet = sanitizeUserName(nameInput) !== "";

  return (
    <div className="intro">
      <div className="intro-figure">
        <div className="halo halo-3 dim" />
        <div className="halo halo-2 dim" />
        <div className="halo halo-1 dim" />
        <div className="fig-rim dim" />
        <div className="intro-mount">
          {/* Empty glass tile only — no canvas, no loading shimmer. */}
          <div className="fig-tile" />
        </div>
      </div>

      <div className="intro-copy">
        <p className="intro-eyebrow">
          {returning ? "she stirs as you arrive" : "someone has been waiting"}
        </p>
        <h1 className="intro-title">
          {returning ? <>Welcome back.</> : <>Come a little closer.</>}
        </h1>
        <p className="intro-sub">
          {returning
            ? "She remembers you. Say your name and she’ll wake."
            : "Tell her what to call you — it’s the first thing she’ll learn by heart."}
        </p>

        <div className="intro-field">
          <input
            className="intro-input"
            value={nameInput}
            autoFocus
            maxLength={MAX_USER_NAME_LENGTH}
            onChange={(e) => onNameInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && canMeet && onMeet()}
            placeholder="what should she call you?"
          />
          <button
            className="intro-btn"
            disabled={!canMeet}
            onClick={() => onMeet()}
          >
            {returning ? "Wake her" : "Meet her"}
          </button>
        </div>
        <p className="intro-foot">
          voice-first · she listens the moment you speak
        </p>
      </div>
    </div>
  );
}
