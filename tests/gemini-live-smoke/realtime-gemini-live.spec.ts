import { expect, test } from "@playwright/test";
import {
  getSnapshot,
  sendPrompt,
  stopSession,
  waitForAssistantCompletion,
  waitForConnected,
  waitForNoHarnessError,
  waitForToolCall,
} from "./spec-helpers";

// Gated live smoke for the Gemini Live chain, driven through the same harness
// the manual protocol uses (README.md).
//
// What only a live run can show: the browser reaches an active session through
// this harness's real `/api/realtime` bootstrap — so the remote client resolved
// the Gemini adapter, the provider minted a token, and the WS transport
// connected — assistant text arrives over the output-transcription path, and
// the registered dummy tool round-trips.
//
// Echo, the convergence gate, and playback timing are NOT covered here: the
// config runs a fake microphone with muted output, which has no acoustic path.
// Those stay hand-driven; see the README.
//
// Cost note: one live session and two model turns per run, so repeated runs
// bill real Gemini usage.

const LIVE_ENABLED = process.env.RUN_LIVE_REALTIME_TESTS === "1";
const HAS_API_KEY = Boolean(process.env.GEMINI_API_KEY);

const GREETING_PROMPT = "안녕! 한 문장으로 짧게 인사해줘.";
const WEATHER_PROMPT = "서울 날씨 알려줘.";

test.describe("realtime Gemini Live smoke harness", () => {
  test.skip(
    !LIVE_ENABLED || !HAS_API_KEY,
    "Set RUN_LIVE_REALTIME_TESTS=1 and GEMINI_API_KEY to run live Gemini Live smoke tests.",
  );

  test.afterEach(async ({ page }) => {
    await stopSession(page);
  });

  test("connects a live session, transcribes a turn, and round-trips a tool call", async ({
    page,
  }) => {
    await page.goto("/");

    // The button, not the harness API: starting inside a real user gesture is
    // what lets the transport reuse the prepared `AudioContext`.
    await page.getByTestId("connect-button").click();

    await waitForConnected(page);
    await waitForNoHarnessError(page);

    await sendPrompt(page, GREETING_PROMPT);
    await waitForAssistantCompletion(page, 1);
    await waitForNoHarnessError(page);

    const afterGreeting = await getSnapshot(page);
    expect(afterGreeting.assistantText.trim().length).toBeGreaterThan(0);

    await sendPrompt(page, WEATHER_PROMPT);
    await waitForToolCall(page, "getWeather");
    // Counted from the greeting rather than a literal 2: the tool leg may add a
    // completion of its own, and the spoken follow-up is the one being awaited.
    await waitForAssistantCompletion(
      page,
      afterGreeting.assistantCompletions + 1,
    );
    await waitForNoHarnessError(page);

    const snapshot = await getSnapshot(page);

    expect(snapshot).toMatchObject({
      sessionStatus: "active",
      connection: "connected",
      lastError: null,
    });

    const weatherCall = snapshot.toolCalls.find(
      (call) => call.name === "getWeather",
    );
    expect(weatherCall).toBeDefined();
    expect(Object.keys(weatherCall?.args ?? {}).length).toBeGreaterThan(0);
    expect(snapshot.assistantText.trim().length).toBeGreaterThan(0);
  });
});
