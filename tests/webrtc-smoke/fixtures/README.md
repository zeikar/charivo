# Voice Smoke Fixtures

This directory holds the canned audio fixture that feeds Chromium's fake mic
for the voice latency smoke test.

## `voice-smoke-input.wav`

Expected structure:

- 500 ms leading silence
- ~2000 ms speech ("Please say hi and smile for me.")
- 1500 ms trailing silence

Expected format: 16-bit PCM, 48 kHz, mono. This is what Chromium's
`--use-file-for-fake-audio-capture` flag expects.

The trailing silence must exceed the OpenAI server VAD default silence window
(~500 ms) so `speech_stopped` fires before Chromium loops the file.

## Regeneration

Requires macOS `say` and `ffmpeg`:

```bash
say "Please say hi and smile for me." \
  -o /tmp/speech.aiff \
  --data-format=LEI16@48000

ffmpeg -y -i /tmp/speech.aiff \
  -af "adelay=500|500,apad=pad_dur=1.5" \
  -ar 48000 -ac 1 -acodec pcm_s16le \
  tests/webrtc-smoke/fixtures/voice-smoke-input.wav
```

After regenerating, verify the actual speech duration (the `say` output may
drift from ~2000 ms depending on voice selection). If it drifts materially,
update `WAV_SPEECH_END_OFFSET_MS` in
[`../realtime-voice.spec.ts`](../realtime-voice.spec.ts) accordingly.

## Why this is kept out of the default webrtc smoke

The existing `realtime-webrtc.spec.ts` suite uses `sendMessage(text)` and
doesn't need audio input. The voice spec uses a separate Playwright config
(`playwright.voice.config.ts`) so the `--use-file-for-fake-audio-capture` flag
only affects the voice run.
