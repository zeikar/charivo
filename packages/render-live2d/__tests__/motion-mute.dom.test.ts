import { describe, expect, it, vi } from "vitest";
import { LAppModel } from "../src/cubism/lappmodel";
import * as LAppDefine from "../src/cubism/lappdefine";

/**
 * Motion sound behavior at the model seam. The interesting cases are all about
 * the motion object being CACHED: the same CubismMotion instance is reused by
 * every start, so whatever handlers the previous start attached are still on it.
 */

type Handler = (self: unknown) => void;

/** A stand-in for the cached CubismMotion, recording the handlers installed on it. */
class FakeMotion {
  began?: Handler;
  finished?: Handler;
  setBeganMotionHandler = vi.fn((handler: Handler) => {
    this.began = handler;
  });
  setFinishedMotionHandler = vi.fn((handler: Handler) => {
    this.finished = handler;
  });
  setEffectIds = vi.fn(() => undefined);
}

function buildModel(soundFile: string | null) {
  // Object.create rather than `new`: the real constructor reaches into Cubism
  // framework state this test has no interest in, and startMotion is a
  // self-contained method once its few dependencies below are present.
  const model = Object.create(LAppModel.prototype) as LAppModel;
  const motion = new FakeMotion();

  const wavHandler = { start: vi.fn(), stop: vi.fn() };

  // The pieces startMotion reads. Everything else is irrelevant here, and
  // stubbing narrowly keeps the test honest about what it actually covers.
  (model as unknown as { ready: boolean }).ready = true;
  // Object.create skips field initializers, so anything startMotion reads has
  // to be supplied here — including the audio-ownership counters.
  (model as unknown as { motionAudioTurn: number }).motionAudioTurn = 0;
  (model as unknown as { motionAudioOwner: number }).motionAudioOwner = 0;
  (model as unknown as { modelHomeDir: string }).modelHomeDir = "/models/haru/";
  (model as unknown as { wavHandler: unknown }).wavHandler = wavHandler;
  (model as unknown as { modelSetting: unknown }).modelSetting = {
    getMotionSoundFileName: vi.fn(() => soundFile),
  };
  (model as unknown as { motions: unknown }).motions = {
    getValue: () => motion,
  };
  (model as unknown as { _motionManager: unknown })._motionManager = {
    setReservePriority: vi.fn(),
    reserveMotion: vi.fn(() => true),
    startMotionPriority: vi.fn(() => 1),
  };

  return { model, motion, wavHandler };
}

describe("LAppModel motion sound", () => {
  it("plays the clip on a default start", () => {
    const { model, motion, wavHandler } = buildModel("sounds/haru_talk_13.wav");

    model.startMotion("TapBody", 0, LAppDefine.PriorityNormal);
    motion.began?.(motion);

    expect(wavHandler.start).toHaveBeenCalledWith(
      "/models/haru/sounds/haru_talk_13.wav",
    );

    motion.finished?.(motion);
    expect(wavHandler.stop).toHaveBeenCalled();
  });

  it("never starts the clip on a muted start, and silences one already playing", () => {
    const { model, motion, wavHandler } = buildModel("sounds/haru_talk_13.wav");

    model.startMotion(
      "TapBody",
      0,
      LAppDefine.PriorityNormal,
      undefined,
      undefined,
      {
        muteSound: true,
      },
    );
    motion.began?.(motion);

    expect(wavHandler.start).not.toHaveBeenCalled();
    // Stopping matters as much as not starting: a clip from an earlier manual
    // motion would otherwise keep playing through the muted one.
    expect(wavHandler.stop).toHaveBeenCalled();
  });

  it("silences a prior clip the moment a muted start is accepted, without waiting for began", () => {
    const { model, motion, wavHandler } = buildModel("sounds/haru_talk_13.wav");

    model.startMotion(
      "TapBody",
      0,
      LAppDefine.PriorityNormal,
      undefined,
      undefined,
      { muteSound: true },
    );

    // began has NOT been invoked yet. It fires off the render loop, which
    // pauses on a hidden tab or a lost context — so a stop deferred until then
    // can be a stop that never happens, and audio already playing would run on.
    expect(motion.began).toBeDefined();
    expect(wavHandler.stop).toHaveBeenCalled();
    expect(wavHandler.start).not.toHaveBeenCalled();
  });

  it("is audible again on the next default start of the same cached motion", () => {
    const { model, motion, wavHandler } = buildModel("sounds/haru_talk_13.wav");

    model.startMotion(
      "TapBody",
      0,
      LAppDefine.PriorityNormal,
      undefined,
      undefined,
      {
        muteSound: true,
      },
    );
    motion.began?.(motion);
    expect(wavHandler.start).not.toHaveBeenCalled();

    // Same motion object, no reload. If the handlers were installed once at
    // load time, or only replaced for the muted start, this would stay silent.
    model.startMotion("TapBody", 0, LAppDefine.PriorityNormal);
    motion.began?.(motion);

    expect(wavHandler.start).toHaveBeenCalledWith(
      "/models/haru/sounds/haru_talk_13.wav",
    );
  });

  it("still silences active audio when the muted motion has no clip of its own", () => {
    const { model, motion, wavHandler } = buildModel(null);

    model.startMotion(
      "Idle",
      0,
      LAppDefine.PriorityNormal,
      undefined,
      undefined,
      {
        muteSound: true,
      },
    );
    motion.began?.(motion);

    expect(wavHandler.start).not.toHaveBeenCalled();
    expect(wavHandler.stop).toHaveBeenCalled();
  });

  it("lets a stale finish callback pass without cutting the motion that took over", () => {
    const { model, motion, wavHandler } = buildModel("sounds/haru_talk_13.wav");

    // A starts and owns the audio.
    model.startMotion("TapBody", 0, LAppDefine.PriorityNormal);
    const beganA = motion.began;
    const finishedA = motion.finished;
    beganA?.(motion);
    expect(wavHandler.start).toHaveBeenCalledTimes(1);

    // B starts before A has finished — Cubism keeps A fading meanwhile — and
    // takes ownership by starting its own clip.
    model.startMotion("TapBody", 1, LAppDefine.PriorityNormal);
    motion.began?.(motion);
    expect(wavHandler.start).toHaveBeenCalledTimes(2);
    wavHandler.stop.mockClear();

    // Now A finally finishes. Stopping here would cut B's clip, and since stop
    // also invalidates a load still in flight, could silence it outright.
    finishedA?.(motion);
    expect(wavHandler.stop).not.toHaveBeenCalled();

    // B ending its own playback still works.
    motion.finished?.(motion);
    expect(wavHandler.stop).toHaveBeenCalled();
  });

  it("composes the caller's callbacks rather than replacing the sound handling", () => {
    const { model, motion, wavHandler } = buildModel("sounds/haru_talk_13.wav");
    const onBegan = vi.fn();
    const onFinished = vi.fn();

    model.startMotion(
      "TapBody",
      0,
      LAppDefine.PriorityNormal,
      onFinished,
      onBegan,
    );
    motion.began?.(motion);
    motion.finished?.(motion);

    expect(onBegan).toHaveBeenCalled();
    expect(onFinished).toHaveBeenCalled();
    // Passing callbacks used to clobber the sound handlers entirely.
    expect(wavHandler.start).toHaveBeenCalled();
    expect(wavHandler.stop).toHaveBeenCalled();
  });
});
