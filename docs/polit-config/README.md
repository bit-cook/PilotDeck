# Polit Config 模块文档

本目录用于管理重写方案中 `src/polit/config` 相关设计文档。

`polit/config` 是 `PolitDeck` 的全局配置入口，负责读取、解析、校验、合并和热重载 `~/.politdeck/politdeck.yaml` 以及项目级配置，并向 `agent`、`model`、`context`、`tool`、`permission`、`session`、`extension` 等模块提供稳定的配置快照。

## 文档结构

1. `[01-config-architecture.md](./01-config-architecture.md)`
  定义 `polit/config` 的职责、边界、内部结构、依赖方向和运行时对象。
2. `[02-config-schema-and-sources.md](./02-config-schema-and-sources.md)`
  定义配置来源、优先级、总 YAML 结构、配置段拆分、密钥引用和校验规则。
3. `[03-hot-reload-runtime.md](./03-hot-reload-runtime.md)`
  定义配置热重载的 watcher、快照发布、变更分类、原子性、回滚和事件语义。
4. `[04-module-integration.md](./04-module-integration.md)`
  定义各业务模块如何消费配置，以及哪些配置可以影响新 turn、当前 turn 或必须重启。
5. `[05-testing-observability-and-ops.md](./05-testing-observability-and-ops.md)`
  定义配置模块的测试、诊断、审计、可观测性和运维要求。

## 核心目标

- 全局配置集中在 `PolitConfigPath = ~/.politdeck/politdeck.yaml`。
- 业务模块只消费解析后的配置段，不直接读取 YAML、环境变量或用户目录。
- 配置读取结果以不可变快照形式发布，避免运行时共享可变对象。
- 支持热重载，并保证热重载不会破坏正在执行的 turn。
- 配置错误必须结构化、可展示、可诊断、可恢复。

## 与其他文档的关系

本目录细化 `[../rewrite-plan/](../rewrite-plan/)` 中 `src/polit/config` 的设计。`model` 模块如何消费 `model` 配置段见 `[../model/03-model-configuration.md](../model/03-model-configuration.md)`。