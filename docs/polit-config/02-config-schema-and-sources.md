# 配置 Schema 与来源

本文定义 `polit/config` 需要支持的配置来源、优先级、总 YAML 结构、配置段拆分和校验规则。

## 配置文件

默认用户级配置文件：

```text
~/.politdeck/politdeck.yaml
```

该路径由 `PolitConfigPath` 表达。当前阶段只要求这一份用户级总配置稳定可用；项目级配置和 CLI 覆盖可以进入设计，但实现时可以分阶段交付。

## 配置来源

建议配置来源按优先级从低到高排列：

```text
built-in defaults
  < user config: ~/.politdeck/politdeck.yaml
  < project config: <workspace>/.politdeck.yaml
  < environment overrides
  < adapter/runtime overrides
```

说明：

- `built-in defaults` 提供安全默认值。
- `user config` 是主配置。
- `project config` 只描述工作区相关覆盖，不应保存用户 secret。
- `environment overrides` 适合 CI/headless 场景。
- `adapter/runtime overrides` 来自 CLI flag、SDK options 或 remote request。

所有来源都必须记录在 `PolitConfigSnapshot.sources` 中。

## 合并规则

合并规则必须可预测：

- map 按 key 深度合并。
- scalar 由高优先级覆盖低优先级。
- array 默认整体替换，不做去重拼接。
- 对于 `alwaysAllow`、`alwaysDeny`、`enabledTools` 这类策略数组，可以未来显式支持 `append` 语法，但不要默认猜测。
- `null` 表示显式清空可选字段。
- 未知字段默认报 warning；稳定版可以升级为 error。

不建议支持复杂模板、条件语句或脚本化配置。配置文件应保持声明式。

## 总配置结构

建议总 YAML 结构：

```yaml
schemaVersion: 1

polit:
  home: ~/.politdeck
  cacheDir: ~/.politdeck/cache
  sessionDir: ~/.politdeck/sessions
  memoryDir: ~/.politdeck/memory
  extensionDir: ~/.politdeck/extensions

model:
  defaultProvider: anthropic-main
  defaultModel: claude-sonnet-4-5
  providers: {}

loop:
  maxTurns: 20
  streamingToolExecution: true
  toolConcurrencyLimit: 4
  continueOnToolError: false
  abortTimeoutMs: 10000

context:
  maxContextTokens: 180000
  autoCompact: true
  compactThreshold: 0.85
  toolResultBudget:
    maxTokensPerResult: 20000
    maxTotalTokens: 60000
  memoryEnabled: true
  contextOverflowRecovery: true

tool:
  enabledTools: []
  disabledTools: []
  toolPresets: []
  mcpServers: {}
  shellTimeoutMs: 120000
  fileReadLimitBytes: 1048576
  globResultLimit: 200

permission:
  permissionMode: default
  workspaceRoots: []
  alwaysAllow: []
  alwaysDeny: []
  alwaysAsk: []
  readOnlyMode: false
  headlessAskBehavior: deny

session:
  transcriptEnabled: true
  resumeEnabled: true
  storageBackend: file
  flushPolicy: after-event

extension:
  hooksEnabled: true
  pluginsEnabled: true
  skillsEnabled: true
  extensionDirs: []
  hookTimeoutMs: 30000
  hookFailurePolicy: warn

telemetry:
  enabled: false
  logLevel: info
```

## 配置段职责

### polit

`polit` 段描述产品级路径和运行时命名空间。

关键规则：

- 默认值来自 `polit/paths`。
- 用户可以覆盖目录，但必须经过路径安全校验。
- 所有路径都应展开 `~`，并归一化为绝对路径。
- 不允许业务模块自行拼接这些目录。

### model

`model` 段描述 provider、model list、URL、headers、timeout、API key 引用、capabilities 和 multimodal constraints。

具体字段见 `[../model/03-model-configuration.md](../model/03-model-configuration.md)`。

### loop

`loop` 段影响 agent loop 状态机。

建议字段：

```text
maxTurns
streamingToolExecution
toolConcurrencyLimit
continueOnToolError
abortTimeoutMs
maxModelRequestsPerTurn
```

这些配置一般只对新 turn 生效。

### context

`context` 段影响上下文预算、memory、compact 和 overflow recovery。

建议字段：

```text
maxContextTokens
autoCompact
compactThreshold
toolResultBudget
memoryEnabled
contextOverflowRecovery
attachmentLimits
```

热重载时，当前 turn 不应中途替换 context budget，避免同一 turn 内压缩边界不稳定。

### tool

`tool` 段描述内置工具、MCP server、shell、文件读取和搜索限制。

关键规则：

- 禁用工具必须优先于启用工具。
- MCP server 配置热重载需要区分新增、删除、连接参数变化。
- shell/file/network 类配置属于安全相关配置，热重载必须审计。

### permission

`permission` 段是安全边界。

`permissionMode` 至少支持：

```text
default
plan
bypassPermissions
```

建议字段：

```text
workspaceRoots
alwaysAllow
alwaysDeny
alwaysAsk
readOnlyMode
headlessAskBehavior
networkPolicy
shellPolicy
fileWritePolicy
```

权限配置变化可以立即影响尚未执行的工具调用，但不能 retroactively 修改已经完成的权限决策。

### session

`session` 段描述 transcript、resume、storage backend 和 flush policy。

关键规则：

- 已创建的 session 应绑定创建时的 transcript store。
- 切换 storage backend 通常需要重启。
- `transcriptEnabled` 关闭后仍应保留最低限度错误和审计事件，除非运行环境明确要求完全无持久化。

### extension

`extension` 段描述插件、技能、hooks 和扩展目录。

关键规则：

- 新增扩展可以对后续 turn 生效。
- 删除扩展不能中断当前正在执行的 hook。
- 扩展贡献的工具、权限规则和 prompt fragment 必须重新收集并产生新贡献版本。

## Secret 引用

当前阶段支持环境变量引用：

```yaml
model:
  providers:
    anthropic-main:
      apiKey: ${ANTHROPIC_API_KEY}
```

解析规则：

- `${NAME}` 从环境变量读取。
- 缺失环境变量是配置错误。
- 明文 secret 允许但应产生 warning。
- 日志、诊断、事件和 snapshot debug 输出必须脱敏。

未来可以扩展：

```yaml
apiKey:
  from: keychain
  name: anthropic-main
```

或：

```yaml
auth:
  type: oauth
  tokenStore: polit
```

但当前阶段不实现 OAuth。

## Schema 版本

`schemaVersion` 必须是顶层字段。

建议策略：

- 缺失时按 `1` 处理并 warning。
- 大于当前支持版本时报错。
- 小版本兼容通过迁移器完成。
- 迁移必须产生诊断，说明从哪个版本迁移到哪个版本。

## 校验层次

配置校验分三层：

```text
syntax validation
  -> structural validation
  -> semantic validation
```

`syntax validation` 检查 YAML 是否可解析。

`structural validation` 检查字段类型、枚举值、必填字段和默认值。

`semantic validation` 检查跨字段关系，例如：

- `model.defaultProvider` 必须存在。
- `model.defaultModel` 必须属于默认 provider。
- `permission.workspaceRoots` 必须在允许边界内。
- `context.compactThreshold` 必须在 `(0, 1]`。
- `tool.toolConcurrencyLimit` 不能超过 loop 或 runtime 限制。
- `extension.extensionDirs` 必须是可信目录或经过权限确认。

## 错误模型

配置错误建议统一为：

```text
ConfigError
  code
  message
  source
  path
  severity
  recoverable
  hint
```

`severity` 支持：

```text
info
warning
error
fatal
```

启动时遇到 `fatal` 应阻止 runtime 启动。热重载时遇到 `fatal` 不应替换当前 snapshot，而是保留旧配置并发布 `config.reload.failed`。