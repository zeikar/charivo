---
"@charivo/realtime": patch
---

Reuse the shared LipSyncAnalyzer in the OpenAI realtime client

Behavior-preserving refactor of `openai/client.ts`: the inline AudioContext/analyser/RMS lip-sync loop (and its `audioContext`/`audioSource`/`analyser`/`lipSyncInterval` fields) is replaced by the existing `LipSyncAnalyzer` already used by the OpenAI Agents transport. The RMS math, `fftSize`, smoothing, and 60fps cadence are unchanged. No public API or behavior change.
