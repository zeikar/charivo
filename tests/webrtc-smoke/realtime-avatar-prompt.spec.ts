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

// Mirrors AVATAR_CATALOG in src/main.ts. The IDs are opaque; the sets below are
// derived from the `expressionDescriptions` that give them meaning. `F03` is the
// only outright angry face, `F08` ("unimpressed, deadpan") the acceptable
// softer read of the same request.
const CATALOG_EXPRESSIONS = [
  "F01",
  "F02",
  "F03",
  "F04",
  "F05",
  "F06",
  "F07",
  "F08",
];
const DISPLEASED_EXPRESSIONS = ["F03", "F08"];
const SMILING_EXPRESSIONS = ["F01", "F02", "F05", "F07"];

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
    // Not just that a motion arrived: a motion the MODEL asked for must carry
    // muteSound through the whole live chain, or its baked-in sample clip would
    // play over the character's own voice in a real session.
    const liveMotionEvents = motionEvents.filter(
      (event) => event.type === "motion",
    );
    expect(liveMotionEvents.length).toBeGreaterThan(0);
    expect(
      liveMotionEvents.every(
        (event) => event.type === "motion" && event.muteSound === true,
      ),
    ).toBe(true);

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

  // The realtime harness catalog uses OPAQUE expression IDs (`F01`..`F08`), so
  // their meaning reaches the model only through `expressionDescriptions` —
  // carried in the setExpression tool schema the realtime session registers,
  // plus the avatar instruction addendum. This asserts that channel survives
  // the realtime tool-definition path, which normalizes parameters on its way
  // into the session config and is where it could silently be dropped.
  //
  // The utterance asks for anger on purpose. With the descriptions stripped the
  // model picks arbitrarily, and a "smile" request would let it land on the
  // right answer by luck; asking for anger makes a lucky guess a FAILING one.
  // Keep it that way — the same control was run for the cascade suite, where
  // deleting the descriptions turns this style of assertion red.
  test("picks a contextually correct expression from opaque IDs", async ({
    page,
  }) => {
    await page.goto("/?mode=avatar-prompt-eval");

    await page.getByTestId("connect-button").click();

    await waitForConnected(page);
    await waitForNoHarnessError(page);

    const before = await getSnapshot(page);

    await sendPrompt(page, "Please be angry at me, and show it on your face.");
    await waitForAssistantCompletion(page, before.assistantCompletions + 1);
    await waitForAssistantSettled(page);
    await waitForNoHarnessError(page);

    const after = await getSnapshot(page);
    const newEvents = after.avatarEvents.slice(before.avatarEvents.length);
    const chosen = newEvents
      .filter((event) => event.type === "expression")
      .map((event) => (event as { expressionId: string }).expressionId);

    console.log(
      `[avatar-prompt-eval] angry turn response: ${JSON.stringify(after.assistantText)}`,
    );
    console.log(
      `[avatar-prompt-eval] angry turn expressions: ${JSON.stringify(chosen)}`,
    );

    expect(chosen.length, "no setExpression call was made").toBeGreaterThan(0);
    for (const id of chosen) {
      expect(CATALOG_EXPRESSIONS).toContain(id);
    }
    expect(
      chosen.filter((id) => SMILING_EXPRESSIONS.includes(id)),
      `model answered an angry request with a smile: ${JSON.stringify(chosen)}`,
    ).toEqual([]);
    expect(
      chosen.some((id) => DISPLEASED_EXPRESSIONS.includes(id)),
      `expected an angry/displeased expression, got: ${JSON.stringify(chosen)}`,
    ).toBe(true);
  });
});
