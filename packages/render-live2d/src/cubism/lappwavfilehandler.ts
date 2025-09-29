/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

/**
 * Audio helper used for simple lip-sync from motion files.
 */
export class LAppWavFileHandler {
  private audioContext?: AudioContext;
  private audioBufferSourceNode?: AudioBufferSourceNode;
  private gainNode?: GainNode;
  private rms = 0;
  private isActive = false;

  public start(filePath: string): void {
    if (typeof window === "undefined") return;

    this.stop();
    this.ensureContext();
    const context = this.audioContext!;

    fetch(filePath)
      .then((response) => response.arrayBuffer())
      .then((arrayBuffer) => context.decodeAudioData(arrayBuffer))
      .then((buffer) => {
        this.audioBufferSourceNode = context.createBufferSource();
        this.gainNode = context.createGain();
        this.audioBufferSourceNode.buffer = buffer;
        this.audioBufferSourceNode.connect(this.gainNode);
        this.gainNode.connect(context.destination);
        this.audioBufferSourceNode.start(0);
        this.isActive = true;
      })
      .catch((error) => {
        console.warn("Live2D: Failed to start wav playback", error);
      });
  }

  public update(deltaTimeSeconds: number): void {
    if (!this.isActive || !this.audioContext || !this.audioBufferSourceNode) {
      this.rms = 0;
      return;
    }

    const context = this.audioContext;
    const currentTime = context.currentTime;
    const buffer = this.audioBufferSourceNode.buffer;
    if (!buffer) {
      this.stop();
      return;
    }

    const sampleRate = buffer.sampleRate;
    const sampleCount = Math.floor(sampleRate * deltaTimeSeconds);
    const channelData = buffer.getChannelData(0);
    const startIndex = Math.floor(currentTime * sampleRate);
    let acc = 0;
    for (
      let i = 0;
      i < sampleCount && startIndex + i < channelData.length;
      i++
    ) {
      const sample = channelData[startIndex + i];
      acc += sample * sample;
    }
    this.rms = sampleCount > 0 ? Math.sqrt(acc / sampleCount) : 0;

    if (currentTime >= buffer.duration) {
      this.stop();
    }
  }

  public getRms(): number {
    return this.rms;
  }

  public stop(): void {
    if (this.audioBufferSourceNode) {
      try {
        this.audioBufferSourceNode.stop();
      } catch {
        // ignore
      }
      this.audioBufferSourceNode.disconnect();
      this.audioBufferSourceNode = undefined;
    }

    this.gainNode?.disconnect();
    this.gainNode = undefined;
    this.isActive = false;
  }

  private ensureContext(): void {
    if (this.audioContext) return;

    const ctor = (window.AudioContext || (window as any).webkitAudioContext) as
      | typeof AudioContext
      | undefined;
    if (!ctor) return;

    this.audioContext = new ctor();
  }
}
