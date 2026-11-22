import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { MAX_NAME_LENGTH, MAX_TEXT_LENGTH } from "../../director";
import type { VtuberShow } from "../hooks/useVtuberShow";
import { HARU_CHARACTER } from "../lib/character";
import {
  buildTranscript,
  describeDecision,
  type ShowLog,
  type TranscriptItem,
} from "../lib/show-log";
import { FOCUS_RING } from "./focus-ring";

const FIELD =
  "rounded-lg border border-gray-200 bg-white px-3 py-2 text-base text-gray-800 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 sm:text-sm";

// No blue: that is the character's color.
const VIEWER_COLORS = [
  "text-teal-600",
  "text-purple-600",
  "text-orange-600",
  "text-emerald-700",
  "text-pink-600",
];

const DEFAULT_VIEWER = "guest";

// The same viewer keeps the same color across messages and shows.
function viewerColor(viewer: string): string {
  let hash = 0;
  for (const char of viewer) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return VIEWER_COLORS[Math.abs(hash) % VIEWER_COLORS.length];
}

function decisionStyle(item: Extract<TranscriptItem, { kind: "viewer" }>) {
  if (item.decision.kind === "ignore") return "bg-gray-100 text-gray-500";
  if (item.decision.kind === "interrupt") return "bg-red-50 text-red-700";
  return "bg-blue-50 text-blue-700";
}

function Badge({
  className,
  children,
}: {
  className: string;
  children: string;
}) {
  return (
    <span
      className={`mr-1.5 inline-block rounded-full px-2 py-0.5 align-[1px] text-[11px] font-medium ${className}`}
    >
      {children}
    </span>
  );
}

function CharacterLine({
  item,
}: {
  item: Extract<TranscriptItem, { kind: "character" }>;
}) {
  return (
    <>
      <span className="mr-2 font-semibold text-blue-600">
        {HARU_CHARACTER.name}
      </span>
      {item.status === "cancelled" && (
        <Badge className="bg-amber-50 text-amber-700">Cut</Badge>
      )}
      {item.status === "failed" && (
        <Badge className="bg-red-50 text-red-700">Failed</Badge>
      )}
      {item.status === "speaking" ? (
        <span aria-hidden className="text-gray-400">
          …
        </span>
      ) : item.text ? (
        <span className="text-gray-800">{item.text}</span>
      ) : (
        <span className="italic text-gray-400">No reply</span>
      )}
    </>
  );
}

type ChatPanelProps = {
  log: ShowLog;
  canSend: boolean;
  onSend: VtuberShow["submitChat"];
};

export function ChatPanel({ log, canSend, onSend }: ChatPanelProps) {
  const [viewer, setViewer] = useState(DEFAULT_VIEWER);
  const [text, setText] = useState("");
  const [highlighted, setHighlighted] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  // Follows new messages only while the reader is at the bottom, so scrolling
  // up to read is not yanked back down.
  const followRef = useRef(true);
  const ids = useId();

  const transcript = useMemo(() => buildTranscript(log), [log]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && followRef.current) list.scrollTop = list.scrollHeight;
  }, [transcript]);

  const canSubmit = canSend && text.trim() !== "";

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    onSend({
      viewer: viewer.trim() || DEFAULT_VIEWER,
      text: text.trim(),
      highlighted,
    });
    setText("");
    setHighlighted(false);
    followRef.current = true;
  };

  return (
    <section
      aria-label="Stream chat"
      className="flex h-[28rem] min-w-0 flex-col rounded-xl border border-gray-200 bg-white lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:h-auto"
    >
      <h2 className="border-b border-gray-200 px-4 py-3 text-base font-semibold text-gray-900">
        Stream chat
      </h2>

      {/* h-0 with flex-1: the list takes the space left over and scrolls,
          instead of its content stretching the page grid's rows. */}
      <div
        ref={listRef}
        role="log"
        aria-label="Chat messages"
        tabIndex={0}
        onScroll={(event) => {
          const list = event.currentTarget;
          followRef.current =
            list.scrollHeight - list.scrollTop - list.clientHeight < 24;
        }}
        className={`h-0 min-h-0 flex-1 overflow-y-auto px-4 py-3 ${FOCUS_RING} focus-visible:ring-inset focus-visible:ring-offset-0`}
      >
        {transcript.length === 0 ? (
          <p className="text-sm text-gray-500">No chat yet.</p>
        ) : (
          <ol className="space-y-2.5 text-sm leading-relaxed">
            {transcript.map((item) => (
              <li
                key={item.key}
                className={
                  item.kind === "viewer" && item.highlighted
                    ? "-mx-2 rounded-lg bg-amber-50 px-2 py-1"
                    : undefined
                }
              >
                {item.kind === "viewer" ? (
                  <>
                    <span
                      className={`mr-2 font-semibold ${viewerColor(item.viewer)}`}
                    >
                      {item.viewer}
                    </span>
                    {item.highlighted && (
                      <Badge className="bg-amber-100 text-amber-800">
                        Super chat
                      </Badge>
                    )}
                    <Badge className={decisionStyle(item)}>
                      {describeDecision(item.decision)}
                    </Badge>
                    <span className="text-gray-800">{item.text}</span>
                  </>
                ) : (
                  <CharacterLine item={item} />
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-2 border-t border-gray-200 px-3 py-3"
      >
        <div className="flex items-center gap-3">
          <label htmlFor={`${ids}-viewer`} className="sr-only">
            Viewer name
          </label>
          <input
            id={`${ids}-viewer`}
            type="text"
            value={viewer}
            onChange={(event) => setViewer(event.target.value)}
            placeholder={DEFAULT_VIEWER}
            maxLength={MAX_NAME_LENGTH}
            autoComplete="off"
            className={`w-32 min-w-0 ${FIELD}`}
          />
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={highlighted}
              onChange={(event) => setHighlighted(event.target.checked)}
              className={`h-4 w-4 cursor-pointer rounded border-gray-300 accent-blue-600 ${FOCUS_RING}`}
            />
            Super chat
          </label>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor={`${ids}-text`} className="sr-only">
            Message
          </label>
          <input
            id={`${ids}-text`}
            type="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Type a message"
            maxLength={MAX_TEXT_LENGTH}
            autoComplete="off"
            aria-describedby={`${ids}-hint`}
            className={`min-w-0 flex-1 ${FIELD}`}
          />
          <button
            type="submit"
            disabled={!canSubmit}
            className={`cursor-pointer rounded-full bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:from-blue-600 hover:to-blue-700 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
          >
            Send
          </button>
        </div>
        <p id={`${ids}-hint`} className="text-xs text-gray-500">
          {canSend
            ? "Press Enter to send."
            : "Chat opens while the show is running."}
        </p>
      </form>
    </section>
  );
}
