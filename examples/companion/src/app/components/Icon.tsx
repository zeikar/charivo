type IconName =
  | "settings"
  | "close"
  | "trash"
  | "plus"
  | "mic"
  | "edit"
  | "spark";

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const p = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (name === "settings")
    return (
      <svg {...p}>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2.5v2.6M12 18.9v2.6M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12h2.6M18.9 12h2.6M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8" />
      </svg>
    );
  if (name === "close")
    return (
      <svg {...p}>
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    );
  if (name === "trash")
    return (
      <svg {...p}>
        <path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13" />
      </svg>
    );
  if (name === "plus")
    return (
      <svg {...p}>
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  if (name === "mic")
    return (
      <svg {...p}>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
    );
  if (name === "edit")
    return (
      <svg {...p}>
        <path d="M4 20h4l10-10-4-4L4 16v4zM14 6l4 4" />
      </svg>
    );
  if (name === "spark")
    return (
      <svg {...p}>
        <path d="M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3z" />
      </svg>
    );
  return null;
}
