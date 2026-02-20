export async function loadCubismCore(): Promise<void> {
  if (typeof window === "undefined") return;
  if (isCubismCoreReady()) return;

  // Import as raw text (text loader in tsup) so esbuild doesn't treat it as an
  // ESM module. Then inject as a classic <script> so var declarations become
  // window-scoped globals (required by CubismFramework).
  const { default: coreScript } = await import(
    "../../CubismSdkForWeb-5-r.4/Core/live2dcubismcore.min.js"
  );
  const script = document.createElement("script");
  script.text = coreScript;
  document.head.appendChild(script);

  // The Emscripten WASM runtime initializes asynchronously even when the script
  // runs synchronously. Poll until Live2DCubismCore.Version.csmGetVersion()
  // succeeds, which confirms all WASM exports are linked and ready.
  await new Promise<void>((resolve) => {
    const check = () => {
      if (isCubismCoreReady()) resolve();
      else setTimeout(check, 16);
    };
    check();
  });
}

export function isCubismCoreReady(): boolean {
  try {
    Live2DCubismCore.Version.csmGetVersion();
    return true;
  } catch {
    return false;
  }
}
