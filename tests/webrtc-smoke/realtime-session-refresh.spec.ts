import { expect, test } from "@playwright/test";
import {
  getSnapshot,
  sendPrompt,
  stopSession,
  updateSession,
  waitForAssistantCompletion,
  waitForConnected,
  waitForNoHarnessError,
  waitForSessionInstructions,
} from "./spec-helpers";

const LIVE_ENABLED = process.env.RUN_LIVE_REALTIME_TESTS === "1";
const HAS_API_KEY = Boolean(process.env.OPENAI_API_KEY);
const PATCH_MARKER = "PATCH_REFRESH_SENTINEL";

test.describe("realtime session patch refresh", () => {
  test.skip(
    !LIVE_ENABLED || !HAS_API_KEY,
    "Set RUN_LIVE_REALTIME_TESTS=1 and OPENAI_API_KEY to run live WebRTC smoke tests.",
  );

  test.afterEach(async ({ page }) => {
    await stopSession(page);
  });

  test("patches a live session in place without synthetic session restart events", async ({
    page,
  }) => {
    await page.goto("/");

    const connectButton = page.getByTestId("connect-button");
    await connectButton.click();

    await waitForConnected(page);
    await waitForNoHarnessError(page);

    const beforePatch = await getSnapshot(page);
    logSessionPatch("before patch snapshot", {
      connection: beforePatch.connection,
      sessionStatus: beforePatch.sessionStatus,
      assistantCompletions: beforePatch.assistantCompletions,
      sessionInstructions: beforePatch.sessionInstructions,
    });

    const sessionBoundaryEventsBefore = beforePatch.events.filter(
      (event) =>
        event.type === "realtime:session:start" ||
        event.type === "realtime:session:end",
    ).length;

    await updateSession(page, {
      provider: "openai",
      toolChoice: "auto",
      instructions: [
        "You are Hiyori.",
        "Stay fully in character.",
        `Remember this marker exactly: ${PATCH_MARKER}.`,
        'When the user asks for the marker, say exactly "PATCH_REFRESH_SENTINEL".',
        "Do not call any tool for that request.",
      ].join(" "),
    });

    await waitForSessionInstructions(page, PATCH_MARKER);
    await waitForNoHarnessError(page);

    const afterPatch = await getSnapshot(page);
    logSessionPatch("after patch snapshot", {
      connection: afterPatch.connection,
      sessionStatus: afterPatch.sessionStatus,
      assistantCompletions: afterPatch.assistantCompletions,
      sessionInstructions: afterPatch.sessionInstructions,
    });

    const sessionBoundaryEventsAfter = afterPatch.events.filter(
      (event) =>
        event.type === "realtime:session:start" ||
        event.type === "realtime:session:end",
    ).length;

    expect(afterPatch.connection).toBe("connected");
    expect(afterPatch.sessionStatus).toBe("active");
    expect(afterPatch.sessionInstructions).toContain(PATCH_MARKER);
    expect(sessionBoundaryEventsAfter).toBe(sessionBoundaryEventsBefore);

    const eventCountBeforePrompt = afterPatch.events.length;
    const completionsBeforePrompt = afterPatch.assistantCompletions;

    await sendPrompt(page, "What is the marker?");
    await waitForAssistantCompletion(page, completionsBeforePrompt + 1);
    await waitForNoHarnessError(page);

    const finalSnapshot = await getSnapshot(page);
    const postPromptEvents = finalSnapshot.events.slice(eventCountBeforePrompt);
    const assistantDoneTexts = postPromptEvents
      .filter((event) => event.type === "realtime:assistant:done")
      .map((event) => {
        const payload = event.payload as { text?: string };
        return payload.text ?? "";
      });
    const postPromptSessionBoundaryEvents = postPromptEvents.filter(
      (event) =>
        event.type === "realtime:session:start" ||
        event.type === "realtime:session:end",
    );

    logSessionPatch("final snapshot", {
      connection: finalSnapshot.connection,
      sessionStatus: finalSnapshot.sessionStatus,
      assistantCompletions: finalSnapshot.assistantCompletions,
      assistantText: finalSnapshot.assistantText,
    });
    logSessionPatch("assistant done texts after prompt", assistantDoneTexts);
    logSessionPatch(
      "post-prompt session boundary events",
      postPromptSessionBoundaryEvents,
    );
    logSessionPatch(
      "post-prompt event tail",
      summarizeEvents(postPromptEvents.slice(-12)),
    );

    expect(finalSnapshot.connection).toBe("connected");
    expect(finalSnapshot.sessionStatus).toBe("active");
    expect(assistantDoneTexts.some((text) => text.includes(PATCH_MARKER))).toBe(
      true,
    );
    expect(postPromptSessionBoundaryEvents).toHaveLength(0);
  });
});

function logSessionPatch(label: string, value: unknown): void {
  console.log(`[session patch] ${label}:\n${JSON.stringify(value, null, 2)}`);
}

function summarizeEvents(
  events: Array<{
    type: string;
    payload: unknown;
    at: number;
  }>,
): Array<Record<string, unknown>> {
  return events.map((event) => ({
    type: event.type,
    at: event.at,
    payload:
      event.type === "realtime:state"
        ? summarizeRealtimeState(event.payload)
        : event.payload,
  }));
}

function summarizeRealtimeState(payload: unknown): unknown {
  const statePayload = payload as {
    state?: {
      connection?: string;
      session?: {
        status?: string;
        characterId?: string;
      };
      response?: {
        status?: string;
        text?: string;
      };
      lastError?: unknown;
    };
  };

  return {
    state: {
      connection: statePayload.state?.connection,
      session: {
        status: statePayload.state?.session?.status,
        characterId: statePayload.state?.session?.characterId,
      },
      response: {
        status: statePayload.state?.response?.status,
        text: statePayload.state?.response?.text,
      },
      lastError: statePayload.state?.lastError,
    },
  };
}
