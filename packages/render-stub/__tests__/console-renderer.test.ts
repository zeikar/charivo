import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsoleRenderer } from "@charivo/render-stub";

const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

afterEach(() => {
  consoleSpy.mockClear();
});

describe("ConsoleRenderer", () => {
  it("logs user, character, and system messages distinctly", async () => {
    const renderer = new ConsoleRenderer();
    const timestamp = new Date("2024-01-01T12:00:00Z");

    await renderer.initialize();
    await renderer.render({
      id: "1",
      content: "Hello",
      timestamp,
      type: "user",
    });
    await renderer.render(
      {
        id: "2",
        content: "Hi there",
        timestamp,
        type: "character",
        characterId: "char-1",
      },
      { id: "char-1", name: "Hiyori" },
    );
    await renderer.render({
      id: "3",
      content: "System notice",
      timestamp,
      type: "system",
    });
    await renderer.destroy();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("ConsoleRenderer initialized"),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("User: Hello"),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Hiyori: Hi there"),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("System: System notice"),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("ConsoleRenderer destroyed"),
    );
  });
});
