"use client";

import { useRef } from "react";

export function Captions({
  show,
  line,
  name,
}: {
  show: boolean;
  line: string;
  name: string;
}) {
  // Keep the last non-empty line so the caption fades out rather than blanking.
  const last = useRef("");
  if (!show) return null;
  if (line) last.current = line;
  return (
    <div className={"caption" + (line ? " in" : "")}>
      <span className="caption-name">{name}</span>
      <p className="caption-text">{last.current}</p>
    </div>
  );
}
