/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

import { csmVector, iterator } from "@framework/type/csmvector";
import { LAppGlManager } from "./lappglmanager";

export class LAppTextureManager {
  private textures: csmVector<TextureInfo> = new csmVector<TextureInfo>();
  private glManager?: LAppGlManager;

  public release(): void {
    if (!this.glManager) return;

    for (
      let ite: iterator<TextureInfo> = this.textures.begin();
      ite.notEqual(this.textures.end());
      ite.preIncrement()
    ) {
      const pointer = ite.ptr();
      if (pointer?.id) {
        this.glManager.getGl().deleteTexture(pointer.id);
      }
    }

    this.textures = new csmVector<TextureInfo>();
  }

  public createTextureFromPngFile(
    fileName: string,
    usePremultiply: boolean,
    callback: (textureInfo: TextureInfo) => void,
  ): void {
    for (
      let ite: iterator<TextureInfo> = this.textures.begin();
      ite.notEqual(this.textures.end());
      ite.preIncrement()
    ) {
      const cached = ite.ptr();
      if (!cached) continue;

      if (
        cached.fileName === fileName &&
        cached.usePremultply === usePremultiply
      ) {
        cached.img = new Image();
        cached.img.addEventListener("load", () => callback(cached), {
          passive: true,
        });
        cached.img.src = fileName;
        return;
      }
    }

    const img = new Image();
    img.addEventListener(
      "load",
      () => {
        if (!this.glManager) {
          throw new Error(
            "Live2D: GL manager not available while loading texture.",
          );
        }

        const gl = this.glManager.getGl();
        const tex = gl.createTexture();
        if (!tex) {
          throw new Error("Live2D: Failed to create WebGL texture.");
        }

        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(
          gl.TEXTURE_2D,
          gl.TEXTURE_MIN_FILTER,
          gl.LINEAR_MIPMAP_LINEAR,
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        if (usePremultiply) {
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
        }

        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          img,
        );
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.bindTexture(gl.TEXTURE_2D, null);

        const textureInfo = new TextureInfo();
        textureInfo.fileName = fileName;
        textureInfo.width = img.width;
        textureInfo.height = img.height;
        textureInfo.id = tex;
        textureInfo.img = img;
        textureInfo.usePremultply = usePremultiply;

        this.textures.pushBack(textureInfo);
        callback(textureInfo);
      },
      { passive: true },
    );

    img.src = fileName;
  }

  public releaseTextures(): void {
    if (!this.glManager) return;

    for (let i = 0; i < this.textures.getSize(); i++) {
      const info = this.textures.at(i);
      if (info?.id) {
        this.glManager.getGl().deleteTexture(info.id);
      }
    }

    this.textures.clear();
  }

  public releaseTextureByTexture(texture: WebGLTexture): void {
    if (!this.glManager) return;

    for (let i = 0; i < this.textures.getSize(); i++) {
      const info = this.textures.at(i);
      if (info?.id !== texture) continue;

      this.glManager.getGl().deleteTexture(info.id);
      this.textures.remove(i);
      break;
    }
  }

  public releaseTextureByFilePath(fileName: string): void {
    if (!this.glManager) return;

    for (let i = 0; i < this.textures.getSize(); i++) {
      const info = this.textures.at(i);
      if (info?.fileName !== fileName) continue;

      this.glManager.getGl().deleteTexture(info.id);
      this.textures.remove(i);
      break;
    }
  }

  public setGlManager(glManager: LAppGlManager): void {
    this.glManager = glManager;
  }
}

export class TextureInfo {
  img: HTMLImageElement | null = null;
  id: WebGLTexture | null = null;
  width = 0;
  height = 0;
  usePremultply = false;
  fileName = "";
}
