/**
 * LIVE, PAID, NON-DETERMINISTIC generation — do NOT run without OPENAI_API_KEY.
 *
 * Capture half of a Claude-as-judge persona-hook eval:
 *   1. Compose persona-relevant session instruction blocks (avatar OMITTED — browser-only).
 *   2. Drive each scenario × user-turn pair through a text LLM (TEXT PROXY — gpt-4o-mini
 *      stands in for the voice-native gpt-realtime-mini; advisory only, not a voice fidelity
 *      test).
 *   3. Write one Markdown artifact per run so the human/Claude judge can compare low vs warm
 *      responses side-by-side.
 *
 * The judge is Claude (or a human) reading the artifact — NOT any code in this file.
 */

import OpenAI from "openai";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderPersonaInstructions } from "../../app/lib/persona";
import { buildSessionInstructions } from "../../app/lib/build-session-instructions";
import { getCharacterById } from "../../app/lib/character-catalog";
import { COMPANION_DEMO_GUIDANCE } from "../../app/lib/demo-guidance";
import { renderRelationshipBlock } from "../../memory/render-memory";
import { renderSituationalContext } from "../../app/lib/situational-context";
import {
  PERSONA_SCENARIOS,
  USER_TURNS,
  PAIR_SETS,
  NOW,
  validateScenarioBuckets,
  type PersonaScenario,
} from "./__fixtures__/persona-scenarios";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CaptureRecord {
  scenarioId: string;
  characterId: string;
  bucketLabel: "low" | "warm";
  hookKey: string;
  hook: string;
  userTurn: string;
  systemPrompt: string;
  response: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compose the scenario's system prompt by mirroring the live session seam.
 * avatarBlock: "" — browser-only tool listing; would need a fabricated render
 *   catalog + dynamic @charivo/realtime-avatar import; irrelevant to persona TONE.
 * memoryBlock: "" — these scenarios seed relationship state, not facts.
 * PURE: no network, no clock reads (now is injected).
 */
function composeScenarioPrompt(scenario: PersonaScenario, now: number): string {
  const character = getCharacterById(scenario.characterId);
  const persona = renderPersonaInstructions(character, scenario.state, { now });
  const relationshipBlock = renderRelationshipBlock(scenario.state, { now });
  const situationalBlock = renderSituationalContext(new Date(now));
  return buildSessionInstructions({
    persona,
    userNameBlock: null,
    demoGuidance: COMPANION_DEMO_GUIDANCE,
    avatarBlock: "",
    memoryBlock: "",
    relationshipBlock,
    situationalBlock,
  });
}

/**
 * Call the chat completions API for a single (systemPrompt, userTurn) pair.
 * Client is constructed ONCE by runCapture — NOT per call.
 * On error, wraps-and-rethrows with context (no silent swallow).
 */
async function generateCandidate(
  client: OpenAI,
  args: {
    model: string;
    systemPrompt: string;
    userTurn: string;
    scenarioId: string;
  },
): Promise<string> {
  try {
    const resp = await client.chat.completions.create({
      model: args.model,
      temperature: 0,
      max_tokens: 120,
      messages: [
        { role: "system", content: args.systemPrompt },
        { role: "user", content: args.userTurn },
      ],
    });
    const content = (resp.choices[0]?.message?.content ?? "").trim();
    if (content === "") {
      const finishReason = resp.choices[0]?.finish_reason ?? "unknown";
      throw new Error(
        `[eval] persona generation returned empty for ${args.scenarioId} (finish_reason: ${finishReason})`,
      );
    }
    return content;
  } catch (err) {
    throw new Error(
      `[eval] persona generation failed for ${args.scenarioId}: ${String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Artifact writer
// ---------------------------------------------------------------------------

// ESM-safe; resolves to examples/companion/.eval-runs/persona/ (three levels up
// from src/eval/persona/).
const DEFAULT_OUT_DIR = fileURLToPath(
  new URL("../../../.eval-runs/persona/", import.meta.url),
);

/**
 * Write one Markdown artifact for the run. Returns the resolved file path.
 * Groups responses by PAIR_SETS: each section shows low vs warm side-by-side
 * per (character × user turn), with a <details> dump of the full system prompt
 * so the judge can see DIRECTIVE vs persona-hook overlap.
 */
export function writeArtifact(args: {
  runStartedAt: string;
  model: string;
  records: CaptureRecord[];
}): string {
  mkdirSync(DEFAULT_OUT_DIR, { recursive: true });

  const filename = `persona-${args.runStartedAt.replace(/[:.]/g, "-")}.md`;
  const filePath = `${DEFAULT_OUT_DIR}${filename}`;

  const lines: string[] = [];

  lines.push(`# Persona Eval Capture — ${args.runStartedAt}`);
  lines.push("");
  lines.push(`**Generation model:** ${args.model}`);
  lines.push("");
  lines.push(
    "> **TEXT-PROXY CAVEAT:** responses are generated by a text LLM (`gpt-4o-mini`",
    "> or `$PERSONA_EVAL_MODEL`), NOT the voice-native `gpt-realtime-mini`. This is",
    "> a text stand-in for voice; treat findings as advisory, not as voice fidelity.",
  );
  lines.push("");
  lines.push(
    "> **How to judge:** see `docs/history/persona-eval-2026-06.md` for scoring rubric.",
  );
  lines.push("");
  lines.push("---");
  lines.push("");

  // Index records by (scenarioId, userTurn) for quick lookup.
  const byKey = new Map<string, CaptureRecord>();
  for (const rec of args.records) {
    byKey.set(`${rec.scenarioId}::${rec.userTurn}`, rec);
  }

  for (const pair of PAIR_SETS) {
    const character = getCharacterById(pair.characterId);
    lines.push(`## Character: ${character.name} (\`${pair.characterId}\`)`);
    lines.push("");

    for (const userTurn of USER_TURNS) {
      lines.push(`### User turn: "${userTurn}"`);
      lines.push("");

      for (const scenarioId of [pair.lowScenarioId, pair.warmScenarioId]) {
        const rec = byKey.get(`${scenarioId}::${userTurn}`);
        if (!rec) {
          lines.push(`> _[no record for \`${scenarioId}\` — skipped]_`);
          lines.push("");
          continue;
        }

        const label =
          rec.bucketLabel === "low" ? "LOW rapport" : "WARM rapport";
        lines.push(`#### ${label} (\`${scenarioId}\`)`);
        lines.push("");
        lines.push(`**Bucket label:** ${rec.bucketLabel}`);
        lines.push(`**Hook key:** \`${rec.hookKey}\``);
        lines.push(`**Injected hook:** ${rec.hook || "_none_"}`);
        lines.push("");
        lines.push(`**Response:**`);
        lines.push("");
        lines.push(`> ${rec.response.split("\n").join("\n> ")}`);
        lines.push("");
        lines.push("<details>");
        lines.push("<summary>System prompt (full)</summary>");
        lines.push("");
        lines.push("```");
        lines.push(rec.systemPrompt);
        lines.push("```");
        lines.push("");
        lines.push("</details>");
        lines.push("");
      }
    }

    lines.push("---");
    lines.push("");
  }

  writeFileSync(filePath, lines.join("\n"));
  return filePath;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run the full persona capture for all scenarios × user turns.
 * Sequential generation (not Promise.all) for predictable cost/rate-limit
 * and stable artifact ordering.
 */
export async function runCapture(): Promise<{
  artifactPath: string;
  recordCount: number;
}> {
  // Validate scenario bucket consistency before spending on API calls.
  validateScenarioBuckets();

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("[eval] persona capture requires OPENAI_API_KEY");
  }

  // Client constructed ONCE — threaded into generateCandidate.
  const client = new OpenAI({ apiKey });

  // Resolve the generation model ONCE so the artifact header matches what
  // actually generated the responses (single source of truth).
  const model = process.env.PERSONA_EVAL_MODEL ?? "gpt-4o-mini";

  const records: CaptureRecord[] = [];

  for (const scenario of PERSONA_SCENARIOS) {
    const systemPrompt = composeScenarioPrompt(scenario, NOW);
    // Read the hook string lazily off the live catalog — reflects any catalog edits immediately.
    const hook =
      getCharacterById(scenario.characterId).persona?.stateHooks[
        scenario.expectedHookKey
      ] ?? "";

    for (const userTurn of USER_TURNS) {
      const response = await generateCandidate(client, {
        model,
        systemPrompt,
        userTurn,
        scenarioId: scenario.id,
      });

      records.push({
        scenarioId: scenario.id,
        characterId: scenario.characterId,
        bucketLabel: scenario.bucketLabel,
        hookKey: scenario.expectedHookKey,
        hook,
        userTurn,
        systemPrompt,
        response,
      });
    }
  }

  const artifactPath = writeArtifact({
    runStartedAt: new Date().toISOString(),
    model,
    records,
  });

  return { artifactPath, recordCount: records.length };
}
