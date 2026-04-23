import path from "node:path";

const resolvePackage = (packagePath: string) =>
  path.resolve(__dirname, packagePath);

export const workspaceAliases = [
  {
    find: "@charivo/llm/openai",
    replacement: resolvePackage("packages/llm/src/openai/index.ts"),
  },
  {
    find: "@charivo/llm/openclaw",
    replacement: resolvePackage("packages/llm/src/openclaw/index.ts"),
  },
  {
    find: "@charivo/llm/remote",
    replacement: resolvePackage("packages/llm/src/remote/index.ts"),
  },
  {
    find: "@charivo/llm/stub",
    replacement: resolvePackage("packages/llm/src/stub/index.ts"),
  },
  {
    find: "@charivo/server/openai",
    replacement: resolvePackage("packages/server/src/openai/index.ts"),
  },
  {
    find: "@charivo/server/openclaw",
    replacement: resolvePackage("packages/server/src/openclaw/index.ts"),
  },
  {
    find: "@charivo/realtime/openai",
    replacement: resolvePackage("packages/realtime/src/openai/index.ts"),
  },
  {
    find: "@charivo/realtime/openai-agents",
    replacement: resolvePackage("packages/realtime/src/openai-agents/index.ts"),
  },
  {
    find: "@charivo/realtime/remote",
    replacement: resolvePackage("packages/realtime/src/remote/index.ts"),
  },
  {
    find: "@charivo/render/stub",
    replacement: resolvePackage("packages/render/src/stub/index.ts"),
  },
  {
    find: "@charivo/stt/openai",
    replacement: resolvePackage("packages/stt/src/openai/index.ts"),
  },
  {
    find: "@charivo/stt/remote",
    replacement: resolvePackage("packages/stt/src/remote/index.ts"),
  },
  {
    find: "@charivo/stt/web",
    replacement: resolvePackage("packages/stt/src/web/index.ts"),
  },
  {
    find: "@charivo/tts/openai",
    replacement: resolvePackage("packages/tts/src/openai/index.ts"),
  },
  {
    find: "@charivo/tts/remote",
    replacement: resolvePackage("packages/tts/src/remote/index.ts"),
  },
  {
    find: "@charivo/tts/web",
    replacement: resolvePackage("packages/tts/src/web/index.ts"),
  },
  {
    find: "@framework",
    replacement: resolvePackage(
      "packages/render-live2d/CubismSdkForWeb-5-r.4/Framework/src",
    ),
  },
  {
    find: "@charivo/core",
    replacement: resolvePackage("packages/core/src/index.ts"),
  },
  {
    find: "@charivo/llm",
    replacement: resolvePackage("packages/llm/src/index.ts"),
  },
  {
    find: "@charivo/realtime",
    replacement: resolvePackage("packages/realtime/src/index.ts"),
  },
  {
    find: "@charivo/realtime-avatar",
    replacement: resolvePackage("packages/realtime-avatar/src/index.ts"),
  },
  {
    find: "@charivo/render-live2d",
    replacement: resolvePackage("packages/render-live2d/src/index.ts"),
  },
  {
    find: "@charivo/render",
    replacement: resolvePackage("packages/render/src/index.ts"),
  },
  {
    find: "@charivo/stt",
    replacement: resolvePackage("packages/stt/src/index.ts"),
  },
  {
    find: "@charivo/tts",
    replacement: resolvePackage("packages/tts/src/index.ts"),
  },
] as const;
