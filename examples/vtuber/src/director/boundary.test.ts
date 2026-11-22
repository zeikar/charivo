import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The Director must stay portable: it imports nothing outside src/director/,
// so it can be lifted into another app. Tests may also use the test runner
// and Node built-ins, which the shipped code may not.

const DIRECTOR_DIR = __dirname;

const STATIC_PATTERNS = [
  // import ... from <x>, import type ... from <x>, export ... from <x>
  /\bfrom\s*["']([^"']+)["']/g,
  // import <x>, for side effects
  /\bimport\s*["']([^"']+)["']/g,
];

// Calls that load a module by name: dynamic import, require, and the vitest
// helpers that mock or load one.
const LOADER_CALL =
  /\b(?:import|require|vi\s*\.\s*(?:mock|doMock|importActual|importMock))\s*\(/g;

// A first argument that is one plain string: double- or single-quoted, or a
// template literal with no substitution. Anything after it but a comma or the
// closing parenthesis (such as `+ name`) makes it computed.
const LITERAL_ARGUMENT =
  /^\s*(?:"([^"\n]*)"|'([^'\n]*)'|`((?:[^`$\\]|\$(?!\{))*)`)\s*[,)]/;

interface Scan {
  specifiers: string[];
  /** Loader calls whose module name is computed, so it cannot be checked. */
  computed: string[];
}

function scan(source: string): Scan {
  const specifiers = STATIC_PATTERNS.flatMap((pattern) =>
    [...source.matchAll(pattern)].map((match) => match[1]),
  );
  const computed: string[] = [];
  for (const call of source.matchAll(LOADER_CALL)) {
    const rest = source.slice(call.index + call[0].length);
    const literal = LITERAL_ARGUMENT.exec(rest);
    if (literal) specifiers.push(literal[1] ?? literal[2] ?? literal[3]);
    // Fails closed: a computed name could point anywhere.
    else computed.push(`${call[0]}${rest.split("\n")[0]}`.trim());
  }
  return { specifiers, computed };
}

function isAllowed(file: string, specifier: string): boolean {
  if (file.endsWith(".test.ts")) {
    if (specifier === "vitest" || specifier.startsWith("node:")) return true;
  }
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return false;
  }
  const target = path.resolve(path.dirname(file), specifier);
  return target.startsWith(DIRECTOR_DIR + path.sep);
}

// Fixtures are assembled at run time, with loader names in template literals,
// so this file's own scan of its source text does not see them as imports.
const q = '"';
const tick = "`";
const call = (name: string, argument: string) => `${name}(${argument})`;

describe("the Director module boundary", () => {
  it("reads the module name from static imports and exports, side-effect imports, and literal loader calls", () => {
    const source = [
      `import { a } from ${q}one${q};`,
      `import type {\n  B,\n} from ${q}two${q};`,
      `export * from ${q}three${q};`,
      `import ${q}four${q};`,
      `await ${call(`import`, `${q}five${q}`)};`,
      `await ${call(`import`, `${q}six${q}, { with: { type: "json" } }`)};`,
      `await ${call(`import`, `${tick}seven${tick}`)};`,
      `${call(`require`, "'eight'")};`,
      `${call(`vi.mock`, `${q}nine${q}, () => ({})`)};`,
      `await ${call(`vi.importActual`, `${q}ten${q}`)};`,
    ].join("\n");
    expect(scan(source)).toEqual({
      specifiers: expect.arrayContaining([
        "one",
        "two",
        "three",
        "four",
        "five",
        "six",
        "seven",
        "eight",
        "nine",
        "ten",
      ]),
      computed: [],
    });
    expect(scan(source).specifiers).toHaveLength(10);
  });

  it("reports a loader call whose module name is computed", () => {
    const computed = [
      call(`import`, `${tick}./\${name}${tick}`),
      call(`import`, "name"),
      call(`require`, `path.join(${q}a${q})`),
      call(`vi.mock`, "name"),
      call(`vi.importActual`, `${q}../${q} + name`),
    ];
    expect(scan(computed.join(";\n")).computed).toHaveLength(computed.length);
  });

  it("allows only modules inside src/director/, plus vitest and node:* in tests", () => {
    const shipped = path.join(DIRECTOR_DIR, "director.ts");
    const test = path.join(DIRECTOR_DIR, "director.test.ts");
    expect(isAllowed(shipped, "./types")).toBe(true);
    for (const outside of ["../app/lib/x", "react", "@charivo/core"]) {
      expect(isAllowed(shipped, outside), outside).toBe(false);
      expect(isAllowed(test, outside), outside).toBe(false);
    }
    for (const testOnly of ["vitest", "node:fs"]) {
      expect(isAllowed(test, testOnly), testOnly).toBe(true);
      expect(isAllowed(shipped, testOnly), testOnly).toBe(false);
    }
  });

  it("imports nothing outside src/director/", () => {
    const files = readdirSync(DIRECTOR_DIR, { recursive: true })
      .map(String)
      .filter((name) => /\.tsx?$/.test(name))
      .map((name) => path.join(DIRECTOR_DIR, name));
    expect(files).toContain(path.join(DIRECTOR_DIR, "director.ts"));

    const violations = files.flatMap((file) => {
      const { specifiers, computed } = scan(readFileSync(file, "utf8"));
      const name = path.basename(file);
      return [
        ...specifiers
          .filter((specifier) => !isAllowed(file, specifier))
          .map((specifier) => `${name}: ${specifier}`),
        ...computed.map((text) => `${name}: computed module name in ${text}`),
      ];
    });
    expect(violations).toEqual([]);
  });
});
