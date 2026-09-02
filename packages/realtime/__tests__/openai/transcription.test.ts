import { describe, expect, it } from "vitest";
import { resolveOpenAIAudioInput } from "../../src/openai/transcription";

describe("resolveOpenAIAudioInput", () => {
  it("omits the block when nothing was asked for", () => {
    expect(resolveOpenAIAudioInput(undefined)).toBeUndefined();
    expect(resolveOpenAIAudioInput({})).toBeUndefined();
  });

  it("turns transcription off with null", () => {
    expect(resolveOpenAIAudioInput({ enabled: false })).toEqual({
      transcription: null,
    });
    // `enabled: false` wins over a model.
    expect(
      resolveOpenAIAudioInput({ enabled: false, model: "whisper-1" }),
    ).toEqual({ transcription: null });
  });

  it("fills in the default model for an enable without one", () => {
    expect(resolveOpenAIAudioInput({ enabled: true })).toEqual({
      transcription: { model: "gpt-4o-mini-transcribe" },
    });
  });

  it("treats any supplied model as an opt-in, even an empty one", () => {
    expect(resolveOpenAIAudioInput({ model: "whisper-1" })).toEqual({
      transcription: { model: "whisper-1" },
    });
    expect(
      resolveOpenAIAudioInput({ enabled: true, model: "gpt-4o-transcribe" }),
    ).toEqual({ transcription: { model: "gpt-4o-transcribe" } });
    // Not silently off: a bad model fails at the provider instead.
    expect(resolveOpenAIAudioInput({ model: "" })).toEqual({
      transcription: { model: "" },
    });
  });
});
