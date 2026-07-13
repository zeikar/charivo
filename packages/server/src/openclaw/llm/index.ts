import OpenAI from "openai";
import { LLMProvider } from "@charivo/core";

/**
 * OpenClaw LLM Provider
 *
 * Server-side LLM provider using OpenClaw's OpenAI-compatible HTTP API.
 *
 * @see https://docs.openclaw.ai/gateway/openai-http-api
 */
export interface OpenClawLLMConfig {
  token: string;
  baseURL?: string;
  /**
   * Target a specific agent on the gateway.
   * When omitted, the gateway's configured default agent handles the request.
   */
  agentId?: string;
  /**
   * Agent target, not a backend model name. The gateway resolves this to an
   * agent: `openclaw`, `openclaw/default`, or `openclaw/<agentId>`.
   *
   * @default "openclaw/default"
   */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /**
   * Pins the conversation to a server-side session on the gateway.
   *
   * The gateway keeps conversation state itself, but without an identifier it
   * opens a fresh session per request: nothing is persisted between turns and
   * each one strands a throwaway session. Sending this as the `user` field makes
   * the gateway derive a stable session key from it.
   *
   * When set, past turns are not resent — the gateway already holds them. The
   * system prompt is still sent every turn so the persona survives a dropped
   * session.
   *
   * Treat it as a conversation-scoped identifier (e.g. a UUID per conversation,
   * rotated when the user resets the chat). Rotating it is the only way to reset
   * the conversation; the gateway keeps the old transcript under the old key.
   */
  sessionKey?: string;
  /**
   * Allow usage in browser (dangerous - exposes token)
   * Only use for testing/development
   */
  dangerouslyAllowBrowser?: boolean;
}

export class OpenClawLLMProvider implements LLMProvider {
  private openai: OpenAI;
  private model: string;
  private temperature: number;
  private maxTokens: number;
  private sessionKey?: string;

  constructor(config: OpenClawLLMConfig) {
    if (typeof window !== "undefined" && !config.dangerouslyAllowBrowser) {
      throw new Error(
        "OpenClaw LLM provider is for server-side use only. Set dangerouslyAllowBrowser: true for testing",
      );
    }

    this.openai = new OpenAI({
      apiKey: config.token,
      baseURL: config.baseURL || "http://127.0.0.1:18789/v1",
      defaultHeaders: config.agentId
        ? { "x-openclaw-agent-id": config.agentId }
        : undefined,
      dangerouslyAllowBrowser: config.dangerouslyAllowBrowser,
    });

    this.model = config.model || "openclaw/default";
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = config.maxTokens || 1000;
    this.sessionKey = config.sessionKey;
  }

  async generateResponse(
    messages: Array<{ role: string; content: string }>,
  ): Promise<string> {
    try {
      const openAIMessages = this.selectMessages(messages).map((msg) => ({
        role: msg.role as "system" | "user" | "assistant",
        content: msg.content,
      }));

      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: openAIMessages,
        temperature: this.temperature,
        max_tokens: this.maxTokens,
        ...(this.sessionKey ? { user: this.sessionKey } : {}),
      });

      return completion.choices[0]?.message?.content || "";
    } catch (error) {
      throw new Error(
        `OpenClaw LLM Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * With a pinned session the gateway already holds the past turns, and resending
   * them would flatten a duplicate copy of the history on top of its own. Keep the
   * system prompts (cheap persona insurance if the session was dropped) and the
   * latest turn.
   */
  private selectMessages(
    messages: Array<{ role: string; content: string }>,
  ): Array<{ role: string; content: string }> {
    const latest = messages[messages.length - 1];
    if (!this.sessionKey || !latest) {
      return messages;
    }

    const systemMessages = messages.filter((msg) => msg.role === "system");
    return latest.role === "system"
      ? systemMessages
      : [...systemMessages, latest];
  }
}

export function createOpenClawLLMProvider(
  config: OpenClawLLMConfig,
): OpenClawLLMProvider {
  return new OpenClawLLMProvider(config);
}
