import type { ChatMessage } from "../../types/chat";

type ChatMessageListProps = {
  messages: ChatMessage[];
  isLoading: boolean;
};

function formatTimestamp(timestamp: Date | number | string) {
  if (timestamp instanceof Date) {
    return timestamp.toLocaleTimeString();
  }

  const date =
    typeof timestamp === "number" ? new Date(timestamp) : new Date(timestamp);
  return date.toLocaleTimeString();
}

export function ChatMessageList({ messages, isLoading }: ChatMessageListProps) {
  return (
    <div className="p-3 space-y-3 min-h-full">
      {messages.length === 0 && !isLoading && (
        <div className="text-center text-gray-500 dark:text-gray-400 flex flex-col justify-center h-full min-h-[300px]">
          <div className="text-3xl mb-3">🚀</div>
          <p className="text-base font-medium mb-2">
            Ready to explore Charivo!
          </p>
          <p className="text-xs max-w-sm mx-auto">
            Start a conversation with Hiyori to see Live2D animations, AI
            responses, and voice synthesis in action
          </p>
        </div>
      )}

      {messages.map((message) => (
        <div
          key={message.id}
          className={`flex ${message.type === "user" ? "justify-end" : "justify-start"}`}
        >
          <div className="max-w-[75%]">
            {message.type !== "user" && message.character && (
              <div className="flex items-center space-x-2 mb-1">
                <div className="w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center">
                  <span className="text-xs text-white font-bold">H</span>
                </div>
                <span className="text-xs font-semibold text-purple-600 dark:text-purple-400">
                  {message.character.name}
                </span>
              </div>
            )}
            <div
              className={`px-4 py-3 rounded-lg ${
                message.type === "user"
                  ? "bg-blue-500 text-white rounded-br-none"
                  : "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-white rounded-bl-none"
              }`}
            >
              <div className="text-sm leading-relaxed">{message.content}</div>
              <div className="text-xs opacity-70 mt-1">
                {formatTimestamp(message.timestamp)}
              </div>
            </div>
          </div>
        </div>
      ))}

      {isLoading && (
        <div className="flex justify-start">
          <div className="max-w-[75%]">
            <div className="flex items-center space-x-2 mb-1">
              <div className="w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center">
                <span className="text-xs text-white font-bold">H</span>
              </div>
              <span className="text-xs font-semibold text-purple-600 dark:text-purple-400">
                Hiyori
              </span>
            </div>
            <div className="bg-gray-100 dark:bg-gray-700 rounded-lg rounded-bl-none px-4 py-3">
              <div className="flex space-x-1">
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" />
                <div
                  className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"
                  style={{ animationDelay: "0.1s" }}
                />
                <div
                  className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"
                  style={{ animationDelay: "0.2s" }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
