import { useEffect, useRef, useState, type ReactNode } from "react";
import useBaseUrl, { useBaseUrlUtils } from "@docusaurus/useBaseUrl";
import type {
  AvatarControlCatalog,
  BuiltInTTSManager,
  Charivo,
  PerformanceHandle,
  RenderManager,
} from "@charivo/core";
import type { IkiRenderer, IkiView } from "@charivo/render-iki";
import {
  addClaim,
  endSpeech,
  pruneExpired,
  rankClaims,
  releaseSource,
  speechHold,
  startSpeech,
  type ClaimHold,
  type SentClaim,
} from "./claims";
import { createLinePlayer, LINES, type VoiceLine } from "./lines";
import styles from "./styles.module.css";

type CharacterId = "Twin" | "Mint";

// Mint's model is full body; here she is framed waist up so her face reads.
// Model units, centre and size, +y up: y 350 to 1950 runs from her waist to
// headroom above her hair (top ~1730), clear of the character switcher. The
// mouse gaze is measured from her face, as in examples/web's Mint config.
const MINT_VIEW: IkiView = { x: 0, y: 1150, width: 1100, height: 1600 };
const CHARACTERS: Record<
  CharacterId,
  { file: string; view?: IkiView; gazeOrigin?: { x: number; y: number } }
> = {
  Twin: { file: "/hero.iki", gazeOrigin: { x: 0.5, y: 0.431 } },
  Mint: {
    file: "/mint.iki",
    view: MINT_VIEW,
    gazeOrigin: { x: 0.5, y: 0.125 },
  },
};

// The web demo's Reactions: matched on id and description, so a model whose
// ids are opaque still gets them.
const REACTIONS = [
  {
    label: "Startle",
    pattern: /surpris|shock|startl|alarm/i,
    holdMs: 1500,
    gaze: { x: 0.6, y: 0.3 },
  },
  { label: "Blush", pattern: /shy|blush|embarrass/i, holdMs: 2000 },
];

const GAZE_PRESETS = [
  { label: "Left", x: -1, y: 0 },
  { label: "Center", x: 0, y: 0 },
  { label: "Right", x: 1, y: 0 },
  { label: "Up", x: 0, y: 1 },
  { label: "Down", x: 0, y: -1 },
];

interface Engine {
  charivo: Charivo;
  renderManager: RenderManager;
  renderer: IkiRenderer;
  tts: BuiltInTTSManager;
}

function findExpression(catalog: AvatarControlCatalog, pattern: RegExp) {
  return catalog.expressions.find(
    (id) =>
      pattern.test(id) ||
      pattern.test(catalog.expressionDescriptions?.[id] ?? ""),
  );
}

export default function Playground(): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [engine, setEngine] = useState<Engine>();
  const [character, setCharacter] = useState<CharacterId>("Twin");
  const [catalog, setCatalog] = useState<AvatarControlCatalog>();
  const [error, setError] = useState<string>();
  const [claims, setClaims] = useState<SentClaim[]>([]);
  const [now, setNow] = useState(() => performance.now());
  const [speaking, setSpeaking] = useState(false);
  const [playing, setPlaying] = useState<VoiceLine>();
  const [lineError, setLineError] = useState<string>();
  // The line whose audio is starting: its AI pick is claimed on
  // tts:audio:start, not on click, so it binds to its own speech rather than
  // to the line it interrupts (whose tts:audio:end comes after the click).
  const pendingLine = useRef<VoiceLine>(undefined);
  // The performance of the line being played, so a stop or a character switch
  // cancels it.
  const lineHandle = useRef<PerformanceHandle>(undefined);
  const { withBaseUrl } = useBaseUrlUtils();
  const modelUrls: Record<CharacterId, string> = {
    Twin: useBaseUrl(CHARACTERS.Twin.file),
    Mint: useBaseUrl(CHARACTERS.Mint.file),
  };

  const stopLine = () => {
    const handle = lineHandle.current;
    lineHandle.current = undefined;
    handle?.cancel().catch((err: unknown) => {
      setLineError(`Couldn't stop that line: ${messageOf(err)}`);
    });
  };

  // Charivo and the engine load on the client only, after mount.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    let disposed = false;
    let charivo: Charivo | undefined;
    (async () => {
      const [
        { createCharivo },
        { createRenderManager },
        { createIkiRenderer },
        { createTTSManager },
      ] = await Promise.all([
        import("@charivo/core"),
        import("@charivo/render"),
        import("@charivo/render-iki"),
        import("@charivo/tts"),
      ]);
      if (disposed) {
        return;
      }
      const renderer = createIkiRenderer({ canvas });
      const renderManager = createRenderManager(renderer, {
        canvas,
        mouseTracking: "document",
      });
      const instance = createCharivo({ renderer: renderManager });
      charivo = instance;
      // Lines play through the real TTS path, so the manager analyzes the
      // recording and lip-sync reaches RenderManager over the bus.
      const tts = createTTSManager(createLinePlayer(withBaseUrl));
      instance.attachTTS(tts);
      instance.on("tts:audio:start", () => {
        if (disposed) {
          return;
        }
        const line = pendingLine.current;
        pendingLine.current = undefined;
        const t = performance.now();
        if (line) {
          // No hold: speech-scoped, so it ends with this line.
          instance.emit("avatar:expression", {
            expressionId: line.expression,
            source: "director",
            priority: "inferred",
          });
        }
        setSpeaking(true);
        setPlaying(line);
        setNow(t);
        setClaims((current) => {
          const bound = startSpeech(current, t);
          return line
            ? addClaim(bound, {
                expressionId: line.expression,
                source: "director",
                priority: "inferred",
                hold: speechHold(t, true),
              })
            : bound;
        });
      });
      instance.on("tts:audio:end", () => {
        if (disposed) {
          return;
        }
        setSpeaking(false);
        setPlaying(undefined);
        setClaims(endSpeech);
      });
      await renderManager.initialize();
      if (!disposed) {
        setEngine({ charivo: instance, renderManager, renderer, tts });
      }
    })().catch((err: unknown) => {
      if (!disposed) {
        setError(`Couldn't start the playground: ${messageOf(err)}`);
      }
    });
    return () => {
      disposed = true;
      // Stops any line still playing, then releases TTS and the renderer.
      void charivo?.dispose();
    };
  }, []);

  // A model load drops every claim, so the readout starts over with it.
  useEffect(() => {
    if (!engine) {
      return;
    }
    let stale = false;
    const { view, gazeOrigin } = CHARACTERS[character];
    setCatalog(undefined);
    setError(undefined);
    engine.renderManager
      .loadModel(modelUrls[character])
      .then(() => {
        if (stale) {
          return;
        }
        engine.renderer.setView(view);
        engine.renderer.setGazeOrigin(gazeOrigin);
        setCatalog(engine.renderer.getAvatarControlCatalog());
      })
      .catch((err: unknown) => {
        if (!stale) {
          setError(`Couldn't load ${character}: ${messageOf(err)}`);
        }
      });
    return () => {
      stale = true;
      pendingLine.current = undefined;
      stopLine();
      setLineError(undefined);
      setClaims([]);
    };
  }, [engine, character]);

  // Tick the countdowns and drop what has expired while anything is live.
  useEffect(() => {
    if (claims.length === 0) {
      return;
    }
    const timer = setInterval(() => {
      const t = performance.now();
      setNow(t);
      setClaims((current) => {
        const live = pruneExpired(current, t);
        return live.length === current.length ? current : live;
      });
    }, 100);
    return () => clearInterval(timer);
  }, [claims.length]);

  // Emit the claim, and record it for the readout with the hold it gets.
  const claimExpression = (
    expressionId: string,
    source: string,
    priority: SentClaim["priority"],
    hold?: { ms: number } | "until-release",
  ) => {
    if (!engine) {
      return;
    }
    engine.charivo.emit("avatar:expression", {
      expressionId,
      source,
      priority,
      ...(hold ? { hold } : {}),
    });
    const t = performance.now();
    const sent: ClaimHold =
      hold === undefined
        ? speechHold(t, speaking)
        : hold === "until-release"
          ? { kind: "until-release" }
          : { kind: "ms", endsAt: t + hold.ms };
    setNow(t);
    setClaims((current) =>
      addClaim(pruneExpired(current, t), {
        expressionId,
        source,
        priority,
        hold: sent,
      }),
    );
  };

  // The playing line's pill stops it; any other starts that line, and
  // speak() stops whatever is playing first, so it interrupts.
  const toggleLine = (line: VoiceLine) => {
    if (!engine) {
      return;
    }
    if (playing === line) {
      pendingLine.current = undefined;
      stopLine();
      return;
    }
    // From the click, so the lip-sync AudioContext starts under the gesture
    // (docs/guide/tts.md). Best-effort, as in examples/web: a real failure
    // surfaces from the performance below.
    engine.tts.prepareAudio().catch(() => {});
    setLineError(undefined);
    // A new line takes the floor from the one playing, so it interrupts.
    let handle: PerformanceHandle;
    try {
      handle = engine.charivo.perform({
        text: line.text,
        origin: "playground",
      });
    } catch (error) {
      setLineError(
        `Couldn't play that line: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    pendingLine.current = line;
    lineHandle.current = handle;
    void handle.done.then((result) => {
      if (lineHandle.current === handle) {
        lineHandle.current = undefined;
      }
      if (result.status === "failed") {
        setLineError(
          `Couldn't play that line: ${result.error?.message ?? "unknown error"}`,
        );
      }
    });
  };

  const releaseDirector = () => {
    engine?.charivo.emit("avatar:release", { source: "director" });
    setClaims((current) => releaseSource(current, "director"));
  };

  const ready = Boolean(engine && catalog);
  const ranked = rankClaims(claims);
  // A line's pick is speech-scoped; only a button's held pick lights up.
  const directorPick = claims.find(
    (c) => c.source === "director" && c.hold.kind === "until-release",
  );
  const lines = LINES.filter((line) => line.character === character);
  const reactions = catalog
    ? REACTIONS.flatMap((reaction) => {
        const expressionId = findExpression(catalog, reaction.pattern);
        return expressionId ? [{ ...reaction, expressionId }] : [];
      })
    : [];
  const motions = catalog
    ? Object.entries(catalog.motions).flatMap(([group, count]) =>
        Array.from({ length: count }, (_, index) => ({
          group,
          index,
          label: count > 1 ? `${group} ${index + 1}` : group,
        })),
      )
    : [];

  return (
    <div className={styles.layout}>
      <div className={styles.stageColumn}>
        <div className={styles.stage}>
          <canvas
            ref={canvasRef}
            className={styles.canvas}
            role="img"
            aria-label={`${character}, an Iki character`}
          />
          <div className={styles.switcher} role="group" aria-label="Character">
            {(Object.keys(CHARACTERS) as CharacterId[]).map((id) => (
              <button
                key={id}
                type="button"
                className={styles.switch}
                aria-pressed={id === character}
                onClick={() => setCharacter(id)}
              >
                {id}
              </button>
            ))}
          </div>
          {(error || !ready) && (
            <p className={styles.stageStatus} role="status">
              {error ?? `Loading ${character}…`}
            </p>
          )}
        </div>

        <section className={styles.readout} aria-labelledby="claims-heading">
          <h2 id="claims-heading" className={styles.readoutHeading}>
            Claims
          </h2>
          <p className={styles.helper}>
            Expression claims this page has sent that are still live, highest
            first. The top one is on the face.
          </p>
          {ranked.length === 0 ? (
            <p className={styles.empty}>None live: the face is at rest.</p>
          ) : (
            <ol className={styles.claimList}>
              {ranked.map((c, i) => (
                <li
                  key={c.seq}
                  className={styles.claim}
                  aria-current={i === 0 ? "true" : undefined}
                >
                  <span className={styles.priority}>{c.priority}</span>
                  <span>{c.source}</span>
                  <span className={styles.expression}>{c.expressionId}</span>
                  <span className={styles.hold}>
                    {describeHold(c.hold, now)}
                  </span>
                  {i === 0 && <span className={styles.showing}>showing</span>}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <div className={styles.panel}>
        <Section
          title="Reactions"
          helper="A reflex overrides the face for a moment, even mid-sentence."
        >
          {reactions.map(({ label, expressionId, holdMs, gaze }) => (
            <Pill
              key={label}
              title={`${expressionId}, reflex, ${holdMs / 1000} s`}
              onClick={() => {
                claimExpression(expressionId, "reaction", "reflex", {
                  ms: holdMs,
                });
                if (gaze) {
                  engine?.charivo.emit("avatar:gaze", {
                    ...gaze,
                    source: "reaction",
                    priority: "reflex",
                    hold: { ms: holdMs },
                  });
                }
              }}
            >
              {label}
            </Pill>
          ))}
        </Section>

        <Section
          title="Lines"
          helper="Pre-recorded, AI-generated voice (Gemini TTS)."
        >
          {lines.map((line) => (
            <Pill
              key={line.file}
              title={line.text}
              disabled={!ready}
              pressed={playing === line}
              onClick={() => toggleLine(line)}
            >
              {line.label}
            </Pill>
          ))}
          {lineError && (
            <p className={styles.lineError} role="alert">
              {lineError}
            </p>
          )}
        </Section>

        <Section
          title="AI pick"
          helper="What a text director would choose, held until clicked again or released. Playing a line replaces it (same director)."
        >
          {catalog?.expressions.map((id) => (
            <Pill
              key={id}
              title={catalog.expressionDescriptions?.[id]}
              pressed={directorPick?.expressionId === id}
              onClick={() =>
                directorPick?.expressionId === id
                  ? releaseDirector()
                  : claimExpression(id, "director", "inferred", "until-release")
              }
            >
              {id}
            </Pill>
          ))}
          <Pill disabled={!ready} onClick={releaseDirector}>
            Release
          </Pill>
        </Section>

        <Section
          title="Expressions"
          helper="Plain claims: held for the next speech, or about 8 s."
        >
          {catalog?.expressions.map((id) => (
            <Pill
              key={id}
              title={catalog.expressionDescriptions?.[id]}
              onClick={() => claimExpression(id, "app", "explicit")}
            >
              {id}
            </Pill>
          ))}
        </Section>

        <Section title="Motions">
          {motions.map(({ group, index, label }) => (
            <Pill
              key={label}
              title={catalog?.motionDescriptions?.[group]?.[index]}
              onClick={() =>
                engine?.charivo.emit("avatar:motion", { group, index })
              }
            >
              {label}
            </Pill>
          ))}
        </Section>

        <Section title="Gaze">
          {GAZE_PRESETS.map(({ label, x, y }) => (
            <Pill
              key={label}
              disabled={!ready}
              onClick={() => engine?.charivo.emit("avatar:gaze", { x, y })}
            >
              {label}
            </Pill>
          ))}
        </Section>
      </div>
    </div>
  );
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function describeHold(hold: ClaimHold, now: number): string {
  const secondsLeft = (until: number) =>
    `${Math.max(0, (until - now) / 1000).toFixed(1)} s`;
  switch (hold.kind) {
    case "ms":
      return `${secondsLeft(hold.endsAt)} left`;
    case "until-release":
      return "held";
    case "speech":
      return hold.bound
        ? "until speech ends"
        : `next speech, or ${secondsLeft(hold.windowEndsAt)}`;
  }
}

function Section({
  title,
  helper,
  children,
}: {
  title: string;
  helper?: string;
  children: ReactNode;
}): ReactNode {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionHeading}>{title}</h2>
      {helper && <p className={styles.helper}>{helper}</p>}
      <div className={styles.pills}>{children}</div>
    </section>
  );
}

function Pill({
  children,
  pressed,
  ...props
}: {
  children: ReactNode;
  pressed?: boolean;
  title?: string;
  disabled?: boolean;
  onClick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      className={styles.pill}
      aria-pressed={pressed}
      {...props}
    >
      {children}
    </button>
  );
}
