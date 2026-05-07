import type { ModelProtocol } from "../protocol/canonical.js";
import type { CanonicalModelError } from "../protocol/errors.js";

export function normalizeModelError(
  provider: string,
  protocol: ModelProtocol,
  error: unknown,
  status?: number,
): CanonicalModelError {
  const raw = error;
  const record = isRecord(error) ? error : undefined;
  const nestedError = record && isRecord(record.error) ? record.error : undefined;
  const source = nestedError ?? record;

  const code = readString(source?.code) ?? readString(source?.type) ?? statusCodeToCode(status);
  const message =
    readString(source?.message) ??
    (error instanceof Error ? error.message : undefined) ??
    "Model provider request failed.";

  return {
    provider,
    protocol,
    code,
    status,
    message,
    retryable: isRetryable(status, code),
    raw,
  };
}

function isRetryable(status: number | undefined, code: string): boolean {
  if (status === 408 || status === 409 || status === 429 || (status !== undefined && status >= 500)) {
    return true;
  }

  return ["rate_limit_error", "overloaded_error", "timeout", "server_error"].includes(code);
}

function statusCodeToCode(status: number | undefined): string {
  if (status === 401 || status === 403) {
    return "auth_error";
  }
  if (status === 429) {
    return "rate_limit_error";
  }
  if (status !== undefined && status >= 500) {
    return "server_error";
  }
  return "provider_error";
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
