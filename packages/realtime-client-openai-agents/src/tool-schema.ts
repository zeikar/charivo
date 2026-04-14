import type { RealtimeSessionConfig } from "@charivo/core";

type RealtimeToolParameters = NonNullable<
  RealtimeSessionConfig["tools"]
>[number]["parameters"];

export interface StrictAgentsToolParameters {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
}

export interface NonStrictAgentsToolParameters {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: true;
}

export type AgentsToolParameters =
  | StrictAgentsToolParameters
  | NonStrictAgentsToolParameters;

export function createToolSchemaOptions(
  parameters: RealtimeToolParameters,
):
  | { parameters: StrictAgentsToolParameters; strict: true }
  | { parameters: NonStrictAgentsToolParameters; strict: false } {
  const normalizedParameters = toAgentsToolParameters(parameters);

  if (normalizedParameters.additionalProperties === false) {
    return {
      parameters: normalizedParameters,
      strict: true,
    };
  }

  return {
    parameters: normalizedParameters,
    strict: false,
  };
}

function toAgentsToolParameters(
  parameters: RealtimeToolParameters,
): AgentsToolParameters {
  const baseParameters = {
    type: "object" as const,
    properties: parameters.properties,
    required: parameters.required ?? [],
  };

  if (getAdditionalProperties(parameters) === false) {
    return {
      ...baseParameters,
      additionalProperties: false,
    };
  }

  return {
    ...baseParameters,
    additionalProperties: true,
  };
}

function getAdditionalProperties(
  parameters: RealtimeToolParameters,
): boolean | undefined {
  const value = (parameters as { additionalProperties?: unknown })
    .additionalProperties;
  return typeof value === "boolean" ? value : undefined;
}
