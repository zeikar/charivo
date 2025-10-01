import type { KeyboardEvent } from "react";

import type {
  ChatMessage,
  LLMClientType,
  TTSPlayerType,
} from "../../types/chat";
import { ChatInput } from "./ChatInput";
import { ChatMessageList } from "./ChatMessageList";
import { ChatSettings } from "./ChatSettings";

type ChatPanelProps = {
  messages: ChatMessage[];
  isLoading: boolean;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onKeyPress: (event: KeyboardEvent<HTMLInputElement>) => void;
  selectedLLMClient: LLMClientType;
  onSelectLLMClient: (type: LLMClientType) => void;
  selectedTTSPlayer: TTSPlayerType;
  onSelectTTSPlayer: (type: TTSPlayerType) => void;
  llmError: string | null;
  ttsError: string | null;
};

export function ChatPanel({
  messages,
  isLoading,
  input,
  onInputChange,
  onSend,
  onKeyPress,
  selectedLLMClient,
  onSelectLLMClient,
  selectedTTSPlayer,
  onSelectTTSPlayer,
  llmError,
  ttsError,
}: ChatPanelProps) {
  return (
    <div className="lg:col-span-2 flex flex-col min-h-0">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden flex-1 flex flex-col min-h-0 max-h-full">
        <ChatSettings
          selectedLLMClient={selectedLLMClient}
          onSelectLLMClient={onSelectLLMClient}
          selectedTTSPlayer={selectedTTSPlayer}
          onSelectTTSPlayer={onSelectTTSPlayer}
          llmError={llmError}
          ttsError={ttsError}
        />

        <div className="flex-1 overflow-y-auto min-h-0">
          <ChatMessageList messages={messages} isLoading={isLoading} />
        </div>

        <ChatInput
          value={input}
          onChange={onInputChange}
          onSend={onSend}
          onKeyPress={onKeyPress}
          disabled={isLoading}
        />
      </div>
    </div>
  );
}
