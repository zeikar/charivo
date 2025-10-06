import type { ChatMessage } from "../../types/chat";

type MessageBubblesProps = {
  messages: ChatMessage[];
  isLoading: boolean;
};

export function MessageBubbles({ messages, isLoading }: MessageBubblesProps) {
  const characterMessages = messages.filter((msg) => msg.type === "character");
  const visibleMessages = characterMessages.slice(-5);

  return (
    <div className="absolute top-20 left-6 md:left-8 z-10 space-y-3">
      {visibleMessages.map((message, index, arr) => {
        const opacity =
          arr.length === 1 ? 1 : 0.3 + (index / (arr.length - 1)) * 0.7;
        return (
          <div key={message.id} style={{ opacity }}>
            <div className="relative inline-block px-5 py-3 rounded-2xl shadow-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white border border-gray-200 dark:border-gray-600 max-w-md">
              <div className="absolute right-0 top-4 w-0 h-0 -mr-2 border-t-[8px] border-t-transparent border-l-[12px] border-l-white dark:border-l-gray-700 border-b-[8px] border-b-transparent" />
              <p className="text-sm">{message.content}</p>
            </div>
          </div>
        );
      })}

      {isLoading && (
        <div className="relative inline-block px-5 py-5 rounded-2xl shadow-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white border border-gray-200 dark:border-gray-600">
          <div className="absolute right-0 top-4 w-0 h-0 -mr-2 border-t-[8px] border-t-transparent border-l-[12px] border-l-white dark:border-l-gray-700 border-b-[8px] border-b-transparent" />
          <div className="flex items-center space-x-1.5">
            <div className="w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce" />
            <div
              className="w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce"
              style={{ animationDelay: "0.15s" }}
            />
            <div
              className="w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce"
              style={{ animationDelay: "0.3s" }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
