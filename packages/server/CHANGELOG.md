# @charivo/server

## 0.3.1

### Patch Changes

- Updated dependencies [5a86dee]
  - @charivo/core@0.13.0

## 0.3.0

### Minor Changes

- 8f7d277: Expose inputAudioTranscription on RealtimeSessionConfig (model + enabled)

  `RealtimeSessionConfig` now accepts an optional `inputAudioTranscription` field for controlling user-microphone transcription on the provider:
  - `inputAudioTranscription: { model: "gpt-4o-mini-transcribe" }` selects a cheaper transcription model.
  - `inputAudioTranscription: { model: "gpt-4o-transcribe" }` selects the higher-quality option.
  - `inputAudioTranscription: { enabled: false }` disables transcription entirely (useful when the UI never displays the user transcript).

  Default behavior is unchanged when the field is unset — providers continue with their existing server-side defaults. The wire shape lands under `audio.input.transcription` per the OpenAI Realtime GA contract, and applies consistently across the legacy OpenAI WebRTC client, the OpenAI Agents SDK transport, and the server provider. Model strings are pass-through; unknown values surface as upstream errors from OpenAI rather than being validated locally. Example known values: `whisper-1`, `gpt-4o-mini-transcribe`, `gpt-4o-transcribe`.

### Patch Changes

- Updated dependencies [8f7d277]
  - @charivo/core@0.12.0

## 0.2.4

### Patch Changes

- 9f069da: Keep OpenAI realtime provider default model and voice values behind named
  provider-local constants while preserving the existing fallback behavior.
- Updated dependencies [8826f2b]
  - @charivo/core@0.11.0

## 0.2.3

### Patch Changes

- Updated dependencies [79df4cc]
  - @charivo/core@0.10.0

## 0.2.2

### Patch Changes

- Updated dependencies [7d6608f]
  - @charivo/core@0.9.0

## 0.2.1

### Patch Changes

- Updated dependencies [3aa84ad]
  - @charivo/core@0.8.0

## 0.2.0

### Minor Changes

- defca13: Consolidate the public package surface into coarse modality packages and a subpath-only server package.

  This release removes the old fine-grained package names in favor of:
  - `@charivo/llm`
  - `@charivo/tts`
  - `@charivo/stt`
  - `@charivo/realtime`
  - `@charivo/render`
  - `@charivo/server`

  It also moves adapter/provider entrypoints to subpaths, keeps `@charivo/render-live2d` separate, and documents that consumers need `moduleResolution: "bundler" | "node16" | "nodenext"` for package subpath exports.

## 0.1.0

- Initial coarse package release for server-side provider adapters.
