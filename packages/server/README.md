# @charivo/server

Server-side provider adapters for Charivo. Use these behind your own API routes
so vendor credentials stay on the server.

## Install

```bash
pnpm add @charivo/server
```

## Usage

Imports are subpath-only — there is no root export.

### OpenAI providers

```ts
import {
  createOpenAILLMProvider,
  createOpenAITTSProvider,
  createOpenAISTTProvider,
  createOpenAIRealtimeProvider,
} from "@charivo/server/openai";

const llm = createOpenAILLMProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-4.1-nano",
});
```

### Gemini providers

```ts
import {
  createGeminiLLMProvider,
  createGeminiTTSProvider,
  createGeminiRealtimeProvider,
} from "@charivo/server/gemini";

const llm = createGeminiLLMProvider({
  apiKey: process.env.GEMINI_API_KEY!,
  // Optional: defaults to "gemini-3.5-flash-lite".
  model: "gemini-3.5-flash-lite",
});

const tts = createGeminiTTSProvider({
  apiKey: process.env.GEMINI_API_KEY!,
  // Optional: defaults to "gemini-3.1-flash-tts-preview" / "Kore".
  defaultModel: "gemini-3.1-flash-tts-preview",
  defaultVoice: "Kore",
  // `@charivo/tts/remote` gives up at 30s, so the server must give up first.
  timeoutMs: 25_000,
});

const realtime = createGeminiRealtimeProvider({
  apiKey: process.env.GEMINI_API_KEY!,
});
```

`createGeminiLLMProvider` (implemented in `@charivo/llm/gemini`) calls Gemini's
OpenAI-compatible endpoint. Tool-call history is resent with Gemini's
documented `skip_thought_signature_validator` placeholder because
`LLMToolCall` carries no thought signature, so reasoning continuity across
tool rounds is lost.

`createGeminiTTSProvider` (implemented in `@charivo/tts/gemini`) wraps
Gemini's raw PCM response as a 16-bit WAV file; `rate` and `pitch` are
ignored, since the API has no speed or pitch control. The text is sent
behind a fixed synthesis preamble, and a 5xx or a text-only answer is
retried once within the same `timeoutMs`, per Google's documented
mitigations. Its 90s default `timeoutMs` is only for callers that own their
own deadline — a route behind `@charivo/tts/remote` must set it below that
player's fixed 30s, as above — and the text cap is the real latency control
on top of that deadline (the demo caps at 400 characters via
`TTS_GEMINI_MAX_TEXT_CHARS`).

`createSession` mints a single-use Gemini Live ephemeral token and returns a
websocket bootstrap (`{ adapter, transport: "websocket", url, token }`) for
`@charivo/realtime/remote` or `@charivo/realtime/gemini`. The whole session
config goes into the token: Google's `bidiGenerateContentSetup` replaces the
browser's setup frame rather than validating it, and a token minted without one
lets the holder open any model on your key (both measured), so model, voice,
instructions, tools, `maxTokens`, and transcription are all fixed at mint time
and cannot be changed by the browser afterwards — which is also why the
transport refuses `updateSession()`. The API key travels in the
`x-goog-api-key` header, never the URL. Replaying a spent token closes the
socket with `1011`, so a reconnect calls this again.

What it pins itself, on top of whatever your route pins:

- `model` must be on its allow-list (`gemini-3.1-flash-live-preview`, the
  default and the model measured against the live API, or
  `gemini-2.5-flash-native-audio-preview-12-2025`); anything else throws
- `voice` must be one of Google's prebuilt voice names; an unknown one falls
  back to the default `Kore` silently, since voice costs nothing
- `transport` must be `"websocket"`, and `toolChoice` may only be `"auto"` —
  `"none"` and `"required"` are rejected because the Live API has no equivalent
- `inputAudioTranscription.model` is rejected for the same reason; input
  transcription is requested only with `enabled: true` (off unless asked, as on
  OpenAI), and output transcription is always requested, because on a
  native-audio model it is the only source of assistant text

### OpenClaw providers

```ts
import { createOpenClawLLMProvider } from "@charivo/server/openclaw";

const llm = createOpenClawLLMProvider({
  token: process.env.OPENCLAW_TOKEN!,
  baseURL: process.env.OPENCLAW_BASE_URL!,
  // Optional: target a specific agent. Omit to use the gateway's default agent.
  agentId: process.env.OPENCLAW_AGENT_ID,
  // Optional: pin the conversation to a server-side session on the gateway.
  sessionKey: conversationId,
});
```

The OpenClaw gateway keeps conversation state server-side. Without `sessionKey` it
opens a fresh session per request: the caller's message history is still sent, so
the model sees prior turns, but the gateway persists nothing between requests and
each turn strands a throwaway session. Pass a conversation-scoped identifier (a
UUID per conversation, rotated when the user resets the chat) to keep turns on one
session; past turns are then left to the gateway instead of being resent. Rotating
`sessionKey` is the only way to reset a pinned conversation — the gateway keeps the
old transcript under the old key.

`generateResponseWithTools` depends on which runtime the target agent runs on.
OpenClaw routes `openai/*` models to its Codex harness by default, and that
harness builds its tool list from OpenClaw's own tools without reading the ones
the caller sent. The gateway still parses and validates them, so the request
succeeds — it just comes back as ordinary prose with no `toolCalls`, which reads
like the model ignoring the tools rather than never being offered them. Tool
calling needs an agent whose model resolves to OpenClaw's embedded runtime, set
per provider/model in the gateway config:

```json5
{ models: { "openai/gpt-5.5": { agentRuntime: { id: "openclaw" } } } }
```

That key is valid under `agents.list[]` for one agent or `agents.defaults` for
all of them, and it keeps the gateway's existing credentials. `generateResponse`
is unaffected. Verified against OpenClaw 2026.6.11.

## Exports

- `@charivo/server/openai`: `createOpenAILLMProvider`, `createOpenAITTSProvider`, `createOpenAISTTProvider`, `createOpenAIRealtimeProvider`
- `@charivo/server/openclaw`: `createOpenClawLLMProvider`
- `@charivo/server/gemini`: `createGeminiLLMProvider`, `createGeminiTTSProvider`, `createGeminiRealtimeProvider`

The LLM/TTS/STT providers are re-exported from `@charivo/llm`, `@charivo/tts`,
and `@charivo/stt` (the `openai`/`openclaw`/`gemini` subpaths implement them). Only the
realtime providers, `createOpenAIRealtimeProvider` and
`createGeminiRealtimeProvider`, are implemented in this package.

## Errors

Every provider in this package (`createOpenAILLMProvider`, `createOpenAITTSProvider`,
`createOpenAISTTProvider`, `createOpenAIRealtimeProvider`,
`createGeminiLLMProvider`, `createGeminiTTSProvider`, `createGeminiRealtimeProvider`,
`createOpenClawLLMProvider`)
throws `CharivoError` subclasses from `@charivo/core` instead of plain `Error`s:

- SDK/API failures throw `CharivoProviderError` (`code: "CHARIVO_PROVIDER_ERROR"`).
  The LLM/TTS/STT providers wrap the SDK's own error: its message is preserved and
  the original error is kept on `cause`. The two realtime providers'
  HTTP-status errors (non-2xx responses, an invalid client secret or token
  response) are built from the response body text, so they carry the API's
  message but no `cause`; their network/connection failures and response
  body/JSON parsing failures are wrapped with the original error kept on `cause`.
- Request timeouts throw `CharivoTimeoutError` (`code: "CHARIVO_TIMEOUT_ERROR"`):
  30s for the OpenAI providers and Gemini LLM/Realtime, and for Gemini TTS the
  configured `timeoutMs` (90s default; set it below 30s behind
  `@charivo/tts/remote`), whose timer also covers reading the body and spans
  its single retry. For the two realtime providers the timer covers the
  request up to the response headers; reading the body afterwards is not
  timed.
- Constructing a provider in a browser without `dangerouslyAllowBrowser: true`
  throws `CharivoStateError` (`code: "CHARIVO_STATE_ERROR"`).
  The realtime providers also throw `CharivoStateError` for invalid session
  requests: an unsupported provider/transport/adapter or a missing SDP offer on
  OpenAI; an unsupported provider/transport/adapter, a model off the allow-list,
  a `toolChoice` of `"none"`/`"required"`, or an `inputAudioTranscription.model`
  on Gemini.

`CharivoError extends Error`, so existing `catch (e)` handling still works;
use `isCharivoError(error)` or `error.code` to branch on the failure kind.
