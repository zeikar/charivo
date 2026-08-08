import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const packagesDir = path.join(rootDir, "packages");
const corePackageDir = path.join(packagesDir, "core");

// Published internal ranges must stay caret-based so consumers can dedupe:
// either the bare `workspace:^` or an explicit stable floor like `workspace:^1.0.0`.
const internalRangePattern = /^workspace:\^(\d+\.\d+\.\d+)?$/;

const packageDirs = await readdir(packagesDir, { withFileTypes: true });
const failures = [];

for (const dirent of packageDirs) {
  if (!dirent.isDirectory()) {
    continue;
  }

  const packageDir = path.join(packagesDir, dirent.name);
  const packageJsonPath = path.join(packageDir, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));

  if (packageJson.private) {
    continue;
  }

  for (const [dependency, range] of Object.entries(
    packageJson.dependencies ?? {},
  )) {
    if (!dependency.startsWith("@charivo/")) {
      continue;
    }

    if (!internalRangePattern.test(range)) {
      failures.push(
        `${packageJson.name}: internal dependency "${dependency}" must use "workspace:^" or "workspace:^x.y.z", found: ${range}`,
      );
    }
  }

  const declaredEntryFields = ["main", "module", "types"];
  const declaredFiles = [];
  const hasRootExport = hasPackageRootExport(packageJson.exports);

  if (hasRootExport) {
    for (const field of declaredEntryFields) {
      const value = packageJson[field];
      if (typeof value !== "string" || value.length === 0) {
        failures.push(`${packageJson.name}: missing "${field}" field`);
        continue;
      }
      declaredFiles.push(value);
    }
  } else {
    for (const field of declaredEntryFields) {
      if (field in packageJson) {
        failures.push(
          `${packageJson.name}: subpath-only package must not declare "${field}" field`,
        );
      }
    }
  }

  if (!packageJson.exports || typeof packageJson.exports !== "object") {
    failures.push(`${packageJson.name}: missing "exports" field`);
  } else {
    declaredFiles.push(...collectExportFiles(packageJson.exports));
  }

  for (const relativeFile of new Set(declaredFiles.map(stripLeadingDotSlash))) {
    const absoluteFile = path.join(packageDir, relativeFile);
    try {
      await access(absoluteFile, constants.F_OK);
    } catch {
      failures.push(
        `${packageJson.name}: declared artifact is missing: ${relativeFile}`,
      );
    }
  }

  // Core is the dedupe target, so only its dependents must keep it external.
  if (packageJson.name !== "@charivo/core") {
    for (const format of expectedBundleFormats(packageJson)) {
      const metafileRelativePath = `dist/metafile-${format}.json`;
      let metafileContent;

      try {
        metafileContent = await readFile(
          path.join(packageDir, metafileRelativePath),
          "utf8",
        );
      } catch {
        failures.push(
          `${packageJson.name}: build metafile is missing: ${metafileRelativePath} (run pnpm build)`,
        );
        continue;
      }

      const metafile = JSON.parse(metafileContent);

      for (const [outputFile, output] of Object.entries(
        metafile.outputs ?? {},
      )) {
        for (const input of Object.keys(output.inputs ?? {})) {
          if (!isCoreInput(packageDir, input)) {
            continue;
          }

          failures.push(
            `${packageJson.name}: ${outputFile} bundles @charivo/core instead of importing it: ${input}`,
          );
        }
      }
    }
  }

  const { stdout } = await execFileAsync(
    "npm",
    ["pack", "--dry-run", "--json"],
    {
      cwd: packageDir,
      maxBuffer: 1024 * 1024 * 10,
    },
  );
  const packResult = JSON.parse(stdout);
  const packedFiles = new Set(
    (packResult[0]?.files ?? []).map((file) => file.path),
  );

  for (const relativeFile of new Set(declaredFiles.map(stripLeadingDotSlash))) {
    if (!packedFiles.has(relativeFile)) {
      failures.push(
        `${packageJson.name}: declared artifact is not included in npm pack output: ${relativeFile}`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Package manifest validation failed:\n");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Package manifest validation passed.");

function collectExportFiles(value) {
  if (typeof value === "string") {
    return [value];
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.values(value).flatMap((entry) => collectExportFiles(entry));
}

function expectedBundleFormats(packageJson) {
  const formats = new Set();

  if (typeof packageJson.module === "string") {
    formats.add("esm");
  }

  for (const condition of collectExportConditions(packageJson.exports)) {
    if (condition === "import") {
      formats.add("esm");
    }

    if (condition === "require") {
      formats.add("cjs");
    }
  }

  return formats;
}

function collectExportConditions(value) {
  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).flatMap(([key, entry]) => [
    key,
    ...collectExportConditions(entry),
  ]);
}

function isCoreInput(packageDir, input) {
  if (input.includes("node_modules/@charivo/core")) {
    return true;
  }

  const resolved = path.resolve(packageDir, input);
  return resolved.startsWith(`${corePackageDir}${path.sep}`);
}

function hasPackageRootExport(exportsField) {
  return Boolean(
    exportsField &&
      typeof exportsField === "object" &&
      !Array.isArray(exportsField) &&
      "." in exportsField,
  );
}

function stripLeadingDotSlash(value) {
  return value.startsWith("./") ? value.slice(2) : value;
}
