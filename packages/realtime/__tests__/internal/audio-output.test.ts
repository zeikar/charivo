import { describe, expect, it } from "vitest";
import { RealtimeAudioOutput } from "../../src/internal/audio-output";

describe("RealtimeAudioOutput", () => {
  it("shows every listener the start before the end an earlier listener caused", () => {
    const seen: string[][] = [[], []];
    const listeners = [
      (event: string) => {
        seen[0].push(event);
        if (event === "tts:audio:start") output.end();
      },
      (event: string) => seen[1].push(event),
    ];
    const output: RealtimeAudioOutput = new RealtimeAudioOutput(
      (event) => listeners.forEach((listener) => listener(event)),
      () => {},
    );

    output.start();

    const expected = ["tts:audio:start", "tts:lipsync:update", "tts:audio:end"];
    expect(seen[0]).toEqual(expected);
    expect(seen[1]).toEqual(expected);
    expect(output.isActive()).toBe(false);
  });
});
