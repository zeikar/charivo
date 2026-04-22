export const DEFAULT_MICROPHONE_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
} satisfies MediaTrackConstraints;

export async function acquireMicrophoneStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: DEFAULT_MICROPHONE_CONSTRAINTS,
  });
}
