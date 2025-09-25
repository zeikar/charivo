import React from "react";
import type { Character, Message } from "@charivo/core";

export interface CharacterProps {
  character: Character;
  className?: string;
}

export function CharacterAvatar({ character, className }: CharacterProps) {
  return (
    <div className={`character-avatar ${className || ""}`}>
      {character.avatar ? (
        <img src={character.avatar} alt={character.name} />
      ) : (
        <div className="avatar-placeholder">
          {character.name.charAt(0).toUpperCase()}
        </div>
      )}
    </div>
  );
}

export interface MessageBubbleProps {
  message: Message;
  character?: Character;
  className?: string;
}

export function MessageBubble({
  message,
  character,
  className,
}: MessageBubbleProps) {
  const isUser = message.type === "user";

  return (
    <div
      className={`message-bubble ${isUser ? "user" : "character"} ${className || ""}`}
    >
      {!isUser && character && (
        <CharacterAvatar character={character} className="message-avatar" />
      )}
      <div className="message-content">
        <p>{message.content}</p>
        <time className="message-timestamp">
          {message.timestamp.toLocaleTimeString()}
        </time>
      </div>
    </div>
  );
}

export interface ChatInterfaceProps {
  messages: Message[];
  character?: Character;
  onSendMessage?: (content: string) => void;
  className?: string;
}

export function ChatInterface({
  messages,
  character,
  onSendMessage,
  className,
}: ChatInterfaceProps) {
  const [input, setInput] = React.useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && onSendMessage) {
      onSendMessage(input.trim());
      setInput("");
    }
  };

  return (
    <div className={`chat-interface ${className || ""}`}>
      <div className="messages-container">
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            character={character}
          />
        ))}
      </div>

      <form onSubmit={handleSubmit} className="message-input-form">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          className="message-input"
        />
        <button type="submit" className="send-button">
          Send
        </button>
      </form>
    </div>
  );
}
