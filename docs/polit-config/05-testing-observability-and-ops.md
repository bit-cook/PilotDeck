# 测试、可观测性与运维

本文定义 `polit/config` 模块的测试策略、诊断输出、审计要求和运维细节。

## 测试目标

`polit/config` 必须从第一天具备确定性测试。配置系统是所有运行时模块的入口，错误会放大到模型、工具、权限和会话系统。

测试应覆盖：

- YAML 读取。
- 多来源合并。
- 默认值填充。
- schema 校验。
- secret 引用解析。
- 配置段拆分。
- snapshot 不可变性。
- 热重载成功。
- 热重载失败保旧。
- 变更分类。
- 事件和诊断脱敏。
- watcher 竞态。

## 单元测试

建议测试对象：

```text
parseYamlConfig()
mergeConfigSources()
resolveConfigSecrets()
validatePolitConfig()
normalizePolitConfig()
createConfigSnapshot()
diffConfigSnapshots()
classifyConfigChanges()
redactConfigForDiagnostics()
```

重点用例：

- 空配置生成安全默认值。
- 缺失 `schemaVersion` 产生 warning。
- 未知字段产生 warning。
- 非法 enum 产生 error。
- array 覆盖而不是拼接。
- `null` 清空可选字段。
- `${ENV}` 引用成功。
- `${ENV}` 缺失失败。
- 明文 API key 产生 warning。
- 默认模型不存在时报错。
- permission mode 非法时报错。
- workspace root 越界时报错。

## 热重载测试

热重载需要 fake fs 和 fake clock。

建议用例：

```text
valid file change publishes new snapshot
invalid file change keeps previous snapshot
rapid writes are debounced
delete file falls back or reports diagnostics
rename temp file save is handled
concurrent reloads are serialized
stale async rebuild cannot overwrite newer snapshot
restart-required changes are reported
secret changes are not logged
```

必须验证：

- `snapshot.version` 单调递增。
- reload 失败时 version 不变。
- `lastReloadError` 可查询。
- `config.reload.failed` 事件包含诊断。
- 当前 turn 绑定旧 snapshot。
- 后续 turn 使用新 snapshot。

## 集成测试

集成测试应覆盖 config 与核心模块的连接。

建议场景：

- 修改默认模型后，新 turn 使用新模型。
- 修改 context budget 后，当前 turn 不变化，新 turn 生效。
- 禁用工具后，新 turn 不再暴露该工具。
- 修改 permission mode 后，新 turn 使用新模式。
- 新增 MCP server 后，后续 registry 出现新 MCP tools。
- 修改 extension dirs 后，后续 prompt fragment 更新。
- 切换 storage backend 被标记为 restart-required。

这些测试可以使用 fake model、fake tool、fake permission、fake session store，不需要真实外部服务。

## Conformance Tests

配置系统应提供跨入口一致性测试：

```text
CLI config loading
SDK config loading
TUI config loading
remote config loading
```

同一组 source 输入必须产出相同 snapshot。

adapter 只能增加自己的高优先级 override，不能改变合并和校验语义。

## 诊断输出

配置诊断应面向用户可读，也要适合机器处理。

建议结构：

```text
ConfigDiagnostic
  code
  severity
  message
  path
  source
  hint
  redactedValue?
```

示例：

```text
code: CONFIG_MODEL_DEFAULT_NOT_FOUND
severity: error
path: model.defaultModel
source: ~/.politdeck/politdeck.yaml
hint: Add the model under model.providers.<provider>.models or change model.defaultModel.
```

诊断中的 path 使用配置路径，不使用源码路径。

## 脱敏规则

以下字段必须脱敏：

- `apiKey`。
- `authorization` header。
- `cookie` header。
- token、secret、password、credential 相关字段。
- MCP server auth 信息。
- proxy credential。

脱敏输出：

```text
<redacted>
```

可选保留 hash 或后四位用于排查：

```text
<redacted:sha256:abcd1234>
```

任何脱敏 hash 都不能用于恢复原 secret。

## 日志

建议日志事件：

```text
config.load.start
config.load.success
config.load.failure
config.reload.detected
config.reload.success
config.reload.failure
config.snapshot.publish
config.change.restart_required
config.secret.reference_missing
```

日志必须包含：

- snapshot version。
- source summary。
- config hash。
- changed paths。
- diagnostics count。

日志不能包含完整配置内容。

## Audit

安全相关配置变化必须进入 audit。

包括：

- `permission.permissionMode`。
- `permission.readOnlyMode`。
- `permission.workspaceRoots`。
- `permission.alwaysAllow`。
- `permission.alwaysDeny`。
- `tool.mcpServers`。
- `tool.shellPolicy`。
- `tool.networkPolicy`。
- `extension.extensionDirs`。
- `model.provider.url`。
- `model.provider.headers` 中的认证相关变化。

audit 记录应包含：

```text
timestamp
actor
source
previousSnapshotVersion
nextSnapshotVersion
changedPaths
changeClass
```

交互式 UI 可以把高风险变更显示给用户确认。headless 场景至少要写入 audit sink。

## Metrics

建议指标：

```text
config_load_total
config_load_failed_total
config_reload_total
config_reload_failed_total
config_snapshot_version
config_reload_duration_ms
config_diagnostics_total
config_restart_required_total
config_watcher_errors_total
```

标签应控制基数：

```text
result=success|failure
reason=parse|validation|secret|io|unknown
source=user|project|env|cli|runtime
```

不要把配置 path、workspace path 或 secret 名称作为高基数标签。

## Debug 命令

建议 CLI 提供：

```text
politdeck config validate
politdeck config doctor
politdeck config print --redacted
politdeck config sources
politdeck config reload
```

命令语义：

- `validate`：读取并校验配置，不启动 agent runtime。
- `doctor`：检查路径、权限、secret 引用、模型默认值、MCP server 基本连通性。
- `print --redacted`：输出最终合并后的脱敏配置。
- `sources`：输出所有参与合并的 source 和优先级。
- `reload`：对正在运行的 runtime 触发手动 reload。

## 失败处理

启动失败：

- YAML 语法错误：阻止启动。
- 必需 secret 缺失：阻止需要该 provider 的模型请求；是否阻止启动取决于是否有可用默认模型。
- permission 配置非法：阻止启动。
- session dir 不可写：如果 transcript 必需则阻止启动。

热重载失败：

- 保留旧 snapshot。
- 发布 failure 事件。
- 记录诊断。
- UI/CLI 显示错误。
- 不影响当前 turn。

模块资源重建失败：

- snapshot 可以已发布。
- 模块继续使用旧资源或降级。
- 记录模块级 reload failure。
- 后续 reload 可恢复。

## 性能要求

配置加载应足够轻量：

- 小型 YAML reload 应在几十毫秒内完成。
- secret 解析不能做慢速网络请求。
- watcher debounce 避免编辑器保存风暴。
- snapshot diff 只比较结构化配置，不扫描工作区。
- extension discovery 可以异步进行，但要绑定 snapshot version。

如果未来 secret backend 或 remote config 需要网络访问，应把它们设计为独立 provider，并明确 timeout、cache 和失败策略。

## 文档与示例

配置模块应维护示例文件：

```text
examples/politdeck.yaml
examples/politdeck.minimal.yaml
examples/politdeck.headless.yaml
examples/politdeck.readonly.yaml
```

示例必须保持可通过 `config validate`。包含 secret 的示例只能使用 `${ENV_NAME}`。

## 发布前检查清单

实现 `polit/config` 前，至少确认：

- 是否有总 schema。
- 是否有默认值表。
- 是否有 source 优先级测试。
- 是否有热重载失败保旧测试。
- 是否有 secret 脱敏测试。
- 是否有 restart-required 变更分类。
- 是否有当前 turn 绑定 snapshot 的行为测试。
- 是否有 CLI/SDK 一致性测试。

配置系统完成后，其他模块才应该接入真实运行时配置。