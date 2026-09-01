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

// Advisory evaluation, NOT a CI gate. Model outputs are nondeterministic, so a
// failure here is a signal to inspect the instructions or the prompt, not a
// blocking regression.
//
// The harness's `avatar-prompt-eval` mode registers OPAQUE expression IDs
// (`F01`..`F08`), so their meaning reaches the model only through
// `expressionDescriptions` — carried in the `setExpression` schema and in the
// avatar instruction addendum. On the Gemini path both travel through the
// minted `bidiGenerateContentSetup` (`systemInstruction` and
// `tools.functionDeclarations.parameters`), which is where the channel could
// silently be dropped.
//
// The utterance asks for anger on purpose. With the descriptions stripped the
// model picks arbitrarily, and a "smile" request would let it land on the right
// answer by luck; asking for anger makes a lucky guess a FAILING one. The same
// control was run for the OpenAI harness, where deleting the descriptions
// turned this assertion red with a smiling ID.
//
// Cost note: one live session and one model turn per run.

const LIVE_ENABLED = process.env.RUN_LIVE_REALTIME_TESTS === "1";
const HAS_API_KEY = Boolean(process.env.GEMINI_API_KEY);

const SET_EXPRESSION_TOOL_NAME = "setExpression";
const PLAY_MOTION_TOOL_NAME = "playMotion";
const LOOK_AT_TOOL_NAME = "lookAt";

// Derived from `tests/avatar-catalog.ts` — the IDs are opaque, and these sets
// come from the `expressionDescriptions` that give them meaning. `F03` is the
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

const ANGRY_PROMPT = "Please be angry at me, and show it on your face.";

test.describe("realtime Gemini Live avatar prompt evaluation", () => {
  test.skip(
    !LIVE_ENABLED || !HAS_API_KEY,
    "Set RUN_LIVE_REALTIME_TESTS=1 and GEMINI_API_KEY to run live Gemini Live prompt evaluation.",
  );

  test.afterEach(async ({ page }) => {
    await stopSession(page);
  });

  test("picks a contextually correct expression from opaque IDs", async ({
    page,
  }) => {
    await page.goto("/?mode=avatar-prompt-eval");

    // The button, not the harness API: starting inside a real user gesture is
    // what lets the transport reuse the prepared `AudioContext`.
    await page.getByTestId("connect-button").click();

    await waitForConnected(page);
    await waitForNoHarnessError(page);

    const before = await getSnapshot(page);

    expect(before.mode).toBe("avatar-prompt-eval");
    expect(before.registeredTools).toEqual([
      SET_EXPRESSION_TOOL_NAME,
      PLAY_MOTION_TOOL_NAME,
      LOOK_AT_TOOL_NAME,
    ]);
    // Read off the committed session config, so this says the descriptions
    // survived as far as the config the transport actually connected with.
    expect(before.sessionInstructions).toContain("F03 = angry");

    await sendPrompt(page, ANGRY_PROMPT);
    await waitForAssistantCompletion(page, before.assistantCompletions + 1);
    await waitForAssistantSettled(page);
    await waitForNoHarnessError(page);

    const after = await getSnapshot(page);
    const newEvents = after.avatarEvents.slice(before.avatarEvents.length);
    const chosen = newEvents.flatMap((event) =>
      event.type === "expression" ? [event.expressionId] : [],
    );

    console.log(
      `[gemini avatar-prompt-eval] angry turn response: ${JSON.stringify(after.assistantText)}`,
    );
    console.log(
      `[gemini avatar-prompt-eval] angry turn tool calls: ${JSON.stringify(
        after.toolCalls.slice(before.toolCalls.length),
      )}`,
    );
    console.log(
      `[gemini avatar-prompt-eval] angry turn expressions: ${JSON.stringify(chosen)}`,
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
