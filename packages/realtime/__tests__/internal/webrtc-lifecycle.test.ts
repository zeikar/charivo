import { afterEach, describe, expect, it, vi } from "vitest";

const microphoneState = vi.hoisted(() => ({
  acquireMicrophoneStream: vi.fn(),
}));

vi.mock("../../src/internal/microphone", () => ({
  acquireMicrophoneStream: microphoneState.acquireMicrophoneStream,
}));

import {
  createIceDisconnectDebouncer,
  replaceMicrophoneTrack,
} from "../../src/internal/webrtc-lifecycle";
import { acquireMicrophoneStream } from "../../src/internal/microphone";

class MockMediaTrack {
  stop = vi.fn(() => undefined);
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("webrtc lifecycle helpers", () => {
  it("rejects microphone replacement when the transport is not active", async () => {
    await expect(
      replaceMicrophoneTrack({
        audioSender: null,
        mediaStream: null,
        peerConnection: null,
      }),
    ).rejects.toThrow("Realtime transport not active");
    expect(acquireMicrophoneStream).not.toHaveBeenCalled();
  });

  it("rejects microphone replacement when the next stream has no audio track", async () => {
    vi.mocked(acquireMicrophoneStream).mockResolvedValue({
      getAudioTracks: () => [],
    } as unknown as MediaStream);

    await expect(
      replaceMicrophoneTrack({
        audioSender: null,
        mediaStream: null,
        peerConnection: {
          getSenders: () => [],
        } as unknown as RTCPeerConnection,
      }),
    ).rejects.toThrow("Microphone access required for Realtime API");
  });

  it("rejects microphone replacement when no outbound audio sender is available", async () => {
    vi.mocked(acquireMicrophoneStream).mockResolvedValue({
      getAudioTracks: () => [new MockMediaTrack()],
    } as unknown as MediaStream);

    await expect(
      replaceMicrophoneTrack({
        audioSender: null,
        mediaStream: null,
        peerConnection: {
          getSenders: () => [],
        } as unknown as RTCPeerConnection,
      }),
    ).rejects.toThrow("No outbound audio sender available");
  });

  it("replaces the outbound track and stops the previous stream", async () => {
    const previousTrack = new MockMediaTrack();
    const nextTrack = new MockMediaTrack();
    const replaceTrack = vi.fn(async () => undefined);

    vi.mocked(acquireMicrophoneStream).mockResolvedValue({
      getAudioTracks: () => [nextTrack],
    } as unknown as MediaStream);

    const result = await replaceMicrophoneTrack({
      audioSender: null,
      mediaStream: {
        getTracks: () => [previousTrack],
      } as unknown as MediaStream,
      peerConnection: {
        getSenders: () =>
          [
            {
              track: { kind: "audio" },
              replaceTrack,
            },
          ] as unknown as RTCRtpSender[],
      } as unknown as RTCPeerConnection,
    });

    expect(replaceTrack).toHaveBeenCalledWith(nextTrack);
    expect(previousTrack.stop).toHaveBeenCalledTimes(1);
    expect(result.audioSender).toMatchObject({
      track: { kind: "audio" },
    });
    expect(result.mediaStream.getAudioTracks()).toEqual([nextTrack]);
  });

  it("debounces repeated schedules and lets cancel suppress the pending callback", () => {
    vi.useFakeTimers();
    const onDisconnect = vi.fn();
    const debouncer = createIceDisconnectDebouncer(onDisconnect, 100);

    debouncer.schedule();
    debouncer.schedule();
    vi.advanceTimersByTime(99);
    expect(onDisconnect).not.toHaveBeenCalled();

    debouncer.cancel();
    vi.advanceTimersByTime(1);
    expect(onDisconnect).not.toHaveBeenCalled();

    debouncer.schedule();
    vi.advanceTimersByTime(100);
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });
});
