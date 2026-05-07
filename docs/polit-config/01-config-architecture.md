# Config 模块架构

本文定义重写方案中 `src/polit/config` 的职责、边界和内部结构。该模块属于 `polit` 基础层，与 `src/polit/paths`、`src/polit/runtime` 一起为上层 agent runtime 提供产品级默认行为。

## 定位

`polit/config` 是配置系统的唯一入口。

它负责：

- 解析 `PolitConfigPath`。
- 读取用户级配置和项目级配置。
- 合并配置来源。
- 解析环境变量和 secret 引用。
- 校验总配置结构。
- 生成不可变 `PolitConfigSnapshot`。
- 向业务模块分发配置段。
- 监听配置变化并热重载。
- 产出配置诊断、变更事件和审计记录。

它不负责：

- 直接执行模型请求。
- 直接执行工具。
- 直接决定权限结果。
- 直接构造 prompt。
- 直接管理 session transcript。
- 在模块内部保存业务运行状态。

## 依赖方向

`polit/config` 位于架构底层，只能依赖通用基础能力：

```text
polit/config
  -> polit/paths
  -> shared/fs
  -> shared/schema
  -> shared/errors
  -> shared/events
```

上层模块依赖它：

```text
agent
model
context
tool
permission
session
extension
adapters
  -> polit/config
```

`polit/config` 不应反向依赖 `agent`、`model`、`tool` 或任意 adapter。配置模块可以知道配置段名字，但不能调用配置段所属模块的运行时代码。

## 核心对象

### PolitConfigPath

`PolitConfigPath` 是默认总配置路径：

```text
~/.politdeck/politdeck.yaml
```

路径解析由 `polit/paths` 负责。`polit/config` 只调用路径解析 API，不在模块内部拼接用户主目录。

### PolitConfigSource

配置来源的抽象描述。

建议至少包含：

```text
kind: user | project | env | cli | default
path?: string
priority: number
loadedAt: timestamp
contentHash?: string
```

`source` 用于诊断和审计。用户看到配置冲突、无效字段或热重载失败时，必须能知道问题来自哪一层配置。

### PolitRawConfig

`PolitRawConfig` 是 YAML 解析后的未校验对象。它只能在 config 模块内部流转，不能暴露给业务模块。

### PolitConfigSnapshot

`PolitConfigSnapshot` 是业务模块唯一能消费的配置对象。

要求：

- 不可变。
- 有版本号。
- 有来源摘要。
- 有内容 hash。
- 有加载时间。
- 有 schema 版本。
- 已完成默认值填充。
- 已完成配置段拆分。
- 已完成 secret 引用解析或保留受控 secret handle。

建议结构：

```text
PolitConfigSnapshot
  version
  schemaVersion
  loadedAt
  contentHash
  sources
  diagnostics
  config
    polit
    model
    loop
    context
    tool
    permission
    session
    extension
    telemetry
```

业务模块拿到 snapshot 后只读取自己关心的配置段。

### PolitConfigStore

`PolitConfigStore` 是运行时内存中的快照仓库。

职责：

- 保存当前有效 snapshot。
- 保存最近一次失败 reload 的诊断。
- 提供 `getSnapshot()`。
- 提供 `subscribe(listener)`。
- 原子发布新 snapshot。
- 在热重载失败时保留旧 snapshot。

### PolitConfigLoader

`PolitConfigLoader` 是纯加载流程。

```text
load sources
  -> parse YAML
  -> merge
  -> resolve env and secret refs
  -> validate
  -> normalize
  -> freeze snapshot
```

该流程应可独立测试，不依赖真实 watcher、UI 或 agent loop。

### PolitConfigWatcher

`PolitConfigWatcher` 监听配置来源变化，并触发 reload。它不直接修改业务模块状态，只向 `PolitConfigStore` 提交加载结果。

## 模块边界

### 与 polit/paths

`polit/paths` 负责：

- `PolitHome`。
- `PolitConfigPath`。
- `PolitMemoryDir`。
- `PolitSessionDir`。
- `PolitCacheDir`。
- `PolitExtensionDir`。

`polit/config` 负责读取和校验这些路径是否被配置覆盖。路径默认值仍由 `polit/paths` 定义。

### 与 adapters

CLI、TUI、SDK、remote adapter 可以传入临时覆盖项，例如：

```text
--config
--model
--permission-mode
--workspace
```

这些覆盖项必须先进入 `polit/config` 的 source/override 流程，再变成 snapshot。adapter 不应绕过 config store 直接修改业务模块。

### 与业务模块

业务模块只接收配置段：

```text
model consumes snapshot.config.model
permission consumes snapshot.config.permission
tool consumes snapshot.config.tool
context consumes snapshot.config.context
```

业务模块可以做配置段级别的二次校验，但不能重新读取总 YAML。

## 生命周期

启动时：

```text
resolve paths
  -> load config
  -> publish initial snapshot
  -> start watcher
  -> create AgentSession
```

运行时：

```text
file changed
  -> debounce
  -> load candidate snapshot
  -> classify changes
  -> publish if valid
  -> emit config events
```

关闭时：

```text
stop watcher
  -> flush config diagnostics if needed
  -> dispose subscribers
```

## 设计原则

配置系统必须保持保守：

- 缺失配置用明确默认值处理，不能隐式猜测危险行为。
- 无效配置不覆盖当前有效配置。
- 当前 turn 使用启动该 turn 时绑定的 snapshot。
- 新 snapshot 默认只影响后续 turn，除非某配置明确标记为 runtime-live。
- secret 不进入普通日志、transcript 或模型上下文。
- 配置事件可观测，但配置值输出必须脱敏。

