import { normalizeAnthropicStreamEvent } from "../providers/anthropic/stream.js";
import {
  createOpenAIStreamState,
  normalizeOpenAIStreamEvent,
  type OpenAIStreamState,
} from "../providers/openai/stream.js";
import type { CanonicalModelEvent, ModelProtocol } from "../protocol/canonical.js";

export type StreamNormalizerState = {
  openai: OpenAIStreamState;
};

export function createStreamNormalizerState(): StreamNormalizerState {
  return {
    openai: createOpenAIStreamState(),
  };
}

export function normalizeStreamEvent(
  protocol: ModelProtocol,
  raw: unknown,
  state: StreamNormalizerState = createStreamNormalizerState(),
): CanonicalModelEvent[] {
  if (protocol === "anthropic") {
    return normalizeAnthropicStreamEvent(raw);
  }

  return normalizeOpenAIStreamEvent(raw, state.openai);
}
