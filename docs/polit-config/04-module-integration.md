# Config 与业务模块集成

本文定义 `agent`、`model`、`context`、`tool`、`permission`、`session`、`extension` 和 adapter 如何消费 `polit/config`。

## 集成原则

所有业务模块遵循同一原则：

- 只消费 `PolitConfigSnapshot` 或自己的配置段。
- 不直接读取 `~/.politdeck/politdeck.yaml`。
- 不直接读取环境变量作为配置来源。
- 不保存可变配置对象引用。
- 不在模块内部自行合并 CLI 参数。
- 对配置段做必要的模块内语义校验。

推荐模式：

```text
runtime creates snapshot
  -> module receives section
  -> module builds runtime options
  -> turn binds snapshot version
```

## Agent

`agent` 模块通过 `AgentSession` 接收 config store。

建议：

```text
AgentRuntime
  configStore
  modelRuntime
  contextRuntime
  toolRuntime
  permissionRuntime
  sessionRuntime
```

每次 submit：

```text
AgentSession.submit(input)
  -> snapshot = configStore.getSnapshot()
  -> TurnRunner.run(input, snapshot)
```

`agent` 不应直接解释所有配置字段，只需要：

- 把 snapshot 绑定到 turn。
- 把对应配置段传给子模块。
- 在事件中记录 snapshot version。
- 在配置热重载后让后续 turn 使用新 snapshot。

## Model

`model` 模块消费：

```text
snapshot.config.model
```

职责：

- 校验 provider 协议。
- 构建 provider registry。
- 根据默认 provider/model 构建请求。
- 根据 model capabilities 决定 tool、streaming、thinking、JSON schema 等能力。
- 根据 multimodal constraints 校验 canonical content blocks。

热重载语义：

- 当前模型请求不切换。
- 后续模型请求使用新配置。
- API key、headers、timeout、URL 变化只影响新请求。
- model list 和 capabilities 变化需要重建 provider registry 版本。

`model` 可以暴露：

```text
modelRuntime.forSnapshot(snapshot)
```

或：

```text
modelRuntime.resolveModel(snapshot.config.model, requestOptions)
```

避免在请求中重新访问全局状态。

## Context

`context` 模块消费：

```text
snapshot.config.context
snapshot.config.model.selectedModel.capabilities
snapshot.config.model.selectedModel.multimodal
snapshot.config.extension.promptFragments
```

职责：

- 组装 system prompt。
- 投影附件、memory、MCP resources。
- 控制 token budget。
- 裁剪 tool result。
- 执行 compact 和 overflow recovery。

热重载语义：

- 当前 turn 的 context 配置固定。
- 后续 turn 使用新配置。
- memory 开关变化只影响后续 context build。
- prompt fragment 贡献变化只影响后续 context build。

`context` 必须知道当前模型的 multimodal constraints，因为它要在模型请求前决定某类 content block 是否允许进入 canonical messages。

## Tool

`tool` 模块消费：

```text
snapshot.config.tool
snapshot.config.extension.toolContributions
```

职责：

- 构建 ToolRegistry。
- 应用 enabled/disabled tools。
- 配置内置工具限制。
- 配置 MCP server。
- 配置 shell、file、glob、web 等工具参数。

热重载语义：

- 已开始执行的工具继续使用启动时的 runtime context。
- 新工具调用使用 turn snapshot 对应的 tool registry。
- MCP server 新增可以为后续 turn 注册新工具。
- MCP server 删除不应杀死正在执行的 tool call，除非用户 abort。

工具运行上下文必须记录：

```text
toolCallId
turnId
configSnapshotVersion
toolRegistryVersion
permissionDecisionId
```

## Permission

`permission` 模块消费：

```text
snapshot.config.permission
snapshot.config.tool
snapshot.config.extension.permissionRules
```

职责：

- 判断 allow/deny/ask/cancel。
- 校验 workspace root。
- 校验 shell 风险。
- 校验文件写入和网络访问。
- 处理 `default`、`plan`、`bypassPermissions`。
- 生成审计记录。

热重载语义：

- 默认按 turn snapshot 决策。
- 对安全收紧配置，可以支持立即生效。
- 已完成的 permission decision 不被修改。
- `bypassPermissions` 开启必须有显式来源和审计。

建议决策事件包含：

```text
permissionMode
configSnapshotVersion
matchedRules
source
```

## Session

`session` 模块消费：

```text
snapshot.config.session
snapshot.config.polit.sessionDir
```

职责：

- 创建 transcript store。
- append event。
- flush。
- resume。
- replay。
- migration。

热重载语义：

- 当前 session 绑定创建时的 storage backend。
- flush policy 可以对当前 session 谨慎热更新。
- storage backend 和 session dir 改变通常只对新 session 生效或要求重启。
- resume 读取旧 transcript 时必须记录当时的 config snapshot version；恢复后可使用当前最新配置继续新 turn。

transcript 不应保存完整 secret 配置。只记录：

```text
configSnapshotVersion
contentHash
sourceSummary
```

## Extension

`extension` 模块消费：

```text
snapshot.config.extension
snapshot.config.polit.extensionDir
```

职责：

- 发现扩展。
- 读取 manifest。
- 校验 contribution。
- 注册 tools、commands、hooks、prompt fragments、resources、permission rules、renderers。

热重载语义：

- extension dirs 变化触发 contribution rebuild。
- contribution set 版本化。
- 后续 turn 使用新 contribution set。
- 正在执行的 hook 不被中断。
- 扩展加载错误不能污染全局 config snapshot；应作为 extension 诊断附着到 snapshot 或后续事件中。

## Adapters

CLI、TUI、SDK、Web、Remote adapter 都应通过 `polit/config` 注入覆盖项。

### CLI

CLI flag 示例：

```text
--config
--model
--permission-mode
--workspace
--read-only
```

这些 flag 不应直接改业务模块，而是形成高优先级 source。

### SDK

SDK options 示例：

```text
Agent.create({
  configPath,
  overrides,
  workspaceRoots
})
```

SDK 需要能拿到配置诊断，方便调用方在 headless 环境展示错误。

### UI/TUI

UI/TUI 可以订阅 config events，用于提示：

- 配置已重载。
- 配置重载失败。
- 某些变更需要重启。
- 安全边界发生变化。

UI 不应保存配置事实来源。设置页保存后仍由 config loader 重新读取并发布 snapshot。

## Config Facade

建议给上层暴露一个小型 facade：

```text
PolitConfigRuntime
  getSnapshot()
  reload(reason)
  subscribe(listener)
  getDiagnostics()
```

不要暴露 loader 内部细节给业务模块。

## 生效范围矩阵

```text
配置项                         默认生效范围
model.defaultModel             next-turn
model.provider.url             next-turn
model.provider.apiKey          next-turn
context.maxContextTokens       next-turn
context.autoCompact            next-turn
tool.enabledTools              next-turn
tool.mcpServers                next-turn / next-session
permission.alwaysDeny          runtime-live 或 next-turn
permission.permissionMode      next-turn
session.storageBackend         restart-required
session.flushPolicy            next-session 或 runtime-live
extension.extensionDirs        next-turn / next-session
polit.home                     restart-required
telemetry.logLevel             runtime-live
```

具体实现可以从保守策略开始：除日志和诊断外，绝大多数变更只对后续 turn 生效。

## 模块内二次校验

总配置 schema 只能校验通用结构。业务模块仍要做模块语义校验。

示例：

- `model` 校验 protocol adapter 是否存在。
- `tool` 校验 MCP transport 是否可创建。
- `permission` 校验 rule matcher 是否可编译。
- `extension` 校验 hook command 是否符合安全策略。
- `session` 校验 storage backend 是否可打开。

这些错误应带上 config path 和 snapshot version，便于定位。

## 禁止模式

实现时应避免：

- 模块启动时读取一次配置后永远不更新。
- 每次工具调用都重新读 YAML。
- 在 agent loop 内直接访问 process env。
- 让 CLI flag 绕过 config snapshot。
- 在 transcript 中记录未脱敏配置。
- 在热重载时修改当前 turn 的内部状态机。

`polit/config` 的价值在于让运行时所有入口共享同一份配置事实来源。