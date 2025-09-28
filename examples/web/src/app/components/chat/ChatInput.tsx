import type { ChangeEvent, KeyboardEvent } from "react";

type ChatInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onKeyPress: (event: KeyboardEvent<HTMLInputElement>) => void;
  disabled: boolean;
};

export function ChatInput({
  value,
  onChange,
  onSend,
  onKeyPress,
  disabled,
}: ChatInputProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.value);
  };

  return (
    <div className="border-t dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-700">
      <div className="flex space-x-2">
        <input
          type="text"
          value={value}
          onChange={handleChange}
          onKeyPress={onKeyPress}
          placeholder="Experience Charivo framework - type your message..."
          className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 text-sm"
          disabled={disabled}
        />
        <button
          type="button"
          onClick={onSend}
          disabled={disabled || !value.trim()}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 font-medium text-sm"
        >
          {disabled ? "..." : "Send"}
        </button>
      </div>
    </div>
  );
}
