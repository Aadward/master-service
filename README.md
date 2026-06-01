# Master-Service 设计文档

中央客户配置分发服务（master-service）的设计文档集合。

## 一句话定位

> Master-service 是 **客户配置的调度员 + 最小数据字典管家**，**不是**上帝服务。

每次新增 customer 时，由它向各 ERP 模块（Sales / MRP / PLM / CRM / Finance …）分发
"轮到你了"的信号，并基于客户的**最小核心字段**为各域**导出建议配置项**；
各域根据**统一的依赖顺序**自行完成各自的自定义配置，并把"完成/失败"状态回报。

## 职责边界

| Master-service **做** | Master-service **不做** |
|---|---|
| 维护客户最小核心字段（各域交集） | 持有任何域的自定义配置内容 |
| 维护跨域配置的依赖顺序（DAG） | 校验域内字段的业务规则 |
| 广播 / 暴露"轮到你了"信号 | 主动写入其他系统 |
| 基于核心字段派生"建议配置项" | 决定下游是否采纳建议 |
| 跟踪"谁配完了 / 卡在哪一环" | 持有下游域的配置结果细节 |
| 提供面向运维的进度视图 | 做跨域的回滚 / 补偿 |

## 文档导航

| 文档 | 内容 |
|---|---|
| [01-design-overview.md](docs/01-design-overview.md) | 设计目标、哲学、边界、整体架构 |
| [02-task-state-machine.md](docs/02-task-state-machine.md) | 任务状态机详细图与不变量 |
| [03-dag-scheduling.md](docs/03-dag-scheduling.md) | DAG 调度时序图（push / pull 双模式） |
| [04-suggested-config.md](docs/04-suggested-config.md) | "建议配置项"的派生规则与示例 |
| [05-data-model.md](docs/05-data-model.md) | 数据模型与 DDL |
| [06-api-contract.md](docs/06-api-contract.md) | 对外 REST 接口契约 |
| [07-pitfalls-and-invariants.md](docs/07-pitfalls-and-invariants.md) | 易踩坑点与边界守护 |
| [08-roadmap.md](docs/08-roadmap.md) | 演进路径建议 |

## 当前状态

设计阶段。尚未开始实现。
