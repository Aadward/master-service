# 02 · 任务状态机

每个 task 表示**某个域在某个客户上要完成的一段配置**（粒度建议是"一页一 task"
或"一个域内逻辑单元一 task"）。Master-service 不存 task 的配置内容，只跟踪它的状态。

## 1. 状态全景

```
                         [Customer 被创建 / 模板生效]
                                      │
                                      │  物化任务（按 customer_type 模板）
                                      ▼
   ┌───────────────────────────────────────────────────────────────────┐
   │                            WAITING                                │
   │   依赖尚未满足；不暴露在"领取队列"中；不向下游广播                  │
   └────────────────────────────┬──────────────────────────────────────┘
                                │
                                │ 所有 depends_on 进入 DONE / SKIPPED
                                ▼
   ┌───────────────────────────────────────────────────────────────────┐
   │                             READY                                 │
   │  · 出现在 /customers/{id}/next-tasks 队列                          │
   │  · 同步计算「建议配置项」(suggested_config)                        │
   │  · 可通过事件广播 customer.task.ready                              │
   │  · 等待下游 ack（push 模式）或下游主动拉取（pull 模式）             │
   └────────────────────────────┬──────────────────────────────────────┘
                                │
                                │ 下游 ack：claim(task_id, owner)
                                │     ── 或者 ──
                                │ master 推送被对方接收
                                ▼
   ┌───────────────────────────────────────────────────────────────────┐
   │                           CLAIMED                                 │
   │  下游已经认领；记录 owner / claim_at；超时未完成会回收到 READY      │
   └────────────────────────────┬──────────────────────────────────────┘
                                │
                                │ 下游开始落地配置（可选回执）
                                ▼
   ┌───────────────────────────────────────────────────────────────────┐
   │                         IN_PROGRESS                               │
   │  下游正在自行配置；可上报阶段性 note（不持久化配置内容）            │
   └─────────┬───────────────────────┬───────────────────────────┬─────┘
             │                       │                           │
       下游报告完成               下游报告失败                下游声明 N/A
             ▼                       ▼                           ▼
   ┌──────────────────┐    ┌──────────────────┐         ┌──────────────────┐
   │       DONE       │    │      FAILED      │         │     SKIPPED      │
   │ 终态；触发后继    │    │ 终态（可恢复）    │         │ 终态；同样触发后继│
   └──────────┬───────┘    └────────┬─────────┘         └──────────┬───────┘
              │                     │                              │
              │                  人工/自动 retry                    │
              │                     ▼                              │
              │              [回到 READY]                          │
              │                                                    │
              └───────────────► 重新评估后继任务 ◄──────────────────┘
                                       │
                                       ▼
                        WAITING 中满足依赖的任务  →  READY

   ─────────────  特殊轨道  ─────────────
   任意非终态  → BLOCKED   （人工挂起；解除后回到 WAITING 重评估）
   任意非终态  → CANCELLED （客户取消 / 模板变更裁剪）
```

## 2. 状态字典

| 状态 | 含义 | 是否终态 |
|---|---|---|
| WAITING | 依赖未满足，暂不可执行 | 否 |
| READY | 依赖已满足，可被下游领取 | 否 |
| CLAIMED | 已被某个下游 owner 认领 | 否 |
| IN_PROGRESS | 下游已开始执行（可选） | 否 |
| DONE | 下游报告完成 | 是 |
| FAILED | 下游报告失败 | 是（可重试回 READY） |
| SKIPPED | 此 task 对该客户不适用 | 是 |
| BLOCKED | 人工挂起，暂不调度 | 是（可解除回 WAITING） |
| CANCELLED | 客户取消 / 模板裁剪 | 是 |

## 3. 转换规则与触发方

| From | To | 触发方 | 触发条件 |
|---|---|---|---|
| (init) | WAITING | Master | 客户创建 + 模板物化 |
| WAITING | READY | Master | 所有 `depends_on` 都进入 DONE/SKIPPED |
| READY | CLAIMED | 下游 | `POST /tasks/{id}/claim` |
| CLAIMED | IN_PROGRESS | 下游 | `POST /tasks/{id}/start`（可选） |
| CLAIMED / IN_PROGRESS | DONE | 下游 | `POST /tasks/{id}/done` |
| CLAIMED / IN_PROGRESS | FAILED | 下游 | `POST /tasks/{id}/failed` |
| READY / CLAIMED | SKIPPED | 下游或人工 | `POST /tasks/{id}/skip` |
| FAILED | READY | 人工 / 调度器 | `POST /tasks/{id}/retry` |
| CLAIMED / IN_PROGRESS | READY | Master | claim 超时自动回收 |
| 任意非终态 | BLOCKED | 人工 | `POST /tasks/{id}/block` |
| BLOCKED | WAITING | 人工 | `POST /tasks/{id}/unblock` |
| 任意非终态 | CANCELLED | 系统 | 客户取消 / 模板裁剪 |

## 4. 关键不变量（Invariants）

| 不变量 | 说明 |
|---|---|
| **READY 才暴露 suggested_config** | WAITING 阶段上游可能改写 minimum data，提前导出会失效 |
| **DONE 与 SKIPPED 同等触发后继** | SKIPPED 不应阻塞 DAG 推进 |
| **CLAIMED 必有超时** | 例如 30 min；防止下游崩溃后任务被"占死" |
| **FAILED 可重试，retry_count 单调递增** | 用于熔断 + 升级人工 |
| **同一 task_id 多次 done 必须幂等** | 下游可能因网络重发回执 |
| **状态迁移必写 audit_log** | 不可篡改的合规底线 |
| **WAITING / BLOCKED 不广播事件** | 避免下游收到无意义提示 |

## 5. 失败语义分级

`failed_reason_code` 建议至少区分两类，决定重试策略：

| 类型 | 例子 | 自动重试 | 升级人工 |
|---|---|---|---|
| **瞬时失败** | 下游系统不可用、超时、网络抖动 | ✅ 指数退避 | 阈值后 |
| **业务失败** | 下游字段校验不通过、缺少前置物料 | ❌ | 立即 |

## 6. 超时与回收

- **CLAIMED 超时**：claim 后 `claim_timeout_minutes`（默认 30）内未进入 IN_PROGRESS/DONE
  → 自动回收为 READY；`claim_owner` 清空
- **IN_PROGRESS 超时**：可配置 `progress_timeout_minutes`（默认更长，如 24 h）
  → 自动置 FAILED，等待人工
- 所有超时回收都写 audit_log
