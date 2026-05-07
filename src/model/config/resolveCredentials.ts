import { ModelConfigError } from "../protocol/errors.js";

export type CredentialEnv = Record<string, string | undefined>;

const ENV_REFERENCE_PATTERN = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

export function resolveApiKey(value: unknown, env: CredentialEnv = process.env): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ModelConfigError("missing_api_key", "Provider apiKey must be a non-empty string.");
  }

  const match = ENV_REFERENCE_PATTERN.exec(value);
  if (!match) {
    return value;
  }

  const envName = match[1];
  const resolved = env[envName];
  if (!resolved) {
    throw new ModelConfigError("missing_api_key", `Environment variable ${envName} is not set.`, {
      envName,
    });
  }

  return resolved;
}
