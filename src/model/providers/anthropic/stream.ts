import type { CanonicalModelEvent } from "../../protocol/canonical.js";
import { normalizeAnthropicFinishReason } from "../../response/normalizeFinishReason.js";
import { normalizeAnthropicUsage } from "../../response/normalizeUsage.js";

export function normalizeAnthropicStreamEvent(raw: unknown): CanonicalModelEvent[] {
  const event = asRecord(raw);

  switch (event.type) {
    case "message_start":
      return [{ type: "message_start", role: "assistant", raw }];
    case "content_block_start":
      return contentBlockStartEvents(asRecord(event.content_block), raw);
    case "content_block_delta":
      return contentBlockDeltaEvents(asRecord(event.delta), raw);
    case "content_block_stop":
      return [];
    case "message_delta": {
      const delta = asRecord(event.delta);
      const events: CanonicalModelEvent[] = [];
      const usage = normalizeAnthropicUsage(event.usage);
      if (usage) {
        events.push({ type: "usage", usage, raw });
      }
      if (delta.stop_reason) {
        events.push({
          type: "message_end",
          finishReason: normalizeAnthropicFinishReason(delta.stop_reason),
          raw,
        });
      }
      return events;
    }
    case "message_stop":
      return [];
    case "error":
      return [
        {
          type: "error",
          error: {
            provider: "anthropic",
            protocol: "anthropic",
            code: readString(asRecord(event.error).type) ?? "provider_error",
            message: readString(asRecord(event.error).message) ?? "Anthropic stream error.",
            retryable: false,
            raw,
          },
        },
      ];
    default:
      return [];
  }
}

function contentBlockStartEvents(block: Record<string, unknown>, raw: unknown): CanonicalModelEvent[] {
  if (block.type === "tool_use") {
    return [
      {
        type: "tool_call_start",
        id: readString(block.id) ?? "",
        name: readString(block.name) ?? "",
        raw,
      },
    ];
  }

  return [];
}

function contentBlockDeltaEvents(delta: Record<string, unknown>, raw: unknown): CanonicalModelEvent[] {
  switch (delta.type) {
    case "text_delta":
      return [{ type: "text_delta", text: readString(delta.text) ?? "", raw }];
    case "thinking_delta":
      return [{ type: "thinking_delta", text: readString(delta.thinking) ?? "", raw }];
    case "input_json_delta":
      return [
        {
          type: "tool_call_delta",
          id: String(delta.index ?? ""),
          delta: readString(delta.partial_json) ?? "",
          raw,
        },
      ];
    default:
      return [];
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
