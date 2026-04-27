import { expect, test } from "@playwright/test";
import {
  getSnapshot,
  sendPrompt,
  stopSession,
  waitForAssistantCompletion,
  waitForAssistantSettled,
  waitForConnected,
  waitForNoHarnessError,
} from "./spec-helpers";

const SET_EXPRESSION_TOOL_NAME = "setExpression";
const PLAY_MOTION_TOOL_NAME = "playMotion";
const LOOK_AT_TOOL_NAME = "lookAt";

const LIVE_ENABLED = process.env.RUN_LIVE_REALTIME_TESTS === "1";
const HAS_API_KEY = Boolean(process.env.OPENAI_API_KEY);

test.describe("realtime avatar prompt evaluation", () => {
  test.skip(
    !LIVE_ENABLED || !HAS_API_KEY,
    "Set RUN_LIVE_REALTIME_TESTS=1 and OPENAI_API_KEY to run live WebRTC prompt evaluation.",
  );

  test.afterEach(async ({ page }) => {
    await stopSession(page);
  });

  test("uses default realtime instructions with avatar addendum and canonical tools", async ({
    page,
  }) => {
    await page.goto("/?mode=avatar-prompt-eval");

    await page.getByTestId("connect-button").click();

    await waitForConnected(page);
    await waitForNoHarnessError(page);

    const initialSnapshot = await getSnapshot(page);

    expect(initialSnapshot.mode).toBe("avatar-prompt-eval");
    expect(initialSnapshot.registeredTools).toEqual([
      SET_EXPRESSION_TOOL_NAME,
      PLAY_MOTION_TOOL_NAME,
      LOOK_AT_TOOL_NAME,
    ]);
    expect(initialSnapshot.sessionInstructions).not.toBeNull();
    expect(
      (initialSnapshot.sessionInstructions ?? "").trim().length,
    ).toBeGreaterThan(0);

    await sendPrompt(
      page,
      "I just arrived and I'm happy to see you. Greet me warmly in one short sentence.",
    );
    await waitForAssistantCompletion(
      page,
      initialSnapshot.assistantCompletions + 1,
    );
    await waitForAssistantSettled(page);
    await waitForNoHarnessError(page);

    const afterExpression = await getSnapshot(page);
    const expressionCalls = afterExpression.toolCalls.slice(
      initialSnapshot.toolCalls.length,
    );
    const expressionEvents = afterExpression.avatarEvents.slice(
      initialSnapshot.avatarEvents.length,
    );
    const expressionUsage = afterExpression.usageEvents.slice(
      initialSnapshot.usageEvents.length,
    );
    console.log(
      `[avatar-prompt-eval] turn 1 (expression) response: ${JSON.stringify(afterExpression.assistantText)}`,
    );
    console.log(
      `[avatar-prompt-eval] turn 1 tool calls: ${JSON.stringify(expressionCalls)}`,
    );
    console.log(
      `[avatar-prompt-eval] turn 1 avatar events: ${JSON.stringify(expressionEvents)}`,
    );
    console.log(
      `[avatar-prompt-eval] turn 1 usage: ${JSON.stringify(expressionUsage)}`,
    );

    expect(
      expressionCalls.some((call) => call.name === SET_EXPRESSION_TOOL_NAME),
    ).toBe(true);
    expect(expressionEvents.some((event) => event.type === "expression")).toBe(
      true,
    );

    await sendPrompt(
      page,
      "Share one short fact about the ocean and add a noticeable body motion for emphasis.",
    );
    await waitForAssistantCompletion(
      page,
      afterExpression.assistantCompletions + 1,
    );
    await waitForAssistantSettled(page);
    await waitForNoHarnessError(page);

    const afterMotion = await getSnapshot(page);
    const motionCalls = afterMotion.toolCalls.slice(
      afterExpression.toolCalls.length,
    );
    const motionEvents = afterMotion.avatarEvents.slice(
      afterExpression.avatarEvents.length,
    );
    const motionUsage = afterMotion.usageEvents.slice(
      afterExpression.usageEvents.length,
    );
    console.log(
      `[avatar-prompt-eval] turn 2 (motion) response: ${JSON.stringify(afterMotion.assistantText)}`,
    );
    console.log(
      `[avatar-prompt-eval] turn 2 tool calls: ${JSON.stringify(motionCalls)}`,
    );
    console.log(
      `[avatar-prompt-eval] turn 2 avatar events: ${JSON.stringify(motionEvents)}`,
    );
    console.log(
      `[avatar-prompt-eval] turn 2 usage: ${JSON.stringify(motionUsage)}`,
    );

    expect(
      motionCalls.some((call) => call.name === PLAY_MOTION_TOOL_NAME),
    ).toBe(true);
    expect(motionEvents.some((event) => event.type === "motion")).toBe(true);

    await sendPrompt(
      page,
      "Glance to the right briefly before you answer, then reply in one short sentence.",
    );
    await waitForAssistantCompletion(
      page,
      afterMotion.assistantCompletions + 1,
    );
    await waitForAssistantSettled(page);
    await waitForNoHarnessError(page);

    let afterGaze = await getSnapshot(page);
    let gazeCalls = afterGaze.toolCalls.slice(afterMotion.toolCalls.length);
    let gazeEvents = afterGaze.avatarEvents.slice(
      afterMotion.avatarEvents.length,
    );
    let gazeUsage = afterGaze.usageEvents.slice(afterMotion.usageEvents.length);
    console.log(
      `[avatar-prompt-eval] turn 3 (gaze) response: ${JSON.stringify(afterGaze.assistantText)}`,
    );
    console.log(
      `[avatar-prompt-eval] turn 3 tool calls: ${JSON.stringify(gazeCalls)}`,
    );
    console.log(
      `[avatar-prompt-eval] turn 3 avatar events: ${JSON.stringify(gazeEvents)}`,
    );
    console.log(
      `[avatar-prompt-eval] turn 3 usage: ${JSON.stringify(gazeUsage)}`,
    );

    if (
      !gazeCalls.some((call) => call.name === LOOK_AT_TOOL_NAME) ||
      !gazeEvents.some((event) => event.type === "gaze")
    ) {
      await sendPrompt(
        page,
        "Use a gaze shift to the right (x 1, y 0) before you answer. Keep the reply to one short sentence.",
      );
      await waitForAssistantCompletion(
        page,
        afterGaze.assistantCompletions + 1,
      );
      await waitForAssistantSettled(page);
      await waitForNoHarnessError(page);

      afterGaze = await getSnapshot(page);
      gazeCalls = afterGaze.toolCalls.slice(afterMotion.toolCalls.length);
      gazeEvents = afterGaze.avatarEvents.slice(
        afterMotion.avatarEvents.length,
      );
      gazeUsage = afterGaze.usageEvents.slice(afterMotion.usageEvents.length);
      console.log(
        `[avatar-prompt-eval] turn 3 retry (gaze fallback) response: ${JSON.stringify(afterGaze.assistantText)}`,
      );
      console.log(
        `[avatar-prompt-eval] turn 3 retry tool calls: ${JSON.stringify(gazeCalls)}`,
      );
      console.log(
        `[avatar-prompt-eval] turn 3 retry avatar events: ${JSON.stringify(gazeEvents)}`,
      );
      console.log(
        `[avatar-prompt-eval] turn 3 retry usage: ${JSON.stringify(gazeUsage)}`,
      );
    }

    expect(gazeCalls.some((call) => call.name === LOOK_AT_TOOL_NAME)).toBe(
      true,
    );
    expect(gazeEvents.some((event) => event.type === "gaze")).toBe(true);

    // Turn 4 — pairing probe. Emotional prompt without naming tools to
    // observe how many avatar actions the model picks on its own. Advisory
    // logging only; no strict pairing assertion since the count is the
    // signal we are measuring across runs.
    await sendPrompt(
      page,
      "I haven't seen you in months and I just got the job I've been chasing all year. Tell me what comes to mind.",
    );
    await waitForAssistantCompletion(page, afterGaze.assistantCompletions + 1);
    await waitForAssistantSettled(page);
    await waitForNoHarnessError(page);

    const afterPairing = await getSnapshot(page);
    const pairingCalls = afterPairing.toolCalls.slice(
      afterGaze.toolCalls.length,
    );
    const pairingEvents = afterPairing.avatarEvents.slice(
      afterGaze.avatarEvents.length,
    );
    const pairingUsage = afterPairing.usageEvents.slice(
      afterGaze.usageEvents.length,
    );
    const uniqueTools = new Set(pairingCalls.map((call) => call.name));
    console.log(
      `[avatar-prompt-eval] turn 4 (pairing probe) response: ${JSON.stringify(afterPairing.assistantText)}`,
    );
    console.log(
      `[avatar-prompt-eval] turn 4 tool count: ${pairingCalls.length}`,
    );
    console.log(
      `[avatar-prompt-eval] turn 4 unique tool types: ${uniqueTools.size}`,
    );
    console.log(
      `[avatar-prompt-eval] turn 4 pairing observed: ${uniqueTools.size > 1}`,
    );
    console.log(
      `[avatar-prompt-eval] turn 4 tool calls: ${JSON.stringify(pairingCalls)}`,
    );
    console.log(
      `[avatar-prompt-eval] turn 4 avatar events: ${JSON.stringify(pairingEvents)}`,
    );
    console.log(
      `[avatar-prompt-eval] turn 4 usage: ${JSON.stringify(pairingUsage)}`,
    );
    console.log(
      `[avatar-prompt-eval] total usage events: ${JSON.stringify(afterPairing.usageEvents)}`,
    );
  });
});
