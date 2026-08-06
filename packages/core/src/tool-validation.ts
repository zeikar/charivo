/**
 * Shared tool validation: the single argument/result contract enforced before
 * and after a tool handler runs, regardless of the modality that calls it.
 *
 * Errors here are plain `Error`, not a `CharivoErrorKind` variant, on purpose:
 * this preserves message-string compatibility with the pre-move realtime
 * validator, and no existing error kind fits schema validation.
 */
import type { ToolDefinition } from "./types";

/**
 * Validates tool call arguments against a definition's parameter schema.
 *
 * Enforces only: required-key presence, `enum` membership, and each
 * property's top-level `type`. Nested schemas, `additionalProperties`, and
 * numeric-length constraints (`minLength`, `maximum`, etc.) are not
 * validated. Throws a plain `Error` on the first violation found.
 *
 * @param toolLabel - Prefixes thrown messages (e.g. `${toolLabel} "name" ...`);
 * callers use this to distinguish realtime tools from other modalities.
 */
export function validateToolArguments(
  definition: ToolDefinition,
  args: unknown,
  toolLabel = "Tool",
): void {
  if (!isRecord(args) || Array.isArray(args)) {
    throw new Error(
      `${toolLabel} "${definition.name}" arguments failed schema validation: arguments must be an object`,
    );
  }

  const { parameters } = definition;
  const required = parameters.required ?? [];

  for (const propertyName of required) {
    if (!hasOwnProperty(args, propertyName)) {
      throw new Error(
        `${toolLabel} "${definition.name}" arguments failed schema validation: missing required property "${propertyName}"`,
      );
    }
  }

  for (const [propertyName, schema] of Object.entries(parameters.properties)) {
    if (!hasOwnProperty(args, propertyName) || !isRecord(schema)) {
      continue;
    }

    validateToolArgumentValue(
      definition.name,
      propertyName,
      args[propertyName],
      schema,
      toolLabel,
    );
  }
}

/**
 * Tool handlers must resolve to a plain object; arrays and primitives are not
 * serializable tool outputs. Throws a plain `Error` on violation.
 *
 * @param toolLabel - Prefixes the thrown message (e.g. `${toolLabel} "name" ...`);
 * callers use this to distinguish realtime tools from other modalities.
 */
export function assertToolResultObject(
  result: unknown,
  toolName: string,
  toolLabel = "Tool",
): asserts result is Record<string, unknown> {
  if (!isRecord(result) || Array.isArray(result)) {
    throw new Error(`${toolLabel} "${toolName}" must return an object`);
  }
}

function validateToolArgumentValue(
  toolName: string,
  propertyName: string,
  value: unknown,
  schema: Record<string, unknown>,
  toolLabel: string,
): void {
  const enumValues = schema.enum;
  if (
    Array.isArray(enumValues) &&
    !enumValues.some((item) => Object.is(item, value))
  ) {
    throw new Error(
      `${toolLabel} "${toolName}" arguments failed schema validation: property "${propertyName}" must be one of ${formatEnumValues(enumValues)}`,
    );
  }

  const expectedType = schema.type;
  if (typeof expectedType !== "string") {
    return;
  }

  if (!isSupportedSchemaType(expectedType)) {
    throw new Error(
      `${toolLabel} "${toolName}" arguments failed schema validation: property "${propertyName}" uses unsupported schema type "${expectedType}"`,
    );
  }

  if (!matchesSchemaType(value, expectedType)) {
    throw new Error(
      `${toolLabel} "${toolName}" arguments failed schema validation: property "${propertyName}" must be ${expectedType}`,
    );
  }
}

function matchesSchemaType(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return isRecord(value) && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "null":
      return value === null;
  }

  return false;
}

function isSupportedSchemaType(expectedType: string): boolean {
  return (
    expectedType === "string" ||
    expectedType === "number" ||
    expectedType === "integer" ||
    expectedType === "boolean" ||
    expectedType === "object" ||
    expectedType === "array" ||
    expectedType === "null"
  );
}

function formatEnumValues(values: unknown[]): string {
  return values.map((value) => JSON.stringify(value)).join(", ");
}

function hasOwnProperty(
  record: Record<string, unknown>,
  propertyName: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(record, propertyName);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
