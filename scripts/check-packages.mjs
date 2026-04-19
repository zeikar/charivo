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

  const declaredEntryFields = ["main", "module", "types"];
  const declaredFiles = [];

  for (const field of declaredEntryFields) {
    const value = packageJson[field];
    if (typeof value !== "string" || value.length === 0) {
      failures.push(`${packageJson.name}: missing "${field}" field`);
      continue;
    }
    declaredFiles.push(value);
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

function stripLeadingDotSlash(value) {
  return value.startsWith("./") ? value.slice(2) : value;
}
