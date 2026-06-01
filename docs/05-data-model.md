# 05 · 数据模型

> 设计原则：master-service **只存**身份、最小集合、任务状态、模板、审计、字典。
> **不存**任何下游域的具体配置值。

## 1. 表清单

| 表 | 作用 |
|---|---|
| `customer` | 客户主数据（最小集合） |
| `config_task` | 配置任务（只跟踪状态） |
| `config_template` | 模板定义 |
| `lookup_table` | 派生规则用的字典 |
| `audit_log` | 状态迁移审计 |

## 2. DDL

### 2.1 customer · 客户最小集合

```sql
CREATE TABLE customer (
    customer_id      VARCHAR(32)  PRIMARY KEY,
    name             VARCHAR(200) NOT NULL,

    -- 各域交集字段（实际字段集需团队讨论后冻结）
    country          VARCHAR(8),
    industry         VARCHAR(50),
    customer_type    VARCHAR(50),
    legal_entity     VARCHAR(100),
    default_currency VARCHAR(8),

    -- 整体状态
    overall_status   VARCHAR(20) NOT NULL,    -- INIT/IN_PROGRESS/READY/PARTIAL/CANCELLED
    template_id      VARCHAR(50) NOT NULL,
    template_version INT         NOT NULL,

    -- 元信息
    created_at       TIMESTAMP NOT NULL,
    created_by       VARCHAR(100),
    updated_at       TIMESTAMP NOT NULL,
    updated_by       VARCHAR(100)
);

CREATE INDEX idx_customer_status ON customer(overall_status);
```

### 2.2 config_task · 任务状态

```sql
CREATE TABLE config_task (
    task_id              BIGSERIAL PRIMARY KEY,
    customer_id          VARCHAR(32) NOT NULL REFERENCES customer,
    module               VARCHAR(50) NOT NULL,     -- sales/mrp/plm/...
    task_key             VARCHAR(100) NOT NULL,    -- sales.customer_profile
    page_ref             VARCHAR(100),

    status               VARCHAR(20) NOT NULL,     -- WAITING/READY/CLAIMED/IN_PROGRESS/DONE/FAILED/SKIPPED/BLOCKED/CANCELLED
    depends_on           BIGINT[],                 -- 依赖的 task_id 列表

    -- 派生快照（READY 时冻结，不随 min_data 变化）
    suggested_config_snapshot JSONB,

    -- 认领信息
    claim_owner          VARCHAR(100),
    claimed_at           TIMESTAMP,
    claim_timeout_at     TIMESTAMP,

    -- 重试 / 失败
    retry_count          INT NOT NULL DEFAULT 0,
    last_error_code      VARCHAR(50),
    last_error_msg       TEXT,

    -- 时间戳
    created_at           TIMESTAMP NOT NULL,
    ready_at             TIMESTAMP,
    started_at           TIMESTAMP,
    completed_at         TIMESTAMP,

    UNIQUE (customer_id, task_key)     -- 幂等关键约束
);

CREATE INDEX idx_task_customer_status ON config_task(customer_id, status);
CREATE INDEX idx_task_module_status   ON config_task(module, status);
CREATE INDEX idx_task_claim_timeout   ON config_task(claim_timeout_at)
    WHERE status IN ('CLAIMED', 'IN_PROGRESS');
```

**关键约束说明：**
- `UNIQUE(customer_id, task_key)`：同一客户同一任务键只能存在一条，保证幂等
- `suggested_config_snapshot`：在 WAITING→READY 时一次性写入，之后只读
- `claim_timeout_at`：用于后台扫描超时认领并回收
- **没有** `payload` 字段：master 不存下游配置内容（与初版设计的差异点）

### 2.3 config_template · 模板

```sql
CREATE TABLE config_template (
    template_id      VARCHAR(50) NOT NULL,
    version          INT         NOT NULL,
    customer_type    VARCHAR(50) NOT NULL,
    definition       JSONB       NOT NULL,    -- YAML 解析后的对象
    is_active        BOOLEAN     NOT NULL DEFAULT false,
    created_at       TIMESTAMP   NOT NULL,
    created_by       VARCHAR(100),
    PRIMARY KEY (template_id, version)
);

CREATE INDEX idx_template_active ON config_template(customer_type, is_active);
```

**模板 JSON 结构**（与 [04-suggested-config.md](04-suggested-config.md) 一致）：

```json
{
  "customer_type": "standard_b2b",
  "modules": {
    "sales": {
      "tasks": [
        {
          "task_key": "sales.customer_profile",
          "page_ref": "Sales-Page-01",
          "required": true,
          "depends_on": [],
          "suggestions": {
            "currency": "${lookup.currency_by_country[customer.country]}",
            "payment_terms": "NET30"
          }
        }
      ]
    }
  }
}
```

### 2.4 lookup_table · 字典

```sql
CREATE TABLE lookup_table (
    name        VARCHAR(64)  PRIMARY KEY,    -- 'currency_by_country'
    version     INT          NOT NULL,
    entries     JSONB        NOT NULL,       -- {"JP":"JPY","US":"USD",...}
    description TEXT,
    updated_at  TIMESTAMP    NOT NULL,
    updated_by  VARCHAR(100)
);
```

### 2.5 audit_log · 审计

```sql
CREATE TABLE audit_log (
    id            BIGSERIAL PRIMARY KEY,
    customer_id   VARCHAR(32),
    task_id       BIGINT,
    event_type    VARCHAR(50) NOT NULL,    -- task_state_change / customer_create / template_apply / ...
    from_status   VARCHAR(20),
    to_status     VARCHAR(20),
    actor         VARCHAR(100),            -- system / 用户 / 下游模块
    reason        TEXT,
    extra         JSONB,                   -- 任意附加上下文
    created_at    TIMESTAMP NOT NULL
);

CREATE INDEX idx_audit_task_time ON audit_log(task_id, created_at);
CREATE INDEX idx_audit_cust_time ON audit_log(customer_id, created_at);
```

## 3. 状态机迁移与表的对应

| 状态迁移 | 表变更 | 是否写 audit |
|---|---|---|
| 客户创建 | INSERT customer + N×INSERT config_task | ✅ |
| WAITING→READY | UPDATE config_task.status + suggested_config_snapshot | ✅ |
| READY→CLAIMED | UPDATE claim_owner / claimed_at / claim_timeout_at | ✅ |
| CLAIMED→DONE | UPDATE status / completed_at | ✅ |
| *→FAILED | UPDATE status / retry_count / last_error_* | ✅ |
| *→SKIPPED | UPDATE status / completed_at | ✅ |
| FAILED→READY (retry) | UPDATE status / 保留 retry_count | ✅ |

## 4. 不存什么

明确**不**进入 master-service 的表：

- 下游域的实际配置内容（Sales 给客户配的 price_list 具体值）
- 下游域的内部状态（Sales 是否完成了二级审批）
- 跨域回滚状态（一旦 DONE，状态在下游域）
- 与配置无关的客户业务数据（订单、发票、BOM）

> 如果某天发现自己想加这些表，应该回头检查是否在滑向"上帝服务"。
