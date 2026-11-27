import { describe, expect, it } from "vitest";
import { createSentenceSegmenter } from "../src/sentence-segmenter";

const texts = (segs: { text: string }[]) => segs.map((s) => s.text);

function run(chunks: string[]) {
  const seg = createSentenceSegmenter();
  const out = chunks.flatMap((c) => seg.push(c));
  return [...out, ...seg.flush()];
}

describe("sentence segmenter boundaries", () => {
  it("cuts after . ! ? … when whitespace follows", () => {
    expect(texts(run(["One. Two! Three? Four… Five"]))).toEqual([
      "One.",
      "Two!",
      "Three?",
      "Four…",
      "Five",
    ]);
  });

  it("keeps a closing quote or bracket with its sentence", () => {
    expect(texts(run(['He said "go." Then (left.) Done']))).toEqual([
      'He said "go."',
      "Then (left.)",
      "Done",
    ]);
  });

  it("cuts after 。！？ without whitespace", () => {
    expect(texts(run(["今日は。元気！本当？はい"]))).toEqual([
      "今日は。",
      "元気！",
      "本当？",
      "はい",
    ]);
  });

  it("treats a line break as a boundary", () => {
    expect(texts(run(["first line\nsecond line"]))).toEqual([
      "first line",
      "second line",
    ]);
  });

  it("does not cut 3.14 or e.g.x", () => {
    expect(texts(run(["Pi is 3.14 ok. See e.g.x here"]))).toEqual([
      "Pi is 3.14 ok.",
      "See e.g.x here",
    ]);
  });
});

describe("sentence segmenter chunking", () => {
  it("confirms a trailing terminator only when the next character arrives", () => {
    const seg = createSentenceSegmenter();
    expect(seg.push("Pi is 3.")).toEqual([]);
    expect(seg.push("14 ok")).toEqual([]);
    expect(texts(seg.flush())).toEqual(["Pi is 3.14 ok"]);
  });

  it("extends a terminator run across chunks", () => {
    const seg = createSentenceSegmenter();
    expect(seg.push("Wait..")).toEqual([]);
    expect(seg.push(". what")).toEqual([{ text: "Wait...", end: 7 }]);
    expect(texts(seg.flush())).toEqual(["what"]);
  });

  it("confirms a trailing terminator at flush", () => {
    const seg = createSentenceSegmenter();
    expect(seg.push("Done.")).toEqual([]);
    expect(texts(seg.flush())).toEqual(["Done."]);
  });

  it("emits a sentence split across three chunks once", () => {
    expect(texts(run(["Hel", "lo wor", "ld. Next"]))).toEqual([
      "Hello world.",
      "Next",
    ]);
  });
});

describe("sentence segmenter speakability and offsets", () => {
  it("joins a segment with no letter or digit to the next one", () => {
    expect(texts(run(["Hi. ... \n? Next one. "]))).toEqual([
      "Hi.",
      "... \n? Next one.",
    ]);
  });

  it("drops an unspeakable remainder at flush", () => {
    expect(run(["Hi. ..."])).toEqual([{ text: "Hi.", end: 3 }]);
  });

  it("carries the end offset of each span in the accumulated text", () => {
    const seg = createSentenceSegmenter();
    const first = seg.push("Hello there. How are");
    expect(first).toEqual([{ text: "Hello there.", end: 12 }]);
    const second = seg.push(" you?\nFine");
    expect(second).toEqual([{ text: "How are you?", end: 25 }]);
    expect(seg.flush()).toEqual([{ text: "Fine", end: 30 }]);
  });

  it("excludes trailing whitespace from end before a line break", () => {
    expect(run(["first line  \nx"])).toEqual([
      { text: "first line", end: 10 },
      { text: "x", end: 14 },
    ]);
    expect(run(["Hi\r\nNext"])[0]).toEqual({ text: "Hi", end: 2 });
  });

  it("measures a CJK offset in the accumulated text", () => {
    const seg = createSentenceSegmenter();
    seg.push("今日は。");
    expect(seg.push("元気")).toEqual([{ text: "今日は。", end: 4 }]);
  });

  it("starts clean after a flush", () => {
    const seg = createSentenceSegmenter();
    seg.push("One.");
    seg.flush();
    expect(seg.push("Two. x")).toEqual([{ text: "Two.", end: 4 }]);
  });

  it("ignores an empty chunk", () => {
    const seg = createSentenceSegmenter();
    expect(seg.push("")).toEqual([]);
    expect(seg.push("Hi. x")).toEqual([{ text: "Hi.", end: 3 }]);
    expect(seg.push("")).toEqual([]);
  });

  it("absorbs a closer that arrives in a later chunk", () => {
    const seg = createSentenceSegmenter();
    expect(seg.push("go.")).toEqual([]);
    expect(seg.push('"')).toEqual([]);
    expect(seg.push(" x")).toEqual([{ text: 'go."', end: 4 }]);
  });

  it("absorbs CJK closers into the sentence", () => {
    expect(texts(run(["「はい。」次"]))).toEqual(["「はい。」", "次"]);
  });

  it("absorbs repeated CJK terminators", () => {
    expect(texts(run(["本当？？はい"]))).toEqual(["本当？？", "はい"]);
  });
});
