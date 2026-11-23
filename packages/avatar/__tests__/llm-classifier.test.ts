import { describe, expect, it, vi } from "vitest";
import type {
  AvatarControlCatalog,
  LLMClient,
  LLMMessage,
} from "@charivo/core";
import { createLLMAvatarClassifier } from "@charivo/avatar";

const UNDESCRIBED: AvatarControlCatalog = {
  expressions: ["happy", "sad", "angry"],
  motions: { Idle: 3, Tap: 1 },
};

function createClient(reply: string) {
  const call = vi.fn<LLMClient["call"]>().mockResolvedValue(reply);
  const callWithTools = vi.fn<NonNullable<LLMClient["callWithTools"]>>();
  const client: LLMClient = { call, callWithTools };
  return { client, call, callWithTools };
}

async function classify(
  reply: string,
  catalog: AvatarControlCatalog = UNDESCRIBED,
) {
  const { client } = createClient(reply);
  return createLLMAvatarClassifier(client)({
    text: "Hello!",
    catalog,
    signal: new AbortController().signal,
  });
}

async function systemMessageFor(catalog: AvatarControlCatalog) {
  const { client, call } = createClient("{}");
  await createLLMAvatarClassifier(client)({
    text: "Hello!",
    catalog,
    signal: new AbortController().signal,
  });
  const messages = call.mock.calls[0]?.[0] as LLMMessage[];
  return messages[0]?.content ?? "";
}

describe("createLLMAvatarClassifier request", () => {
  it("makes one call with a system message and the line as the user message", async () => {
    const { client, call, callWithTools } = createClient("{}");
    const controller = new AbortController();

    await createLLMAvatarClassifier(client)({
      text: "That's wonderful news!",
      catalog: UNDESCRIBED,
      signal: controller.signal,
    });

    expect(call).toHaveBeenCalledTimes(1);
    expect(callWithTools).not.toHaveBeenCalled();
    const [messages, options] = call.mock.calls[0]!;
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("system");
    expect(messages[1]).toEqual({
      role: "user",
      content: "That's wonderful news!",
    });
    expect(options?.signal).toBe(controller.signal);
  });
});

describe("createLLMAvatarClassifier system message", () => {
  it("offers every expression id and every motion group with its index range", async () => {
    const system = await systemMessageFor(UNDESCRIBED);

    for (const id of UNDESCRIBED.expressions) {
      expect(system).toContain(id);
    }
    expect(system).toContain("Idle (index 0-2)");
    expect(system).toContain("Tap (index 0)");
  });

  it("adds the catalog's descriptions as hints", async () => {
    const system = await systemMessageFor({
      ...UNDESCRIBED,
      expressionDescriptions: {
        happy: "bright smile",
        sad: "downcast eyes",
        angry: "furrowed brow",
      },
      motionDescriptions: {
        Idle: ["slow sway", "stretch", "look around"],
        Tap: ["wave hello"],
      },
    });

    for (const hint of [
      "bright smile",
      "downcast eyes",
      "furrowed brow",
      "slow sway",
      "stretch",
      "look around",
      "wave hello",
    ]) {
      expect(system).toContain(hint);
    }
  });

  it("still offers ids and indices the catalog leaves undescribed", async () => {
    const system = await systemMessageFor({
      ...UNDESCRIBED,
      expressionDescriptions: { happy: "bright smile" },
      motionDescriptions: { Idle: ["slow sway"] },
    });

    expect(system).toContain("bright smile");
    expect(system).toContain("slow sway");
    expect(system).toContain("sad");
    expect(system).toContain("angry");
    expect(system).toContain("Idle (index 0-2)");
    expect(system).toContain("Tap (index 0)");
  });

  it("leaves out motions when the catalog has none", async () => {
    const system = await systemMessageFor({
      expressions: ["happy"],
      motions: {},
    });

    expect(system).toContain("happy");
    expect(system).not.toContain("index");
  });

  it("leaves out a motion group with no clips", async () => {
    const system = await systemMessageFor({
      expressions: ["happy"],
      motions: { Idle: 2, Empty: 0 },
    });

    expect(system).toContain("Idle (index 0-1)");
    expect(system).not.toContain("Empty");
  });

  it("offers motions alone when the catalog has no expressions", async () => {
    const system = await systemMessageFor({
      expressions: [],
      motions: { Idle: 2, Tap: 1 },
    });

    expect(system).toContain("Idle (index 0-1)");
    expect(system).toContain("Tap (index 0)");
    expect(system).not.toContain('"expression"');
  });
});

describe("createLLMAvatarClassifier reply parsing", () => {
  const FULL =
    '{"expression": "happy", "motion": {"group": "Tap", "index": 0}}';
  const DECISION = {
    expressionId: "happy",
    motion: { group: "Tap", index: 0 },
  };

  it("reads a plain JSON reply", async () => {
    await expect(classify(FULL)).resolves.toEqual(DECISION);
  });

  it("reads JSON inside a code fence", async () => {
    await expect(classify("```json\n" + FULL + "\n```")).resolves.toEqual(
      DECISION,
    );
  });

  it("reads the first JSON object inside prose", async () => {
    await expect(
      classify(
        `Sure! Here is my pick: ${FULL} Hope that helps {"expression": "sad"}`,
      ),
    ).resolves.toEqual(DECISION);
  });

  it("reads braces inside string values without losing the object", async () => {
    await expect(
      classify('{"expression": "a}b", "motion": null}', {
        expressions: ["a}b"],
        motions: {},
      }),
    ).resolves.toEqual({ expressionId: "a}b" });
  });

  it("coerces a numeric-string index to an integer", async () => {
    await expect(
      classify(
        '{"expression": null, "motion": {"group": "Idle", "index": "2"}}',
      ),
    ).resolves.toEqual({ motion: { group: "Idle", index: 2 } });
  });

  it("omits null and missing fields", async () => {
    await expect(
      classify('{"expression": null, "motion": null}'),
    ).resolves.toEqual({});
    await expect(classify('{"expression": "sad"}')).resolves.toEqual({
      expressionId: "sad",
    });
    await expect(classify("{}")).resolves.toEqual({});
  });

  it("rejects a reply with no JSON object", async () => {
    await expect(classify("I think happy fits.")).rejects.toThrow();
    await expect(classify('{"expression": "happy"')).rejects.toThrow();
  });
});
