import { describe, expect, it } from "vitest";
import type {
  LLMMessage,
  LLMToolCall,
  LLMToolResponse,
  ToolDefinition,
} from "@charivo/core";
import {
  SET_EXPRESSION_TOOL_NAME,
  buildAvatarControlInstructions,
  createAvatarControlTools,
} from "@charivo/avatar";
import { createOpenAILLMProvider } from "@charivo/llm/openai";
import { createGeminiLLMProvider } from "@charivo/llm/gemini";
import { SMOKE_AVATAR_CATALOG } from "../avatar-catalog";

// Live contract check for the server-side LLM providers, one provider at a
// time and without the browser chain: each case calls the provider class
// directly against the vendor API, so it proves what the SDK-mocked unit tests
// cannot — that the request shape the provider builds is one the vendor
// accepts. The avatar tool round trip is the leg that matters most: the tool
// results are resent exactly as LLMManager resends them, which on Gemini is
// the thought-signature placeholder path.

const RUN_LIVE_LLM_TESTS = process.env.RUN_LIVE_LLM_TESTS === "1";
// Each provider gives a request 30 s before mapping it to CharivoTimeoutError.
// The budgets below are sized per provider call, so a slow-but-successful call
// (Gemini was measured at ~1 s with one 29 s outlier) cannot trip a test before
// the provider's own timeout does.
const PROVIDER_TIMEOUT_MS = 30_000;
const SINGLE_CALL_TEST_TIMEOUT_MS = PROVIDER_TIMEOUT_MS + 10_000;
// LLMManager keeps looping while the model keeps calling tools. The smoke
// instructions ask for one expression before speaking, but OpenAI was measured
// spending a second round on playMotion before it spoke, so allow one more.
const MAX_TOOL_ROUNDS = 4;
const TOOL_LOOP_TEST_TIMEOUT_MS =
  MAX_TOOL_ROUNDS * PROVIDER_TIMEOUT_MS + 10_000;

interface LiveProvider {
  generateResponse(
    messages: Array<{ role: string; content: string }>,
  ): Promise<string>;
  generateResponseWithTools(
    messages: LLMMessage[],
    tools: ToolDefinition[],
  ): Promise<LLMToolResponse>;
}

interface ProviderCase {
  name: string;
  envKey: "OPENAI_API_KEY" | "GEMINI_API_KEY";
  create(apiKey: string): LiveProvider;
}

const PROVIDERS: ProviderCase[] = [
  {
    name: "openai",
    envKey: "OPENAI_API_KEY",
    create: (apiKey) => createOpenAILLMProvider({ apiKey }),
  },
  {
    name: "gemini",
    envKey: "GEMINI_API_KEY",
    create: (apiKey) => createGeminiLLMProvider({ apiKey }),
  },
];

const PERSONA =
  "You are Hiyori, a cheerful character. Keep every reply to one short sentence.";

const AVATAR_TOOLS: ToolDefinition[] = createAvatarControlTools(
  SMOKE_AVATAR_CATALOG,
).map((registration) => registration.definition);

// The catalog's only expression is named verbatim so the tool leg is
// deterministic; the assertion below still only checks catalog membership.
const AVATAR_INSTRUCTIONS = [
  PERSONA,
  buildAvatarControlInstructions(SMOKE_AVATAR_CATALOG),
  "When the user greets you, call setExpression with Smile before you reply.",
].join("\n");

function toolResultFor(call: LLMToolCall): LLMMessage {
  return {
    role: "tool",
    toolCallId: call.id,
    content: JSON.stringify({ success: true, ...call.arguments }),
  };
}

for (const providerCase of PROVIDERS) {
  const apiKey = process.env[providerCase.envKey];
  const liveDescribe = RUN_LIVE_LLM_TESTS && apiKey ? describe : describe.skip;

  liveDescribe(`${providerCase.name} LLM provider (live)`, () => {
    const provider = providerCase.create(apiKey ?? "");

    it(
      "replies to a plain chat turn",
      async () => {
        const reply = await provider.generateResponse([
          { role: "system", content: PERSONA },
          { role: "user", content: "Say hello in one short sentence." },
        ]);

        console.log(`[live-llm] ${providerCase.name} plain: ${reply}`);
        expect(reply.trim().length).toBeGreaterThan(0);
      },
      SINGLE_CALL_TEST_TIMEOUT_MS,
    );

    it(
      "answers without tool calls when the tool list is empty",
      async () => {
        // An empty `tools` array is rejected by the vendor; the provider must
        // leave the parameter out entirely, which only a live call can prove.
        const response = await provider.generateResponseWithTools(
          [
            { role: "system", content: PERSONA },
            { role: "user", content: "Say hello in one short sentence." },
          ],
          [],
        );

        expect(response.content.trim().length).toBeGreaterThan(0);
        expect(response.toolCalls).toBeUndefined();
      },
      SINGLE_CALL_TEST_TIMEOUT_MS,
    );

    it(
      "calls setExpression and finishes the turn after the tool result",
      async () => {
        const messages: LLMMessage[] = [
          { role: "system", content: AVATAR_INSTRUCTIONS },
          { role: "user", content: "Hi there!" },
        ];

        const first = await provider.generateResponseWithTools(
          messages,
          AVATAR_TOOLS,
        );
        const firstCalls = first.toolCalls ?? [];
        console.log(
          `[live-llm] ${providerCase.name} round 1 calls: ${JSON.stringify(firstCalls)}`,
        );

        expect(firstCalls.length).toBeGreaterThan(0);
        const expressionCall = firstCalls.find(
          (call) => call.name === SET_EXPRESSION_TOOL_NAME,
        );
        expect(expressionCall, "no setExpression call was made").toBeDefined();
        expect(SMOKE_AVATAR_CATALOG.expressions).toContain(
          expressionCall?.arguments.expressionId,
        );

        // Resend the history exactly as LLMManager does — the assistant turn
        // with its tool calls, then one tool result per call — until the model
        // speaks without asking for more tools.
        let latest = first;
        let rounds = 1;
        while ((latest.toolCalls?.length ?? 0) > 0) {
          expect(rounds, "model kept calling tools").toBeLessThan(
            MAX_TOOL_ROUNDS,
          );
          messages.push({
            role: "assistant",
            content: latest.content,
            toolCalls: latest.toolCalls,
          });
          for (const call of latest.toolCalls ?? []) {
            messages.push(toolResultFor(call));
          }

          latest = await provider.generateResponseWithTools(
            messages,
            AVATAR_TOOLS,
          );
          rounds += 1;
        }

        console.log(
          `[live-llm] ${providerCase.name} final after ${rounds} rounds: ${latest.content}`,
        );
        expect(latest.content.trim().length).toBeGreaterThan(0);
      },
      TOOL_LOOP_TEST_TIMEOUT_MS,
    );
  });
}
