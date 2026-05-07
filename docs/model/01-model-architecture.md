# Model 模块架构

`model` 模块是 agent loop 与外部模型服务之间的协议适配层。它不负责工具执行、权限判断、上下文压缩或 session 持久化，只负责模型请求、响应、流式事件、错误和 usage 的统一转换。

## 职责

`model` 模块负责：

- 校验和消费全局 config 模块传入的 `model` 配置段。
- 根据配置选择 provider。
- 将内部 `CanonicalModelRequest` 转换为厂商请求。
- 支持 Anthropic 和 OpenAI 两类协议格式。
- 解析非流式和流式响应。
- 将厂商事件归一化为 `CanonicalModelEvent`。
- 归一化错误、usage、finish reason、tool call、thinking/text delta 等信息。
- 暴露 model capabilities 和 multimodal constraints，供 agent loop、context 和 request builder 判断工具调用、thinking、JSON schema 与多模态输入支持。

## 非职责

`model` 模块不负责：

- OAuth 登录流程。
- 用户交互式认证。
- 工具执行。
- 权限判断。
- prompt 组装。
- context compact。
- 输入附件解析。
- context attachment 注入。
- 多模态附件读取、MIME 探测、压缩、token 估算或预算裁剪。
- transcript 写入。
- UI 输出。

这些能力应分别归属于 `permission`、`tool`、`context`、`session`、`adapters` 等模块。

## 建议目录结构

重写方案中的 `model` 目录建议调整为：

```text
src/model/
  config/
    parseModelConfig.ts
    schema.ts
    resolveCredentials.ts

  protocol/
    canonical.ts
    capabilities.ts
    multimodal.ts
    errors.ts

  providers/
    anthropic/
      request.ts
      response.ts
      stream.ts
      defaults.ts
    openai/
      request.ts
      response.ts
      stream.ts
      defaults.ts

  request/
    buildModelRequest.ts
    validateModelRequest.ts

  response/
    parseModelResponse.ts
    normalizeUsage.ts
    normalizeFinishReason.ts

  streaming/
    streamModel.ts
    normalizeStreamEvent.ts

  errors/
    normalizeModelError.ts
```

该结构比原先的 `clients/request-builder/providers/streaming` 更明确，因为模型模块的核心难点不是“client 类”，而是协议转换、配置解析、响应归一化和能力声明。

## 核心接口

建议内部只暴露少量稳定接口：

```text
ModelConfigParser.parse(globalConfig.model) -> ModelConfig
ModelProviderRegistry.get(providerId) -> ModelProvider
Model.stream(request, config) -> AsyncIterable<CanonicalModelEvent>
Model.complete(request, config) -> Promise<CanonicalModelResponse>
```

全局 `polit/config` 模块负责读取 `~/.politdeck/politdeck.yaml` 并解析总配置。`model` 模块只接收其中的 `model` 段，校验模型配置结构、解析 credentials 引用并产出 `ModelConfig`。`agent` 模块只依赖 `Model.stream()` 和选定 model 的 capabilities / multimodal constraints，不直接依赖 Anthropic/OpenAI 的 SDK 类型。

## Canonical Protocol

内部统一协议至少包括：

```text
CanonicalModelRequest
CanonicalMessage
CanonicalContentBlock
CanonicalToolSchema
CanonicalToolCall
CanonicalToolResult
CanonicalModelEvent
CanonicalModelResponse
CanonicalUsage
CanonicalModelError
```

所有 provider adapter 都负责在 canonical protocol 和厂商协议之间转换。

## Model Capabilities

每个具体 model 必须声明能力：

```text
supportsToolUse
supportsStreaming
supportsParallelToolCalls
supportsThinking
supportsJsonSchema
supportsSystemPrompt
supportsPromptCache
maxContextTokens
maxOutputTokens
```

capabilities 表达通用模型能力，不包含具体多模态类型。多模态支持由 `multimodal` 结构单独表达，例如 `input: ["text", "image", "pdf"]` 和对应限制项。

同一个 provider 下的不同 model 可以有不同 capabilities 和 multimodal constraints。agent loop 根据选定 model 的 capabilities 决定请求构造策略，context 根据 multimodal constraints 判断已经归一化的 `CanonicalContentBlock` 是否可发送，而不是在 loop 中硬编码某个厂商或 provider 的特殊逻辑。

## 与 Agent Loop 的边界

`agent` 向 `model` 提交已经准备好的请求：

```text
AgentLoop
  -> Context.prepareForModel()
  -> Model.stream(canonicalRequest)
  -> Tool.detectToolCalls()
```

`Context.prepareForModel()` 负责把用户输入、文件、IDE selection、memory、MCP resources 和其他 context attachments 解析/投影为 `CanonicalMessage.content`。`model` 不接收独立 `attachments` 字段，只处理已经进入 canonical messages 的内容块。

`model` 返回统一事件：

```text
model.request.started
model.message.delta
model.message.completed
model.tool_call.delta
model.completed
model.failed
```

`model` 不直接执行工具。工具调用只以事件或 assistant message 的形式返回给 `agent`，由 `tool` 和 `permission` 继续处理。