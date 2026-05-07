import type {
  CanonicalContentBlock,
  CanonicalMessage,
  CanonicalModelRequest,
  CanonicalToolChoice,
  CanonicalToolSchema,
  ModelDefinition,
} from "../../protocol/canonical.js";

export type AnthropicRequestBody = {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string;
  tools?: AnthropicTool[];
  tool_choice?: Record<string, unknown>;
  temperature?: number;
  thinking?: {
    type: "enabled";
    budget_tokens?: number;
  };
  stream?: boolean;
  metadata?: Record<string, unknown>;
};

type AnthropicMessage = {
  role: "user" | "assistant";
  content: unknown[];
};

type AnthropicTool = {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
};

export function buildAnthropicRequest(
  request: CanonicalModelRequest,
  model: ModelDefinition,
): AnthropicRequestBody {
  return {
    model: request.model,
    max_tokens: request.maxOutputTokens ?? model.capabilities.maxOutputTokens,
    messages: request.messages.map(toAnthropicMessage),
    system: request.systemPrompt,
    tools: request.tools?.map(toAnthropicTool),
    tool_choice: toAnthropicToolChoice(request.toolChoice),
    temperature: request.temperature,
    thinking:
      request.thinking?.enabled && model.capabilities.supportsThinking
        ? { type: "enabled", budget_tokens: request.thinking.budgetTokens }
        : undefined,
    stream: request.stream,
    metadata: request.metadata,
  };
}

function toAnthropicMessage(message: CanonicalMessage): AnthropicMessage {
  return {
    role: message.role,
    content: message.content.map(toAnthropicContentBlock),
  };
}

function toAnthropicContentBlock(block: CanonicalContentBlock): unknown {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "thinking":
      return { type: "thinking", thinking: block.text };
    case "image":
      return block.source === "url"
        ? { type: "image", source: { type: "url", url: block.data } }
        : {
            type: "image",
            source: { type: "base64", media_type: block.mimeType, data: block.data },
          };
    case "pdf":
      return {
        type: "document",
        source: { type: "base64", media_type: block.mimeType, data: block.data },
      };
    case "audio":
      return block.source === "url"
        ? { type: "audio", source: { type: "url", url: block.data } }
        : {
            type: "audio",
            source: { type: "base64", media_type: block.mimeType, data: block.data },
          };
    case "tool_call":
      return { type: "tool_use", id: block.id, name: block.name, input: block.input };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: block.toolCallId,
        content: block.content.map((content) => ({ type: "text", text: content.text })),
        is_error: block.isError,
      };
  }
}

function toAnthropicTool(tool: CanonicalToolSchema): AnthropicTool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  };
}

function toAnthropicToolChoice(toolChoice: CanonicalToolChoice | undefined): Record<string, unknown> | undefined {
  if (!toolChoice) {
    return undefined;
  }

  if (toolChoice === "auto") {
    return { type: "auto" };
  }
  if (toolChoice === "none") {
    return { type: "none" };
  }
  if (toolChoice === "required") {
    return { type: "any" };
  }

  return { type: "tool", name: toolChoice.name };
}
