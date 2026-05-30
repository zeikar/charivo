// Test-only Vite plugin that lets vite-node import the `node:sqlite` built-in.
//
// Why this exists (and why it lives here, under examples/companion):
// The companion memory store (src/memory/sqlite-memory-store.ts) imports the
// Node >=22.5 built-in `node:sqlite`. vite-node 2.1.x strips the `node:` prefix
// from specifiers that are not in Node's *legacy* `module.builtinModules` list,
// and `sqlite` (added in 22.5) is not on that list — so the import is rewritten
// to a bare `sqlite` and fails to resolve. Production (Next.js) imports
// `node:sqlite` fine; this is purely a vite-node test-runner gap.
//
// companion is the only consumer of node:sqlite, so this workaround is owned by
// companion rather than polluting the shared root vitest config. The root
// vitest.config.ts imports this plugin and registers it; nothing else depends
// on it. Remove it once vite-node recognizes `node:sqlite` natively.
export function viteNodeSqlitePlugin() {
  const VIRTUAL_ID = "\0companion-node-sqlite";
  return {
    name: "companion-node-sqlite-shim",
    enforce: "pre",
    resolveId(id) {
      // vite-node hands us the prefix-stripped "sqlite"; claim it.
      if (id === "sqlite") {
        return VIRTUAL_ID;
      }
    },
    load(id) {
      if (id === VIRTUAL_ID) {
        // Re-export the real built-in via createRequire so the named imports
        // (DatabaseSync, StatementSync) resolve at runtime.
        return [
          `import { createRequire } from "node:module";`,
          `const _require = createRequire(import.meta.url);`,
          `const _sqlite = _require("node:sqlite");`,
          `export const DatabaseSync = _sqlite.DatabaseSync;`,
          `export const StatementSync = _sqlite.StatementSync;`,
        ].join("\n");
      }
    },
  };
}
