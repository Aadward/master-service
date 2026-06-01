# 06 · API 契约

> 所有接口围绕**状态机**设计（见 [02-task-state-machine.md](02-task-state-machine.md)），
> 凡能引起状态迁移的写接口，都必须**幂等**。

## 1. 接口总览

| 接口 | 状态迁移 | 调用方 |
|---|---|---|
| `POST /customers` | 物化任务 → 部分进入 READY | Admin / 上游系统 |
| `GET /customers/{id}` | 不变（查询） | 任何方 |
| `GET /customers/{id}/status` | 不变（查询） | Admin |
| `GET /customers/{id}/dag` | 不变（查询） | Admin |
| `GET /customers/{id}/next-tasks?owner=...` | 不变（查询） | 下游域（pull 模式） |
| `GET /customers/{id}/tasks/{task_key}` | 不变（查询） | 下游域 |
| `GET /tasks/{task_id}` | 不变（查询） | 下游域 |
| `POST /tasks/{task_id}/claim` | READY → CLAIMED | 下游域 |
| `POST /tasks/{task_id}/start` | CLAIMED → IN_PROGRESS | 下游域（可选） |
| `POST /tasks/{task_id}/done` | * → DONE，触发后继 | 下游域 |
| `POST /tasks/{task_id}/failed` | * → FAILED | 下游域 |
| `POST /tasks/{task_id}/skip` | * → SKIPPED | 下游域 / 人工 |
| `POST /tasks/{task_id}/retry` | FAILED → READY | 人工 |
| `POST /tasks/{task_id}/block` | * → BLOCKED | 人工 |
| `POST /tasks/{task_id}/unblock` | BLOCKED → WAITING | 人工 |

## 2. 关键接口详细

### 2.1 创建客户

```http
POST /customers
Content-Type: application/json
Idempotency-Key: req-uuid-xxx

{
  "external_ref": "CRM-12345",
  "name": "Acme Japan",
  "country": "JP",
  "industry": "Auto",
  "customer_type": "standard_b2b",
  "legal_entity": "Acme Japan KK",
  "default_currency": "JPY"
}
```

```http
201 Created
Location: /customers/C0001

{
  "customer_id": "C0001",
  "overall_status": "INIT",
  "template_id": "standard_b2b",
  "template_version": 3,
  "tasks_total": 33,
  "tasks_ready": 5,
  "links": {
    "status": "/customers/C0001/status",
    "dag":    "/customers/C0001/dag"
  }
}
```

### 2.2 下游拉取下一批任务

```http
GET /customers/C0001/next-tasks?owner=sales&limit=20
```

```json
{
  "items": [
    {
      "task_id": 4711,
      "task_key": "sales.customer_profile",
      "page_ref": "Sales-Page-01",
      "status": "READY",
      "ready_at": "2026-06-01T10:23:45Z"
    },
    {
      "task_id": 4712,
      "task_key": "sales.shipping_address",
      "page_ref": "Sales-Page-02",
      "status": "READY",
      "ready_at": "2026-06-01T10:23:45Z"
    }
  ],
  "next_cursor": null
}
```

### 2.3 查看任务详情（含 suggested_config）

```http
GET /customers/C0001/tasks/sales.customer_profile
```

```json
{
  "task_id": 4711,
  "task_key": "sales.customer_profile",
  "status": "READY",
  "customer_min_data": {
    "customer_id": "C0001",
    "name": "Acme Japan",
    "country": "JP",
    "industry": "Auto",
    "customer_type": "B2B"
  },
  "suggested_config": {
    "currency": "JPY",
    "tax_region": "JP",
    "price_book": "B2B_JP",
    "payment_terms": "NET30"
  },
  "guide": {
    "page_ref": "Sales-Page-01",
    "next_after_done": ["sales.shipping_address", "mrp.demand_planning_rule"],
    "doc_url": "https://wiki.internal/sales/customer-profile"
  }
}
```

### 2.4 认领任务

```http
POST /tasks/4711/claim
Content-Type: application/json
Idempotency-Key: req-uuid-yyy

{
  "owner": "sales-service-pod-7",
  "ttl_minutes": 30
}
```

```json
{
  "task_id": 4711,
  "status": "CLAIMED",
  "claimed_at": "2026-06-01T10:30:00Z",
  "claim_timeout_at": "2026-06-01T11:00:00Z"
}
```

**幂等性**：同一 `(task_id, owner)` 重复 claim 返回相同结果（不重置 timeout）。
不同 owner 重复 claim 返回 409 Conflict。

### 2.5 报告完成

```http
POST /tasks/4711/done
Content-Type: application/json
Idempotency-Key: req-uuid-zzz

{
  "owner": "sales-service-pod-7",
  "note": "configured manually by user U123"      // 可选；不存配置值
}
```

```json
{
  "task_id": 4711,
  "status": "DONE",
  "completed_at": "2026-06-01T10:45:12Z",
  "newly_ready_tasks": [
    { "task_id": 4712, "task_key": "sales.shipping_address" },
    { "task_id": 4720, "task_key": "mrp.demand_planning_rule" }
  ]
}
```

返回的 `newly_ready_tasks` 让下游可立刻知道自己后续有没有新工作（也可继续靠事件 / 轮询）。

### 2.6 报告失败

```http
POST /tasks/4711/failed
Content-Type: application/json

{
  "owner": "sales-service-pod-7",
  "reason_code": "VALIDATION_FAILED",   // 或 TRANSIENT_ERROR
  "message": "tax_region 'JP' not configured in Sales tax catalog"
}
```

```json
{
  "task_id": 4711,
  "status": "FAILED",
  "retry_count": 1,
  "auto_retry_at": null,                 // 业务失败不自动重试
  "requires_human": true
}
```

`reason_code` 决定重试策略（见 [02-task-state-machine.md §5](02-task-state-machine.md#5-失败语义分级)）。

### 2.7 整体进度查询

```http
GET /customers/C0001/status
```

```json
{
  "customer_id": "C0001",
  "overall_status": "IN_PROGRESS",
  "progress": { "total": 33, "done": 17, "skipped": 2, "failed": 1, "in_progress": 3, "waiting": 10 },
  "blockers": [
    {
      "task_id": 4720,
      "task_key": "mrp.demand_planning_rule",
      "status": "FAILED",
      "reason_code": "VALIDATION_FAILED",
      "message": "...",
      "blocks_count": 4
    }
  ],
  "modules": {
    "sales":   { "done": 5, "total": 5,  "status": "READY" },
    "crm":     { "done": 3, "total": 3,  "status": "READY" },
    "finance": { "done": 4, "total": 6,  "status": "IN_PROGRESS" },
    "mrp":     { "done": 0, "total": 8,  "status": "FAILED" },
    "plm":     { "done": 0, "total": 11, "status": "WAITING" }
  }
}
```

### 2.8 查看 DAG

```http
GET /customers/C0001/dag
```

```json
{
  "nodes": [
    { "task_id": 4711, "task_key": "sales.customer_profile", "status": "DONE" },
    { "task_id": 4712, "task_key": "sales.shipping_address", "status": "READY" }
  ],
  "edges": [
    { "from": 4711, "to": 4712 },
    { "from": 4711, "to": 4720 }
  ]
}
```

## 3. 幂等性约定

所有写接口需带 `Idempotency-Key`（HTTP Header）：

- master-service 维护一张 `idempotency_record(key, response_hash, expires_at)` 表
- 同 key 重复请求直接返回缓存的响应（24 h 内有效）
- key 应由调用方生成（UUID v4 即可）

## 4. 错误码

| HTTP | code | 含义 |
|---|---|---|
| 400 | INVALID_TRANSITION | 当前状态不允许此动作（如对 DONE 任务 claim） |
| 404 | NOT_FOUND | 客户 / 任务不存在 |
| 409 | CONFLICT | 任务已被其他 owner 认领 |
| 409 | DUPLICATE | 客户外部引用已存在 |
| 422 | TEMPLATE_INVALID | 创建客户时模板不可用 |
| 500 | INTERNAL | 服务端错误 |

错误响应体：

```json
{
  "code": "INVALID_TRANSITION",
  "message": "Task 4711 is in status DONE, cannot claim",
  "task_id": 4711,
  "current_status": "DONE"
}
```

## 5. 事件契约（Push 模式）

Topic：`customer.config.events`（或按模块分 topic：`customer.config.<module>`）

```json
{
  "event_type": "customer.task.ready",     // 或 customer.task.failed / customer.created / ...
  "event_id": "evt_8f3a2c...",
  "occurred_at": "2026-06-01T10:23:45Z",
  "customer_id": "C0001",
  "task_id": 4711,
  "task_key": "sales.customer_profile",
  "module": "sales",
  "page_ref": "Sales-Page-01",
  "fetch_url": "/customers/C0001/tasks/sales.customer_profile"
}
```

**消费方约定**：事件只是"提示"，所有真相以 `fetch_url` 拉取为准。
