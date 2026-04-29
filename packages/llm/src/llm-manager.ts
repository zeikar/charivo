import { LLMClient, Message, Character, toCharivoError } from "@charivo/core";
import { MessageHistoryManager } from "./message-history-manager";
import { CharacterPromptBuilder } from "./character-prompt-builder";
import { MessageConverter } from "./message-converter";
import { LLMValidators } from "./validators";
import { ResponseMessageBuilder } from "./response-message-builder";

const DEFAULT_MAX_HISTORY_TURNS = 40;

export interface LLMManagerOptions {
  maxHistoryTurns?: number | null;
}

/**
 * LLM Manager - LLM 세션의 상태 관리를 담당하는 클래스
 *
 * 역할:
 * - 캐릭터 설정 및 관리
 * - 메시지 히스토리 관리
 * - LLM 클라이언트와의 통신
 * - 메시지 형식 변환
 * - 프롬프트 생성
 */
export class LLMManager {
  private readonly historyManager: MessageHistoryManager;
  private readonly maxHistoryMessages?: number;
  private character: Character | null = null;

  constructor(
    private llmClient: LLMClient,
    options: LLMManagerOptions = {},
  ) {
    this.maxHistoryMessages = resolveMaxHistoryMessages(options);
    this.historyManager = new MessageHistoryManager({
      maxMessages: this.maxHistoryMessages,
      pruneBatchSize: 2,
    });
  }

  /**
   * 캐릭터 설정
   * 캐릭터가 변경되는 경우에만 히스토리를 초기화합니다.
   */
  setCharacter(character: Character): void {
    // 캐릭터가 변경되는 경우에만 히스토리 초기화
    if (this.character?.id !== character.id) {
      this.historyManager.clear();
    }
    this.character = character;
  }

  /**
   * 현재 설정된 캐릭터 반환
   */
  getCharacter(): Character | null {
    return this.character;
  }

  /**
   * 히스토리 초기화
   */
  clearHistory(): void {
    this.historyManager.clear();
  }

  /**
   * 현재 히스토리 반환
   */
  getHistory(): Message[] {
    return this.historyManager.getAll();
  }

  /**
   * 메시지 응답 생성
   */
  async generateResponse(message: Message): Promise<string> {
    try {
      LLMValidators.validateCharacterSet(this.character);
      LLMValidators.validateMessage(message);
    } catch (error) {
      throw toCharivoError("state", error);
    }

    // Defer pruning until the assistant message is appended. On failure we
    // only removeLast() the in-flight user message, so older history must
    // remain intact during the API call.
    this.historyManager.add(message, { prune: false });

    // 히스토리 메시지 가져오기
    const historyMessages = this.getHistoryForApiCall();

    // LLM API 형식으로 변환 (시스템 프롬프트 포함)
    const apiMessages = this.prepareApiMessages(historyMessages);

    try {
      // LLM 클라이언트를 통해 응답 생성
      const assistantMessage = await this.llmClient.call(apiMessages);

      // AI 응답 메시지 생성 및 히스토리에 추가
      const responseMessage = ResponseMessageBuilder.create(
        assistantMessage,
        this.character!.id, // validateCharacterSet 후 character는 non-null 보장됨
      );
      this.historyManager.add(responseMessage, { prune: false });
      this.historyManager.pruneToMax();

      return assistantMessage;
    } catch (error) {
      // 에러가 발생하면 마지막 메시지를 히스토리에서 제거
      this.historyManager.removeLast();
      throw toCharivoError("provider", error);
    }
  }

  /**
   * LLM API 호출을 위한 메시지 준비
   */
  private prepareApiMessages(
    messages: Message[],
  ): Array<{ role: string; content: string }> {
    if (!this.character) {
      return MessageConverter.toOpenAIFormat(messages);
    }

    const systemPrompt = CharacterPromptBuilder.buildSystemPrompt(
      this.character,
    );
    return MessageConverter.combineWithSystemPrompt(systemPrompt, messages);
  }

  private getHistoryForApiCall(): Message[] {
    const historyMessages = this.historyManager.getRecent(
      this.maxHistoryMessages,
    );

    if (historyMessages[0]?.type === "character") {
      return historyMessages.slice(1);
    }

    return historyMessages;
  }
}

/**
 * LLM Manager 생성 헬퍼 함수
 */
export function createLLMManager(
  llmClient: LLMClient,
  options?: LLMManagerOptions,
): LLMManager {
  return new LLMManager(llmClient, options);
}

function resolveMaxHistoryMessages(
  options: LLMManagerOptions,
): number | undefined {
  if (options.maxHistoryTurns === null) {
    return undefined;
  }

  const maxHistoryTurns = options.maxHistoryTurns ?? DEFAULT_MAX_HISTORY_TURNS;

  if (!Number.isInteger(maxHistoryTurns) || maxHistoryTurns <= 0) {
    throw new TypeError("maxHistoryTurns must be a positive integer or null");
  }

  return maxHistoryTurns * 2;
}
