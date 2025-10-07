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
            <div className="relative inline-block px-5 py-3 rounded-2xl shadow-md bg-white dark:bg-gray-700 text-gray-800 dark:text-white border border-gray-300 dark:border-gray-600 max-w-md">
              <p className="text-sm">{message.content}</p>
              {/* Tail with border */}
              <div className="absolute top-[12px] -right-[10px]">
                {/* Outer triangle (border) */}
                <div className="w-0 h-0 border-l-[10px] border-l-gray-300 dark:border-l-gray-600 border-t-[7px] border-t-transparent border-b-[7px] border-b-transparent" />
                {/* Inner triangle (fill) */}
                <div className="absolute top-0 left-0 w-0 h-0 border-l-[9px] border-l-white dark:border-l-gray-700 border-t-[7px] border-t-transparent border-b-[7px] border-b-transparent translate-x-[-1px]" />
              </div>
            </div>
          </div>
        );
      })}

      {isLoading && (
        <div className="relative inline-block px-5 py-5 rounded-2xl shadow-md bg-white dark:bg-gray-700 text-gray-800 dark:text-white border border-gray-300 dark:border-gray-600">
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
          {/* Tail with border */}
          <div className="absolute top-[16px] -right-[10px]">
            {/* Outer triangle (border) */}
            <div className="w-0 h-0 border-l-[10px] border-l-gray-300 dark:border-l-gray-600 border-t-[7px] border-t-transparent border-b-[7px] border-b-transparent" />
            {/* Inner triangle (fill) */}
            <div className="absolute top-0 left-0 w-0 h-0 border-l-[9px] border-l-white dark:border-l-gray-700 border-t-[7px] border-t-transparent border-b-[7px] border-b-transparent translate-x-[-1px]" />
          </div>
        </div>
      )}
    </div>
  );
}
