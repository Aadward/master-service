# 03 · DAG 调度时序

## 1. 示例 DAG（粗化到模块层级）

实际是 33 个细任务（task_key），下图把同模块多任务画作一组：

```
                ┌──── Sales ────┐
   [client]──►─┤                ├──► [MRP] ──► [PLM]
                └──── CRM ──────┘
                       │
                       └──► [Finance]
```

## 2. 完整时序图

```
 ┌───────┐    ┌──────────────┐    ┌──────┐  ┌──────┐  ┌─────────┐  ┌──────┐
 │ Admin │    │   Master     │    │Sales │  │ CRM  │  │ Finance │  │ MRP  │  ...
 │  /UI  │    │   Service    │    │ Mod  │  │ Mod  │  │   Mod   │  │ Mod  │
 └───┬───┘    └──────┬───────┘    └──┬───┘  └──┬───┘  └────┬────┘  └──┬───┘
     │ ① POST /customers              │         │           │          │
     │   { minimum_data, type=B2B }   │         │           │          │
     ├──────────────►│                │         │           │          │
     │               │ ② 写 customer   │         │           │          │
     │               │ ③ 按模板物化 33 │         │           │          │
     │               │   条 task（全部 │         │           │          │
     │               │   WAITING）     │         │           │          │
     │               │ ④ 计算 DAG，把  │         │           │          │
     │               │   入度=0 的任务 │         │           │          │
     │               │   置为 READY    │         │           │          │
     │ 201 + cust_id │                │         │           │          │
     │◄──────────────┤                │         │           │          │
     │               │                │         │           │          │
     │               │ ⑤ 广播 customer.task.ready              ⇨ 多 topic
     │               ├───event─►──────│         │           │          │
     │               ├───event─►──────────────► │           │          │
     │               │                │         │           │          │
     │               │       (Sales、CRM 互不依赖，同时进入 READY)        │
     │               │                │         │           │          │
     │               │ ⑥ Sales claim：│ POST /tasks/{id}/claim          │
     │               │◄───────────────┤         │           │          │
     │               │ 200 OK + suggested_config│           │          │
     │               ├───────────────►│         │           │          │
     │               │  task → CLAIMED│         │           │          │
     │               │                │         │           │          │
     │               │  ⑥' CRM 拉取（pull 模式）│           │          │
     │               │  GET /customers/{id}/next-tasks?owner=crm        │
     │               │◄─────────────────────────│           │          │
     │               │ 200 OK [task_a, task_b] + suggested │           │
     │               ├─────────────────────────►│           │          │
     │               │                │         │           │          │
     │               │                │ ⑦ Sales 在自己系统里完成配置    │
     │               │                │  （内容 master 不感知）         │
     │               │                │         │ ⑦' CRM 同理          │
     │               │                │         │           │          │
     │               │ ⑧ POST /tasks/{id}/done  │           │          │
     │               │◄───────────────┤         │           │          │
     │               │  task → DONE   │         │           │          │
     │               │ 重新评估 DAG    │         │           │          │
     │               │                │         │           │          │
     │               │ ⑧' POST /tasks/{id}/done │           │          │
     │               │◄─────────────────────────┤           │          │
     │               │  task → DONE   │         │           │          │
     │               │ Sales+CRM 都完 → 后继可执行            │          │
     │               │                │         │           │          │
     │               │ ⑨ Finance、MRP 的相关任务 WAITING → READY        │
     │               │                                      │          │
     │               ├──event──► customer.task.ready ──────►│          │
     │               ├──event──► customer.task.ready ─────────────────►│
     │               │                                      │          │
     │               │                                      │ Finance  │
     │               │                                      │ claim &  │
     │               │                                      │ done...  │
     │               │                                                 │
     │               │                                                 │ MRP 同样
     │               │                                                 │
     │               │  ⑩ Finance & MRP done → PLM 入度=0 → READY       │
     │               │                                                            ─► PLM
     │               │                                                            ...
     │               │
     │ ⑪ GET /customers/{id}/status                                    │
     ├──────────────►│                                                 │
     │ {progress:32/33, READY:[plm.x], DONE:[...], FAILED:[]}          │
     │◄──────────────┤                                                 │
```

## 3. 失败分支

```
     │               │ POST /tasks/{id}/failed { reason_code, msg }
     │               │◄────────────── 下游 ────────────────
     │               │  task → FAILED；retry_count++
     │               │  · 瞬时失败 & 未达阈值：自动 → READY 重试（指数退避）
     │               │  · 达阈值或业务失败：升级人工 → 仍 FAILED，等待 /retry
     │               │  · 阻塞下游任务保持 WAITING（不会越过失败前置）
```

## 4. 双模式说明：Push vs Pull

Master-service **同时支持** 两种通知模式，下游域按自身成熟度选择。

| 模式 | 触发方式 | 适合 | 实现 |
|---|---|---|---|
| **Push（推）** | Master 广播事件 `customer.task.ready` | 现代化、已接 MQ 的模块 | Kafka / RabbitMQ topic per module |
| **Pull（拉）** | 下游定时调用 `/next-tasks?owner=...` | 老旧、无法监听 MQ 的模块 | 简单 REST 轮询 |

两种模式**对状态机表现一致**：下游最终都通过 `claim → done / failed` 闭环。

### Push 模式（事件示意）

```json
Topic: customer.config.events
Event:
{
  "event_type": "customer.task.ready",
  "event_id": "evt_8f3a...",
  "occurred_at": "2026-06-01T10:23:45Z",
  "customer_id": "C0001",
  "task_id": 4711,
  "task_key": "sales.customer_profile",
  "module": "sales",
  "page_ref": "Sales-Page-01",
  "fetch_url": "/customers/C0001/tasks/4711"
}
```

下游收到事件后，按 `fetch_url` 拉取完整 task 详情（含 `minimum_data` 和
`suggested_config`），再决定是否 claim。

### Pull 模式

```
GET /customers/C0001/next-tasks?owner=sales
↓
[
  { "task_id": 4711, "task_key": "sales.customer_profile", "status": "READY", ... },
  { "task_id": 4712, "task_key": "sales.shipping_address",  "status": "READY", ... }
]
```

## 5. 调度器内部循环

Master-service 内部的 DAG 调度器，每收到一次终态回执（DONE / SKIPPED / FAILED）
就执行一轮：

```
on_task_terminal(task):
    if task.status in (DONE, SKIPPED):
        for succ in successors(task):
            if all(dep.status in (DONE, SKIPPED) for dep in succ.depends_on):
                succ.status = READY
                suggested = template_engine.derive(succ, customer.min_data)
                emit_event("customer.task.ready", succ, suggested)
                audit(succ, WAITING -> READY)
    elif task.status == FAILED:
        # 后继保持 WAITING，等本任务恢复
        # 若超过 retry 阈值，标记 customer.overall_status = PARTIAL
        ...
    update_customer_overall_status(customer)
```

## 6. 整体状态聚合

Customer 的 `overall_status` 是任务状态的聚合：

| 任务集合状况 | overall_status |
|---|---|
| 全部 WAITING / READY | INIT |
| 至少一个非终态 + 无 FAILED | IN_PROGRESS |
| 全部 DONE / SKIPPED | READY |
| 全部终态，但存在 FAILED / BLOCKED | PARTIAL |
| 客户被取消 | CANCELLED |
