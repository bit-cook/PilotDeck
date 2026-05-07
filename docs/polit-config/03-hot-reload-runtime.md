# 配置热重载运行时

本文定义 `polit/config` 热重载的运行时语义。目标是在不重启 `PolitDeck` 的情况下让配置变更对后续工作生效，同时保证正在执行的 turn 不被破坏。

## 热重载目标

配置热重载必须满足：

- 文件变化能被自动发现。
- 新配置完整解析和校验后才发布。
- 发布新 snapshot 是原子操作。
- 无效配置不会覆盖当前有效配置。
- 当前 turn 的行为保持稳定。
- 后续 turn 能使用最新有效配置。
- 关键变更产生事件和审计记录。
- secret 不泄露到日志、事件或 transcript。

## 非目标

热重载不意味着所有配置都能立即修改运行中对象。

不建议支持：

- 中途替换正在流式响应的模型请求。
- 中途修改当前 turn 的 context budget。
- 中途替换当前 session 的 transcript backend。
- 在工具执行过程中强行卸载该工具实现。
- 自动迁移正在连接的 MCP transport 到新认证信息。

这些行为会让 turn 语义不稳定，应通过变更分类控制。

## 核心原则

### Snapshot 绑定

每个 turn 在开始时绑定一个 `PolitConfigSnapshot`：

```text
turn.started
  -> configStore.getSnapshot()
  -> turn.configSnapshot = snapshot
```

该 turn 后续的 model、context、tool、permission 默认都读取这个 snapshot。这样可以避免同一 turn 内配置前后不一致。

### 原子发布

热重载流程必须先构造候选 snapshot：

```text
file changed
  -> load candidate
  -> validate candidate
  -> classify diff
  -> publish candidate
```

只有候选 snapshot 完全有效时，才替换 `ConfigStore.current`。

### 失败保旧

如果 reload 失败：

```text
current snapshot remains active
lastReloadError = diagnostics
emit config.reload.failed
```

运行时继续使用旧 snapshot。

## Watcher 设计

`PolitConfigWatcher` 应监听：

- `~/.politdeck/politdeck.yaml`。
- 当前 workspace 的项目级配置。
- 未来可选的 include 文件。

实现要求：

- 使用 debounce 合并短时间内的多次写入。
- 处理编辑器保存时的 rename/write 临时文件行为。
- 处理文件被删除、重建、权限变化。
- 处理符号链接解析后的真实路径。
- watcher 失败时降级为手动 reload，不应导致 agent loop 崩溃。

建议 debounce：

```text
100ms - 500ms
```

配置文件通常很小，不需要复杂增量解析。每次 reload 都可以完整读取和校验。

## 手动 Reload

除自动 watcher 外，应提供手动 reload API：

```text
configStore.reload(reason)
```

常见来源：

- CLI 命令。
- SDK 调用。
- UI 设置页保存。
- 测试用例。
- watcher 降级后的人工触发。

手动 reload 与 watcher reload 共享同一条加载和校验路径。

## 变更分类

热重载必须对新旧 snapshot 做 diff，并给出变更分类。

建议分类：

```text
runtime-live
next-turn
next-session
restart-required
invalid
```

### runtime-live

可以对尚未执行的运行时决策立即生效。

示例：

- 日志级别。
- telemetry 开关。
- 权限规则中尚未使用的 allow/deny/ask 条目。
- headless ask 行为。

即使是 `runtime-live`，也不能修改已完成的权限决策或已发出的事件。

### next-turn

只对后续 turn 生效。

示例：

- 默认模型。
- context token budget。
- compact threshold。
- tool result budget。
- loop maxTurns。
- tool concurrency limit。
- enabled/disabled tools。
- prompt fragment 开关。

这是大多数配置的默认分类。

### next-session

只对新 session 生效。

示例：

- session transcript flush policy。
- workspace roots 的强约束变更。
- extension dirs 的大范围变更。
- session resume 策略。

当前 session 可以继续运行，但新 session 使用新配置。

### restart-required

必须重启进程才能生效。

示例：

- storage backend 类型切换。
- PolitHome 大幅迁移。
- cache/session/memory 根目录迁移。
- 运行时 adapter transport 切换。
- 底层进程级 proxy 或证书配置。

reload 可以接受这些配置并记录诊断，但必须明确标记有未生效变更。

### invalid

候选配置无效，不能发布。

示例：

- YAML 语法错误。
- required 字段缺失。
- API key 引用的环境变量不存在。
- 默认模型不存在。
- 权限模式非法。
- workspace root 越界。

## 配置事件

热重载应进入统一事件流，但不要进入模型上下文。

建议事件：

```text
config.load.started
config.load.completed
config.load.failed
config.reload.detected
config.reload.started
config.reload.completed
config.reload.failed
config.snapshot.published
config.restart.required
```

事件 payload 建议包含：

```text
snapshotVersion
previousSnapshotVersion
schemaVersion
changedPaths
changeClasses
sourceSummaries
diagnostics
```

payload 中不能包含未脱敏 secret。

## Snapshot 发布协议

`ConfigStore.subscribe()` 的 listener 不应直接执行重活。

建议协议：

```text
subscribe((event) => {
  event.previousSnapshot
  event.nextSnapshot
  event.diff
  event.changeClasses
})
```

listener 要求：

- 不能阻塞发布路径太久。
- 不能抛出未捕获异常。
- 不能修改 snapshot。
- 需要异步重建资源时，应创建自己的后台任务。

## 模块响应热重载

### Model

`model` 模块对后续请求读取新配置。

可热重载：

- default model。
- provider timeout。
- headers。
- retry。
- model capabilities。
- multimodal constraints。

谨慎处理：

- API key 改变后，新请求使用新 key；已有请求不切换。
- provider URL 改变后，新请求使用新 URL；连接池可延迟重建。

### Context

`context` 模块只对后续 turn 使用新 budget。

当前 turn 的 compact boundary、tool result budget 和 overflow recovery 策略必须保持一致。

### Tool

工具注册表需要以版本化 contribution 方式更新：

```text
toolRegistryVersion += 1
```

后续 tool detection 和 permission decision 使用新 registry。已开始执行的工具不被中断，除非用户显式 abort。

### Permission

权限配置可以影响尚未决策的工具调用。

为了避免同一 turn 内安全策略前后不一致，建议默认仍绑定 turn snapshot。若产品要求更强安全性，可以允许 `alwaysDeny` 和 `readOnlyMode` 这类收紧型变更立即生效，但必须记录：

```text
permission.policy.updated_during_turn
```

### Extension

扩展热重载需要分阶段：

```text
discover extension dirs
  -> load manifests
  -> validate contributions
  -> publish contribution set
```

正在执行的 hook 不被中断。新 hook、prompt fragment、tool contribution 对后续 turn 生效。

### Session

session storage 变更通常不能热替换当前 session。当前 session 继续使用创建时的 store，新 session 使用新配置。

## 并发与竞态

必须处理：

- 多次 reload 并发触发。
- reload 时用户提交新 turn。
- reload 时 adapter 创建新 session。
- reload 时扩展贡献正在重建。
- reload 时 MCP server 正在连接。

建议策略：

- reload 串行化，同一时间只允许一个 reload pipeline。
- 新 turn 总是读取当时已发布的最新 snapshot。
- 候选 snapshot 不对外可见。
- resource rebuild 可以异步，但必须绑定目标 snapshot version。
- 过期 rebuild 完成后不得覆盖更新版本。

## 删除配置文件

如果用户删除 `~/.politdeck/politdeck.yaml`：

- watcher 应触发 reload。
- loader 应回退到 defaults 和其他来源。
- 如果缺失必需配置导致无法构造有效 snapshot，保留旧 snapshot。
- 诊断应明确提示配置文件缺失。

是否允许无配置启动取决于默认配置是否能满足最小运行条件。若没有可用模型，启动可以成功但提交 turn 时应给出明确模型配置错误。

## 回滚

热重载失败天然回滚到旧 snapshot。

如果新 snapshot 已发布但业务资源重建失败，应区分：

- snapshot 已生效。
- 某模块资源未完成切换。

模块应发出自己的诊断，例如：

```text
mcp.server.reload.failed
extension.reload.failed
model.provider.reload.failed
```

必要时该模块继续使用旧资源，直到下一次 reload 成功。

## 安全策略

热重载可能改变安全边界，因此必须审计：

- permission mode 变化。
- workspace root 变化。
- shell policy 变化。
- network policy 变化。
- MCP server 新增或 URL 改变。
- extension dir 新增。
- bypassPermissions 开启。

这些变更应进入 audit log，并在交互式 UI 中提示用户。

## 推荐默认语义

为了降低复杂度，默认采用：

- 当前 turn 绑定旧 snapshot。
- 后续 turn 使用新 snapshot。
- 安全收紧项可选立即生效。
- storage/path 大变更要求重启。
- reload 失败保留旧 snapshot。

这个语义最容易测试，也最不容易让 agent loop 在真实项目中出现不可解释行为。
