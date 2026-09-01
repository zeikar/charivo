import type { ReactNode } from "react";

type NoticeTone = "warning" | "error";

type NoticeBarProps = {
  tone: NoticeTone;
  /** "status" for something the demo did on purpose, "alert" for a failure. */
  role: "status" | "alert";
  icon: ReactNode;
  message: ReactNode;
  onDismiss: () => void;
};

// Tailwind only emits classes it can read as whole literals in the source, so a
// tone picks between complete class names here rather than composing them from
// fragments like `border-${tone}-200`.
const TONE_CLASSES: Record<NoticeTone, { bar: string; dismiss: string }> = {
  warning: {
    bar: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200",
    dismiss:
      "text-amber-700 hover:text-amber-950 dark:text-amber-300/70 dark:hover:text-amber-100",
  },
  error: {
    bar: "border-red-200 bg-red-50 text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200",
    dismiss:
      "text-red-700 hover:text-red-950 dark:text-red-300/70 dark:hover:text-red-100",
  },
};

/**
 * The dismissible bar that sits between the character and the chat input.
 *
 * `SessionCapNotice` and `RealtimeErrorNotice` render adjacent in `page.tsx` and
 * differ only in tone, icon, role and text, so they share this layout instead of
 * each keeping a copy — a restyle that reached one and not the other would be
 * visible on screen.
 */
export function NoticeBar({
  tone,
  role,
  icon,
  message,
  onDismiss,
}: NoticeBarProps) {
  const classes = TONE_CLASSES[tone];

  return (
    <div
      role={role}
      className={`mx-auto mb-2 flex w-full max-w-3xl items-start gap-2 rounded-2xl border px-3.5 py-2.5 text-[13px] leading-relaxed md:max-w-[42rem] ${classes.bar}`}
    >
      <span aria-hidden className="mt-px flex-shrink-0">
        {icon}
      </span>
      <p className="flex-1">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className={`flex-shrink-0 cursor-pointer rounded-full px-1.5 leading-none transition-colors ${classes.dismiss}`}
      >
        ✕
      </button>
    </div>
  );
}
