---
"@charivo/llm": minor
"@charivo/tts": minor
"@charivo/stt": minor
"@charivo/realtime": minor
"@charivo/render": minor
"@charivo/render-live2d": minor
---

Lock the public API surface to factory-only ahead of 1.0.

Browser clients, players, transcribers, managers, and renderers are no longer
exported as concrete classes — create them via their `create*` factory, which
now returns the public interface (`LLMClient`, `TTSPlayer`, `STTTranscriber`,
`RealtimeTransportClient`, `Renderer`, and a new public `Live2DRenderer`
interface) rather than the implementation class.

- `@charivo/llm`: root is factory-only (`createLLMManager` + `LLMManagerOptions`); the internal builder helpers (`CharacterPromptBuilder`, `MessageConverter`, `ResponseMessageBuilder`, `LLMValidators`, `MessageHistoryManager`) and the direct client classes are no longer exported.
- `@charivo/tts` / `@charivo/stt`: roots are factory-only; player/transcriber classes, `STTManagerImpl`, and internal helpers (`MediaRecorderHelper`, `WebSpeechLipSyncSimulator`, tts-utils) are no longer exported.
- `@charivo/realtime`: `RealtimeManagerImpl` and the transport client classes (`RemoteRealtimeClient`, `OpenAIRealtimeClient`, `OpenAIRealtimeAgentsClient`) are no longer exported.
- `@charivo/render`: `RenderManager` and `RealTimeLipSync` are no longer exported; `@charivo/render/stub` adds a `createConsoleRenderer()` factory and hides `ConsoleRenderer`.
- `@charivo/render-live2d`: the concrete renderer class is hidden behind a new public `Live2DRenderer` interface; construct via `createLive2DRenderer()`.

Migration: replace any `new <Class>(...)` / direct class import from these packages with the corresponding `create*` factory. Factory and config/options type names are unchanged. The one capability that did not move to an instance method — the Web Speech support check previously reachable via `new WebSTTTranscriber().isSupportedBrowser()` — is now the standalone, SSR-safe `isWebSTTSupported()` export from `@charivo/stt/web`.
