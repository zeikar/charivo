/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

/**
 * Platform abstraction utilities for the Live2D Cubism SDK.
 */
export class LAppPal {
  public static loadFileAsBytes(
    filePath: string,
    callback: (arrayBuffer: ArrayBuffer, size: number) => void,
  ): void {
    fetch(filePath)
      .then((response) => response.arrayBuffer())
      .then((arrayBuffer) => callback(arrayBuffer, arrayBuffer.byteLength));
  }

  public static getDeltaTime(): number {
    return this.deltaTime;
  }

  public static updateTime(): void {
    this.currentFrame = Date.now();
    this.deltaTime = (this.currentFrame - this.lastFrame) / 1000;
    this.lastFrame = this.currentFrame;
  }

  public static printMessage(message: string): void {
    console.log(message);
  }

  static lastUpdate = Date.now();

  static currentFrame = 0;
  static lastFrame = 0;
  static deltaTime = 0;
}
