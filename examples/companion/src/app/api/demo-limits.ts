/**
 * Cost boundaries for the public companion demo deployment.
 *
 * `POST /api/realtime` is the only route here, and it is an unauthenticated
 * proxy that mints realtime sessions on a paid OpenAI key. There is no auth, no
 * per-IP quota, and no rate limiting — read the README's "Deploying this demo"
 * section before copying any of it.
 *
 * The defence is shape, not volume: pin every cost-bearing parameter
 * server-side and bound the size of a single request, so a caller cannot
 * repoint the key at an expensive model, raise the output ceiling, or make one
 * request cost meaningful money. Bounding *total* volume is a different problem
 * and is left to a per-project spend limit on the OpenAI side.
 *
 * `instructions` is the deliberate exception: the browser composes them from
 * the persona, the avatar catalog of whichever model finished loading, and the
 * visitor's browser-local memory, so the server cannot rebuild them. They are
 * size-capped, not pinned.
 *
 * Mirrors `examples/web/src/app/api/demo-limits.ts`; the two demos deploy
 * separately, so the constants are duplicated rather than shared.
 */

/**
 * Realtime is billed on wall-clock audio, so session duration — not request
 * count — is what drives its cost.
 */
export const REALTIME_MODEL = "gpt-realtime-2.1-mini";

/**
 * Matches the model the session hook asks for. Pinned here anyway: the route
 * pays for whatever it mints, so it picks.
 */
export const REALTIME_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";

/**
 * Enforced by a client-side timer (see `hooks/session-cap.ts`). After bootstrap
 * the browser talks to OpenAI directly, so the server is out of the loop and
 * cannot hang up — this bounds an ordinary visitor's cost, and a caller who
 * ignores it is bounded by the spend limit instead.
 *
 * Development loosens it rather than removing it. 90 seconds is pure friction
 * while debugging a session, but realtime bills on wall clock, so a session left
 * open on your own key overnight is expensive too — 15 minutes clears any
 * working session while still catching a walked-away tab. Next.js substitutes
 * `NODE_ENV` with a literal at build time, so a deployed bundle keeps only the
 * 90s branch; there is no runtime switch to get wrong.
 */
export const REALTIME_SESSION_MAX_MS =
  process.env.NODE_ENV === "production" ? 90_000 : 15 * 60_000;

/**
 * The companion composes seven instruction blocks (persona, user name, demo
 * guidance, avatar catalog, memory, relationship, situational), which measure
 * ~5 KB together at their worst — memory is the largest and is itself bounded by
 * `MEMORY_TOKEN_BUDGET`. This leaves roughly 2x headroom for a longer persona.
 */
export const REALTIME_MAX_INSTRUCTIONS_CHARS = 12_000;

export const REALTIME_MAX_OUTPUT_TOKENS = 4_096;

/** The demo registers well under ten avatar tools. */
export const REALTIME_MAX_TOOLS = 24;

/** Bounds tool JSON Schemas, which are attacker-supplied and unbounded. */
export const REALTIME_MAX_TOOLS_BYTES = 32_768;

/** The only values the Realtime API accepts; anything else is rejected. */
export const REALTIME_TOOL_CHOICES = ["auto", "none", "required"] as const;
