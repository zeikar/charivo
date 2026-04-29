import type { RealtimeTool } from "@charivo/core";
import { isRecord } from "./shared";

export function validateToolArguments(
  definition: RealtimeTool,
  args: unknown,
): void {
  if (!isRecord(args) || Array.isArray(args)) {
    throw new Error(
      `Realtime tool "${definition.name}" arguments failed schema validation: arguments must be an object`,
    );
  }

  const { parameters } = definition;
  const required = parameters.required ?? [];

  for (const propertyName of required) {
    if (!hasOwnProperty(args, propertyName)) {
      throw new Error(
        `Realtime tool "${definition.name}" arguments failed schema validation: missing required property "${propertyName}"`,
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
    );
  }
}

function validateToolArgumentValue(
  toolName: string,
  propertyName: string,
  value: unknown,
  schema: Record<string, unknown>,
): void {
  const enumValues = schema.enum;
  if (
    Array.isArray(enumValues) &&
    !enumValues.some((item) => Object.is(item, value))
  ) {
    throw new Error(
      `Realtime tool "${toolName}" arguments failed schema validation: property "${propertyName}" must be one of ${formatEnumValues(enumValues)}`,
    );
  }

  const expectedType = schema.type;
  if (typeof expectedType !== "string") {
    return;
  }

  if (!isSupportedSchemaType(expectedType)) {
    throw new Error(
      `Realtime tool "${toolName}" arguments failed schema validation: property "${propertyName}" uses unsupported schema type "${expectedType}"`,
    );
  }

  if (!matchesSchemaType(value, expectedType)) {
    throw new Error(
      `Realtime tool "${toolName}" arguments failed schema validation: property "${propertyName}" must be ${expectedType}`,
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
