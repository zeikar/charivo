"use client";

// Immersive intro / greeting gate. Not a form on a card — a dim room you step
// into. The real character (dormant, dimmed) glows softly to one side behind a
// single warm prompt; you give your name to wake her. This renders only the
// copy/form — the live avatar is the page’s shared CharacterPresence layer
// behind it, so she is already present (dim) before she wakes.

import type { CompanionCharacter } from "../lib/character-catalog";
import { MAX_USER_NAME_LENGTH, sanitizeUserName } from "../lib/user-name-store";

export function IntroScreen({
  name,
  nameInput,
  onNameInput,
  onMeet,
  character,
  onPrevCharacter,
  onNextCharacter,
}: {
  name: string | null;
  nameInput: string;
  onNameInput: (v: string) => void;
  onMeet: () => void;
  character: CompanionCharacter;
  onPrevCharacter: () => void;
  onNextCharacter: () => void;
}) {
  const returning = !!name;
  const canMeet = sanitizeUserName(nameInput) !== "";

  return (
    <div className="intro">
      <div className="intro-picker">
        <button
          type="button"
          className="intro-arrow intro-arrow-left"
          aria-label="Previous character"
          onClick={onPrevCharacter}
        >
          &#8249;
        </button>

        <div className="intro-pick-card">
          <p className="intro-pick-eyebrow">choose who&rsquo;s waiting</p>
          <p className="intro-pick-name">{character.name}</p>
          <p className="intro-pick-desc">{character.description}</p>
        </div>

        <button
          type="button"
          className="intro-arrow intro-arrow-right"
          aria-label="Next character"
          onClick={onNextCharacter}
        >
          &#8250;
        </button>
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
