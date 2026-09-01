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
// connected — assistant text arrives over the output-transcription path, and a
// real `setExpression` call round-trips into a canonical avatar event.
//
// The harness's `smoke` mode keeps that leg deterministic: one named expression
// in the catalog, `setExpression` as the only registered tool, and instructions
// that name the ID verbatim. Which expression the model would pick on its own
// is the other suite's question (realtime-gemini-avatar-prompt.spec.ts).
//
// Echo, the convergence gate, and playback timing are NOT covered here: the
// config runs a fake microphone with muted output, which has no acoustic path.
// Those stay hand-driven; see the README.
//
// Cost note: one live session and two model turns per run, so repeated runs
// bill real Gemini usage.

const LIVE_ENABLED = process.env.RUN_LIVE_REALTIME_TESTS === "1";
const HAS_API_KEY = Boolean(process.env.GEMINI_API_KEY);

const SET_EXPRESSION_TOOL_NAME = "setExpression";
const SMOKE_EXPRESSION_ID = "Smile";

const GREETING_PROMPT = "안녕! 한 문장으로 짧게 인사해줘.";
const SMILE_PROMPT = "이제 웃어줘!";

test.describe("realtime Gemini Live smoke harness", () => {
  test.skip(
    !LIVE_ENABLED || !HAS_API_KEY,
    "Set RUN_LIVE_REALTIME_TESTS=1 and GEMINI_API_KEY to run live Gemini Live smoke tests.",
  );

  test.afterEach(async ({ page }) => {
    await stopSession(page);
  });

  test("connects a live session, transcribes a turn, and round-trips setExpression", async ({
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

    await sendPrompt(page, SMILE_PROMPT);
    await waitForToolCall(page, SET_EXPRESSION_TOOL_NAME);
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

    const expressionCall = snapshot.toolCalls.find(
      (call) => call.name === SET_EXPRESSION_TOOL_NAME,
    );
    expect(expressionCall).toBeDefined();
    // The argument, not just the call: the enum reaches Gemini through the
    // minted setup's `functionDeclarations.parameters`, so a dropped schema
    // shows up here as a call carrying nothing usable.
    expect(expressionCall?.args.expressionId).toBe(SMOKE_EXPRESSION_ID);
    expect(snapshot.avatarEvents).toContainEqual({
      type: "expression",
      expressionId: SMOKE_EXPRESSION_ID,
    });
    expect(snapshot.assistantText.trim().length).toBeGreaterThan(0);
  });
});
