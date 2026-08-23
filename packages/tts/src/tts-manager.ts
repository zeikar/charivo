import {
  CharivoEventEmitter,
  CharivoStateError,
  createLipSyncAnalyzer,
  subscribeBrowserLifecycle,
  TTSPlayer,
  TTSPlaybackMode,
  TTSOptions,
  TTSManager,
  toCharivoError,
  type BuiltInTTSManager,
} from "@charivo/core";
import { WebSpeechLipSyncSimulator } from "./web-speech-lipsync-simulator";
import {
  getTTSAudioMimeType,
  getTTSPlaybackMode,
  supportsGenerateAudio,
} from "./tts-utils";

/** Returned by raceStartup() when the speak() it belongs to was cancelled. */
const STARTUP_CANCELLED = Symbol("charivo.tts.startupCancelled");

const noop = (): void => undefined;

/**
 * The cancellation handle a single speak() call registers while it starts up.
 * `cancelled` is what raceStartup() races the startup operation against;
 * `isCancelled` reports whether this call's generation was invalidated.
 */
interface SpeakStartup {
  readonly cancelled: Promise<void>;
  readonly cancel: () => void;
  readonly isCancelled: () => boolean;
}

/**
 * TTS Manager - Class responsible for managing the state of a TTS session
 *
 * Responsibilities:
 * - TTS Player management and wrapping
 * - Audio playback and control
 * - Lip-sync handling (Web Speech simulation; audio playback is analyzed by the manager itself)
 * - Event emission (tts:audio:start, tts:lipsync:update, tts:audio:end)
 * - Session state management
 */
export class TTSManagerImpl implements TTSManager {
  private ttsPlayer: TTSPlayer;
  private eventEmitter?: CharivoEventEmitter;
  private currentAudio: HTMLAudioElement | null = null;
  private currentAudioUrl: string | null = null;
  private playbackMode: TTSPlaybackMode;
  private isAudioSessionActive = false;
  private teardownBrowserLifecycle?: () => void;
  // Settles the stateless-audio Promise that handleStatelessAudio() is
  // currently awaiting, if any. stop() clears currentAudio's onended/onerror
  // handlers so they can never fire on their own; without this, stopping a
  // still-playing stateless-audio utterance would strand that speak() call's
  // promise forever.
  private pendingStatelessStop: (() => void) | null = null;
  // Settles the web-speech Promise handleWebSpeech() is currently awaiting,
  // if any. Unlike the stateless path, the manager can't sever the
  // TTSPlayer's own onend/onerror handlers directly -- its completion is
  // entirely owned by the player (e.g. cancel() -> onend/onerror), and that
  // callback can arrive late, or never, after a cancellation. stop()
  // resolves this proactively so an interrupted web-speech turn doesn't
  // stay pending on the player's own timing.
  private pendingWebSpeechStop: (() => void) | null = null;
  // Bumped every time a new web-speech utterance starts. A canceled
  // utterance's own completion (a late player callback, or another stop())
  // can still arrive after a newer utterance has already taken over;
  // handleWebSpeech()'s cleanup only runs when its own captured generation
  // still matches the current one, so a stale completion can never act on
  // a session that isn't its own.
  private webSpeechGeneration = 0;
  // Claim counter for speak() calls. A call claims its generation
  // synchronously at entry, before its first await, so any stop() that lands
  // afterwards can invalidate it -- even while it is still starting up and
  // has no playback for stop() to cancel.
  private speakGeneration = 0;
  // Every speak() generation up to and including this one is invalidated: it
  // must not start playback, even if its startup operation succeeds. Raised
  // by stop() (through the current claim) and by a newer speak() (through its
  // predecessor's claim).
  private cancelledThrough = 0;
  // Startup handles of the speak() calls that have claimed a generation and
  // have not finished yet. Resolving one releases a speak() that would
  // otherwise stay parked on a startup operation that may hang forever.
  private readonly startupCancellations = new Set<SpeakStartup>();
  // The stop currently running, if any. Stops are single-flight: overlapping
  // requests share one player stop and one cleanup, and no new utterance can
  // dispatch until it has fully settled.
  private pendingStopPlayback: Promise<void> | null = null;

  // Only the Web Speech lip-sync simulation is needed
  private webSimulator: WebSpeechLipSyncSimulator;

  // Reads the emitter at emit time, so a later setEventEmitter() still applies.
  private readonly lipSync = createLipSyncAnalyzer({
    onRms: (rms) => this.eventEmitter?.emit("tts:lipsync:update", { rms }),
    onError: (error) =>
      console.error("TTS Manager: lip-sync analysis failed:", error),
  });

  constructor(ttsPlayer: TTSPlayer) {
    this.ttsPlayer = ttsPlayer;
    this.playbackMode = getTTSPlaybackMode(ttsPlayer);

    if (this.playbackMode === "audio" && !supportsGenerateAudio(ttsPlayer)) {
      throw new CharivoStateError(
        'TTS playback mode "audio" requires the player to implement generateAudio() so the manager can create and analyze playback for lip-sync. Implement generateAudio() or set playbackMode: "web-speech".',
      );
    }

    // Initialize Web Speech simulator
    this.webSimulator = new WebSpeechLipSyncSimulator();
  }

  /**
   * Set the event emitter
   */
  setEventEmitter(eventEmitter: CharivoEventEmitter): void {
    this.eventEmitter = eventEmitter;

    // Connect event emitter to Web Speech simulator
    this.webSimulator = new WebSpeechLipSyncSimulator(eventEmitter);
  }

  /**
   * Convert text to speech and play it.
   *
   * Resolves when the utterance finishes -- or silently, without speaking, if
   * stop() or a newer speak() lands while this call is still starting up (the
   * pre-speech stop, or synthesis). A cancelled call never begins playback,
   * whether or not it had already opened an audio session (a reentrant stop
   * from the tts:audio:start listener still sees the session close), so a
   * resolved speak() is not proof audio played.
   */
  async speak(text: string, options?: TTSOptions): Promise<void> {
    // Claim this utterance's identity synchronously, before the first await:
    // every stop() from now on can see the claim and invalidate it.
    const generation = ++this.speakGeneration;
    // A new utterance invalidates its predecessors' pending startups.
    this.cancelStartupsThrough(generation - 1);

    const startup = this.createSpeakStartup(generation);
    this.startupCancellations.add(startup);

    try {
      const stopped = await this.raceStartup(
        this.stopPlayback().catch((error) => {
          throw toCharivoError("provider", error, "Failed to stop active TTS");
        }),
        startup.cancelled,
        startup.isCancelled,
      );

      // A stop() -- or a newer speak() -- landed while this call was still
      // waiting for the pre-speech stop, so there is nothing to speak anymore.
      // A deliberate stop is a cancellation, not a failure: resolve silently.
      if (stopped === STARTUP_CANCELLED) {
        return;
      }

      if (this.playbackMode === "web-speech") {
        return await this.handleWebSpeech(text, options, startup);
      } else {
        return await this.handleStatelessAudio(text, options, startup);
      }
    } catch (error) {
      throw toCharivoError("provider", error, "Failed to speak text");
    } finally {
      this.startupCancellations.delete(startup);
    }
  }

  /**
   * Stop the currently playing speech, and cancel every speak() still
   * starting up -- those calls resolve silently instead of speaking after
   * this stop.
   */
  async stop(): Promise<void> {
    // Cancel every speak() claimed so far, synchronously at entry. A speak()
    // still starting up has no playback for stopPlayback() to cancel, so
    // invalidating its claim is the only way to keep it from speaking after
    // this stop -- and resolving its handle settles it even if the startup
    // operation it is parked on never completes.
    this.cancelStartupsThrough(this.speakGeneration);

    await this.stopPlayback();
  }

  /**
   * Stop playback, single-flight: a request issued while another stop is
   * still running joins it instead of starting a second one.
   *
   * Coalescing is safe because no new playback can be established while a
   * stop is in flight: speak() waits on this same promise before it can
   * dispatch, so the running stop already covers whatever the second request
   * would have stopped. Serializing also keeps a late-settling player stop
   * (the TTSPlayer contract allows the player-side cancellation to land when
   * stop() settles, not when it was called) from cancelling a newer
   * utterance, and keeps the cleanup in runStopPlayback() from acting on
   * state that a newer utterance has since taken over.
   */
  private stopPlayback(): Promise<void> {
    if (this.pendingStopPlayback) {
      return this.pendingStopPlayback;
    }

    const stopping = this.runStopPlayback().finally(() => {
      this.pendingStopPlayback = null;
    });
    this.pendingStopPlayback = stopping;
    return stopping;
  }

  /**
   * The actual stop: cancels the player, then cleans up this manager's own
   * playback state. Resolves only once both have completed.
   */
  private async runStopPlayback(): Promise<void> {
    this.webSimulator.stopSimulation();

    try {
      await this.ttsPlayer.stop();
    } catch (error) {
      console.warn("⚠️ TTS Manager: Failed to stop player cleanly", error);
      throw toCharivoError("provider", error, "Failed to stop TTS");
    } finally {
      if (this.currentAudio) {
        this.currentAudio.onended = null;
        this.currentAudio.onerror = null;
        this.currentAudio.pause();
        this.currentAudio = null;
      }

      if (this.currentAudioUrl) {
        URL.revokeObjectURL(this.currentAudioUrl);
        this.currentAudioUrl = null;
      }

      this.lipSync.stop();
      this.endAudioSession();

      // Deterministically settle whichever playback path is still pending.
      // Stateless-audio's onended/onerror were just cleared above and can
      // never fire now; web-speech's completion is owned by the player and
      // may arrive late (or never) after cancellation. Both need an
      // explicit nudge here so an interrupted turn can't stay pending
      // forever. A deliberate stop is a cancellation, not a failure, so
      // both resolve rather than reject.
      this.pendingStatelessStop?.();

      const settleWebSpeech = this.pendingWebSpeechStop;
      this.pendingWebSpeechStop = null;
      settleWebSpeech?.();
    }
  }

  /**
   * Set the voice
   */
  setVoice(voice: string): void {
    this.ttsPlayer.setVoice(voice);
  }

  /**
   * Check support
   */
  isSupported(): boolean {
    return this.ttsPlayer.isSupported();
  }

  /**
   * Create the audio analysis context up front, typically from a user gesture
   * handler so browsers allow playback later. Throws on unsupported browsers.
   */
  async prepareAudio(): Promise<void> {
    this.ensureLifecycleBound();
    await this.lipSync.prepare();
  }

  /**
   * Release audio resources. Call stop() first: dispose() does not stop playback.
   */
  async dispose(): Promise<void> {
    this.webSimulator.dispose();

    this.teardownBrowserLifecycle?.();
    this.teardownBrowserLifecycle = undefined;

    try {
      await this.lipSync.cleanup();
    } catch (error) {
      throw toCharivoError(
        "dispose",
        error,
        "Failed to release TTS audio resources",
      );
    }
  }

  private createSpeakStartup(generation: number): SpeakStartup {
    let cancel!: () => void;
    const cancelled = new Promise<void>((resolve) => {
      cancel = resolve;
    });

    return {
      cancelled,
      cancel,
      isCancelled: () => generation <= this.cancelledThrough,
    };
  }

  /**
   * Invalidate every speak() claimed through `generation` and release the
   * ones still starting up. Synchronous on purpose: callers must raise the
   * watermark before they await anything. Every registered handle belongs to
   * a generation at or below the caller's own claim, so all of them are
   * cancelled here.
   */
  private cancelStartupsThrough(generation: number): void {
    this.cancelledThrough = generation;

    const cancelled = [...this.startupCancellations];
    this.startupCancellations.clear();
    for (const startup of cancelled) {
      startup.cancel();
    }
  }

  /**
   * Await one of speak()'s startup operations, but give up as soon as this
   * call's startup is cancelled -- the operation may hang forever, and its
   * result must never start playback the caller no longer wants.
   */
  private async raceStartup<T>(
    operation: Promise<T>,
    cancelled: Promise<void>,
    isCancelled: () => boolean,
  ): Promise<T | typeof STARTUP_CANCELLED> {
    // Boxed so the race's result type stays free of the operation's own
    // awaited shape.
    type Outcome = { cancelled: true } | { cancelled: false; value: T };

    const abandon = (): Outcome => {
      // Consume however the abandoned operation eventually settles, so a late
      // rejection can't surface as an unhandled rejection.
      //
      // Redundant as written: the race arm below already attaches both handlers
      // to `operation`, so it is always observed (mutation-verified — deleting
      // this line breaks no test). Keep it anyway; it becomes load-bearing the
      // moment the race stops attaching its own handlers to `operation` (e.g. a
      // pre-derived promise is raced, or the isCancelled() re-check moves out).
      operation.then(noop, noop);
      // Discarding the operation's value is what keeps a late fulfillment from starting playback.
      return { cancelled: true };
    };

    const outcome = await Promise.race<Outcome>([
      cancelled.then(abandon),
      operation.then(
        // A stop() can land synchronously between the operation settling and
        // this continuation running, so re-check before handing the result
        // back. An uncancelled failure still propagates unchanged.
        (value): Outcome =>
          isCancelled() ? abandon() : { cancelled: false, value },
        (error): Outcome => {
          if (isCancelled()) {
            return abandon();
          }
          throw error;
        },
      ),
    ]);

    return outcome.cancelled ? STARTUP_CANCELLED : outcome.value;
  }

  /**
   * Establish an utterance right before it dispatches speech: (1) register
   * the callback stop() uses to settle it, (2) publish tts:audio:start, then
   * (3) report whether the utterance may still dispatch.
   *
   * Registration precedes the emission because startAudioSession() emits
   * synchronously: a listener may call stop() re-entrantly, and that stop
   * must be able to settle this utterance deterministically. The re-check
   * afterwards keeps the utterance from dispatching speech that the stop no
   * longer controls.
   */
  private beginUtterance(
    registerPendingStop: () => void,
    startup: SpeakStartup,
  ): boolean {
    registerPendingStop();
    this.startAudioSession();
    return !startup.isCancelled();
  }

  /**
   * Handle the Web Speech API (simulated lip-sync)
   */
  private async handleWebSpeech(
    text: string,
    options: TTSOptions | undefined,
    startup: SpeakStartup,
  ): Promise<void> {
    // Claims this utterance's identity so stale cleanup below can detect a
    // newer one has since taken over (see webSpeechGeneration's comment).
    const generation = ++this.webSpeechGeneration;

    // Created before the audio session is published so stop() can settle this
    // call even from a tts:audio:start listener (see beginUtterance).
    let settleThis!: () => void;
    let failThis!: (error: unknown) => void;
    const completion = new Promise<void>((resolve, reject) => {
      settleThis = resolve;
      failThis = reject;
    });

    try {
      const dispatch = this.beginUtterance(() => {
        this.pendingWebSpeechStop = settleThis;
      }, startup);

      // A stop() -- or a newer speak() -- already owns this utterance's
      // teardown (it can arrive re-entrantly from the tts:audio:start
      // listener above): resolve silently instead of dispatching speech it
      // no longer controls.
      if (dispatch) {
        // Compute the effective rate using the same clamp the Web Speech player applies,
        // so the lip-sync simulation speed matches the actual playback rate.
        const effectiveRate =
          options?.rate !== undefined
            ? Math.max(0.1, Math.min(10, options.rate))
            : 1;

        // Start simulated lip sync using dedicated component
        this.webSimulator.startSimulation(text, effectiveRate);

        // Delegate to player and wait for completion, but let stop() settle
        // this early too (see the pendingWebSpeechStop field comment).
        this.ttsPlayer.speak(text, options).then(settleThis, failThis);
        await completion;
      }
    } finally {
      // Only clear the shared resolver if it's still this call's own -- a
      // newer utterance may have already claimed and cleared it.
      if (this.pendingWebSpeechStop === settleThis) {
        this.pendingWebSpeechStop = null;
      }

      // A stale (canceled) utterance's cleanup must never act on a session
      // that a newer utterance has since started.
      if (generation === this.webSpeechGeneration) {
        this.webSimulator.stopSimulation();
        this.endAudioSession();
      }
    }
  }

  /**
   * Stateless audio handling
   */
  private async handleStatelessAudio(
    text: string,
    options: TTSOptions | undefined,
    startup: SpeakStartup,
  ): Promise<void> {
    // Non-null: the constructor guard rejects "audio" playback mode players
    // that lack generateAudio(), so this path only runs when it exists.
    const audioData = await this.raceStartup(
      this.ttsPlayer.generateAudio!(text, options).catch((error) =>
        Promise.reject(
          toCharivoError("provider", error, "Failed to generate TTS audio"),
        ),
      ),
      startup.cancelled,
      startup.isCancelled,
    );

    // A stop() -- or a newer speak() -- landed while this call was still
    // synthesizing, so no playback was ever established. Resolve silently
    // without opening an audio session.
    if (audioData === STARTUP_CANCELLED) {
      return;
    }

    const mimeType = getTTSAudioMimeType(this.ttsPlayer);
    const blob = new Blob([audioData], { type: mimeType });
    const audioUrl = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
      const audio = new Audio(audioUrl);
      this.currentAudio = audio;
      this.currentAudioUrl = audioUrl;

      if (options?.volume !== undefined) {
        audio.volume = Math.max(0, Math.min(1, options.volume));
      }

      this.ensureLifecycleBound();
      this.lipSync.attachMediaElement(audio);

      let isFinalized = false;
      const finalize = (next: () => void) => {
        if (isFinalized) return;
        isFinalized = true;
        this.pendingStatelessStop = null;

        if (this.currentAudioUrl) {
          URL.revokeObjectURL(this.currentAudioUrl);
          this.currentAudioUrl = null;
        }

        this.currentAudio = null;
        this.lipSync.stop();
        this.endAudioSession();
        next();
      };

      audio.onended = () => {
        finalize(resolve);
      };

      audio.onerror = () => {
        finalize(() => reject(new Error("Audio playback failed")));
      };

      const dispatch = this.beginUtterance(() => {
        // Lets stop() settle this promise deterministically if it interrupts
        // this playback (see the pendingStatelessStop field comment above).
        this.pendingStatelessStop = () => finalize(resolve);
      }, startup);

      // A stop() -- or a newer speak() -- already owns this utterance's
      // teardown (it can arrive re-entrantly from the tts:audio:start
      // listener above): tear the utterance down instead of starting
      // playback it no longer controls.
      if (!dispatch) {
        finalize(resolve);
        return;
      }

      audio.play().catch((error) => {
        finalize(() =>
          reject(
            error instanceof Error ? error : new Error("Audio playback failed"),
          ),
        );
      });
    });
  }

  /**
   * Subscribes to browser lifecycle events once; the teardown is released in
   * dispose(). Pausing analysis while the tab is hidden closes the mouth
   * instead of freezing on the last frame.
   */
  private ensureLifecycleBound(): void {
    if (this.teardownBrowserLifecycle) {
      return;
    }

    this.teardownBrowserLifecycle = subscribeBrowserLifecycle({
      onHidden: () => this.lipSync.pause(),
      onPageHide: () => this.lipSync.pause(),
      onVisible: () => this.lipSync.resume(),
      onPageShow: () => this.lipSync.resume(),
    });
  }

  private startAudioSession(): void {
    if (this.isAudioSessionActive) {
      return;
    }
    this.isAudioSessionActive = true;
    this.eventEmitter?.emit("tts:audio:start", {});
  }

  private endAudioSession(): void {
    if (!this.isAudioSessionActive) {
      return;
    }
    this.isAudioSessionActive = false;
    this.eventEmitter?.emit("tts:audio:end", {});
  }
}

/**
 * Helper function to create a TTS Manager
 */
export function createTTSManager(ttsPlayer: TTSPlayer): BuiltInTTSManager {
  return new TTSManagerImpl(ttsPlayer);
}
