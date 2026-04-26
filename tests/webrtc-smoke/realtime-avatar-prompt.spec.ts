import { expect, test } from "@playwright/test";
import {
  getSnapshot,
  sendPrompt,
  stopSession,
  waitForAssistantCompletion,
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
    await waitForNoHarnessError(page);

    const afterExpression = await getSnapshot(page);
    const expressionCalls = afterExpression.toolCalls.slice(
      initialSnapshot.toolCalls.length,
    );
    const expressionEvents = afterExpression.avatarEvents.slice(
      initialSnapshot.avatarEvents.length,
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
    await waitForNoHarnessError(page);

    const afterMotion = await getSnapshot(page);
    const motionCalls = afterMotion.toolCalls.slice(
      afterExpression.toolCalls.length,
    );
    const motionEvents = afterMotion.avatarEvents.slice(
      afterExpression.avatarEvents.length,
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
    await waitForNoHarnessError(page);

    let afterGaze = await getSnapshot(page);
    let gazeCalls = afterGaze.toolCalls.slice(afterMotion.toolCalls.length);
    let gazeEvents = afterGaze.avatarEvents.slice(
      afterMotion.avatarEvents.length,
    );
    console.log(
      `[avatar-prompt-eval] turn 3 (gaze) response: ${JSON.stringify(afterGaze.assistantText)}`,
    );
    console.log(
      `[avatar-prompt-eval] turn 3 tool calls: ${JSON.stringify(gazeCalls)}`,
    );
    console.log(
      `[avatar-prompt-eval] turn 3 avatar events: ${JSON.stringify(gazeEvents)}`,
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
      await waitForNoHarnessError(page);

      afterGaze = await getSnapshot(page);
      gazeCalls = afterGaze.toolCalls.slice(afterMotion.toolCalls.length);
      gazeEvents = afterGaze.avatarEvents.slice(
        afterMotion.avatarEvents.length,
      );
      console.log(
        `[avatar-prompt-eval] turn 3 retry (gaze fallback) response: ${JSON.stringify(afterGaze.assistantText)}`,
      );
      console.log(
        `[avatar-prompt-eval] turn 3 retry tool calls: ${JSON.stringify(gazeCalls)}`,
      );
      console.log(
        `[avatar-prompt-eval] turn 3 retry avatar events: ${JSON.stringify(gazeEvents)}`,
      );
    }

    expect(gazeCalls.some((call) => call.name === LOOK_AT_TOOL_NAME)).toBe(
      true,
    );
    expect(gazeEvents.some((event) => event.type === "gaze")).toBe(true);
  });
});
