export type CanonicalModelError = {
  provider: string;
  protocol: "anthropic" | "openai";
  code: string;
  status?: number;
  message: string;
  retryable: boolean;
  raw?: unknown;
};

export class ModelConfigError extends Error {
  readonly name = "ModelConfigError";

  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export class ModelRequestError extends Error {
  readonly name = "ModelRequestError";

  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export class ModelProviderError extends Error {
  readonly name = "ModelProviderError";

  constructor(readonly error: CanonicalModelError) {
    super(error.message);
  }
}
