// @vitest-environment jsdom

import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Character, Charivo, RealtimeSessionConfig } from "@charivo/core";
import { clickElement, renderComponent } from "../test-utils/render-component";
import { useChatStore } from "../stores/useChatStore";
import { useCharacterStore } from "../stores/useCharacterStore";
import { CHARACTER_CONFIGS } from "../config/characters";
import {
  REALTIME_GEMINI_MODEL,
  REALTIME_OPENAI_MODEL,
} from "../api/demo-limits";
import { useRealtimeMode } from "./useRealtimeMode";

const { prepareAudio, startSession } = vi.hoisted(() => ({
  prepareAudio: vi.fn(),
  startSession: vi.fn(),
}));

// The manager is faked because what is under test is the config the hook hands
// *to* it. The rest of `@charivo/realtime` stays real: `realtime-instructions`
// builds the session instructions with `buildRealtimeSessionConfig`.
vi.mock("@charivo/realtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@charivo/realtime")>();

  return {
    ...actual,
    createRealtimeManager: () => ({
      prepareAudio,
      startSession,
      getRegisteredTools: () => [],
    }),
  };
});

// The real client eagerly builds its transport adapter table, which the faked
// manager would never use.
vi.mock("@charivo/realtime/remote", () => ({
  createRemoteRealtimeClient: () => ({}),
}));

const initialStoreState = useChatStore.getState();

let heldCharacter: Character | null = null;

const charivo = {
  attachRealtime: () => {},
  getCurrentCharacter: () => heldCharacter,
} as unknown as Charivo;

function RealtimeModeProbe() {
  const { toggleRealtimeMode } = useRealtimeMode();

  return <button onClick={() => void toggleRealtimeMode()}>toggle</button>;
}

async function toggleRealtimeModeOn(): Promise<void> {
  const container = renderComponent(<RealtimeModeProbe />);
  const toggle = container.querySelector("button");

  if (!toggle) {
    throw new Error("no toggle button rendered");
  }

  clickElement(toggle);

  // `enableRealtimeMode` awaits prepareAudio and then startSession, so the
  // click's own act scope closes before either resolves. Awaiting an empty act
  // scope drains those continuations with React still batching, so the state
  // updates they make are not reported as un-acted.
  await act(async () => {});
}

/** Reads the one `RealtimeSessionConfig` the hook passed to a session call. */
function sessionConfigFrom(
  sessionCall: typeof prepareAudio,
): RealtimeSessionConfig {
  expect(sessionCall).toHaveBeenCalledTimes(1);

  return sessionCall.mock.calls[0][0] as RealtimeSessionConfig;
}

const PROVIDER_CASES = [
  { provider: "gemini", transport: "websocket", model: REALTIME_GEMINI_MODEL },
  { provider: "openai", transport: "webrtc", model: REALTIME_OPENAI_MODEL },
] as const;

beforeEach(() => {
  useChatStore.setState(initialStoreState, true);
  useChatStore.setState({ charivo });
  // The voice under test belongs to a character, so name one instead of
  // leaning on whatever the store happens to default to.
  useCharacterStore.setState({ selectedCharacter: "Haru" });
  heldCharacter = CHARACTER_CONFIGS.Haru.character;
  prepareAudio.mockClear();
  startSession.mockClear();
});

describe.each(PROVIDER_CASES)(
  "useRealtimeMode with the $provider provider selected",
  ({ provider, transport, model }) => {
    beforeEach(() => {
      useChatStore.setState({ selectedRealtimeProvider: provider });
    });

    it("prepares audio and starts the session on that provider's transport", async () => {
      await toggleRealtimeModeOn();

      expect(sessionConfigFrom(prepareAudio)).toMatchObject({
        provider,
        transport,
        model,
      });
      expect(sessionConfigFrom(startSession)).toMatchObject({
        provider,
        transport,
        model,
      });
    });

    /**
     * `packages/realtime/src/remote/client.ts` resolves the transport adapter
     * from provider plus transport alone, defaulting transport to "webrtc". The
     * audio context `prepareAudio` warms under the user gesture survives only if
     * `startSession` resolves the same adapter — otherwise the client discards
     * it, silently, and iOS loses its gesture. So the two calls *agreeing* is
     * the contract; each one being plausible on its own is not enough.
     */
    it("asks both calls for the same provider and transport", async () => {
      await toggleRealtimeModeOn();

      const adapterRoute = (config: RealtimeSessionConfig) => ({
        provider: config.provider,
        transport: config.transport,
      });

      const preparedRoute = adapterRoute(sessionConfigFrom(prepareAudio));

      expect(preparedRoute).toEqual(
        adapterRoute(sessionConfigFrom(startSession)),
      );
      // Two absent fields agree with each other too, so the agreement above is
      // only worth something once both halves of the route are actually there.
      expect(preparedRoute.provider).toBeDefined();
      expect(preparedRoute.transport).toBeDefined();
    });

    /**
     * The character the Charivo instance holds carries the TTS player's voice,
     * which the realtime provider may not even accept. So the voice the model
     * speaks with has to be named on the session config itself.
     */
    it(`asks for Haru's ${provider} voice`, async () => {
      await toggleRealtimeModeOn();

      const voice = CHARACTER_CONFIGS.Haru.voices[provider];

      expect(sessionConfigFrom(prepareAudio).voice).toBe(voice);
      expect(sessionConfigFrom(startSession).voice).toBe(voice);
    });

    /**
     * Selecting a character updates the store immediately; the instance only
     * follows when the character sync in `useCharivoChat` runs, and that sync
     * early-returns while the render manager is missing. Starting a session
     * while the two disagree must not take the persona from one character and
     * the voice from the other -- the voice is named once here and the sync's
     * later `updateSession` re-sends only the instructions, so a mixed session
     * stays mixed for its whole life.
     */
    it("takes persona and voice from the same character mid-switch", async () => {
      useCharacterStore.setState({ selectedCharacter: "Mao" });
      // The sync has not run yet, so the instance still holds the old one.
      heldCharacter = CHARACTER_CONFIGS.Haru.character;

      await toggleRealtimeModeOn();

      const config = sessionConfigFrom(startSession);

      expect(config.voice).toBe(CHARACTER_CONFIGS.Mao.voices[provider]);
      expect(config.instructions).toContain(
        CHARACTER_CONFIGS.Mao.character.name,
      );
      expect(config.instructions).not.toContain(
        CHARACTER_CONFIGS.Haru.character.name,
      );
    });
  },
);
