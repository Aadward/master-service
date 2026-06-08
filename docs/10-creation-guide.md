# 10 · 创建引导（Creation Guide · 简化版）

> **目标**：在中央主数据服务中，为每个新业务对象（customer / location / …）
> 配套一个 **人工配置向导**——以 DAG 形式串联跨团队的子域配置任务，
> 并通过 **checkpoint SQL** 主动验证完成情况。
>
> **设计取舍**：**配置全在 JSON / DB 表，状态表只跟踪"做没做"**。
> 模板里只放 DAG 结构（节点、依赖、checkpoint key 引用），具体 checkpoint SQL
> 抽到 `checkpoint_def` 表里**跨模板复用**。DB 一共 **4 张表**：
> `creation_guide_template` / `creation_guide_instance` / `guide_node_status` / `checkpoint_def`。
>
> **存储引擎**：MySQL 8.0+
> **配套 DDL**：[`10-creation-guide.sql`](10-creation-guide.sql)
> **与 config_task 的关系**：本设计是 **人工 / 异构子系统场景** 的编排层，
> 独立于 `config_task`（自动派发层）。两者**不互通**，可共存。

---

## 1. 核心思想

业务对象（以 customer 为代表）在中央平台被创建后，**仅维护最小集合 + 属性**；
真正的"可用"还要在若干**异构子系统**里完成各自的配置。中央平台没办法自动下发——
每个子系统的数据结构和维护方式都不同。

**折中方案**：当创建一个新业务对象时，配套生成一份"配置向导"。
向导 = 一份 **YAML/JSON 模板的实例化**（描述 DAG 拓扑）+ 一张 **节点完成状态表**。
节点上挂的 checkpoint 是 **key 引用**，具体 SQL 在独立的 `checkpoint_def` 表里。

```
            ┌────────────────────────────┐
            │  YAML 模板                 │
            │  · 节点 + 依赖             │
            │  · checkpoint key 列表     │
            └──────────────┬─────────────┘
                           │ 物化
                           ▼
   ┌──────────────────────────────────────────────┐
   │ creation_guide_instance                       │
   │   · 模板版本冻结快照                          │
   │   · overall_status (聚合)                    │
   └──────────────┬───────────────────────────────┘
                  │ 1:N
                  ▼
   ┌──────────────────────────────────────────────┐
   │ guide_node_status  (那张完成状态表)            │
   │   · status: WAITING/READY/DONE/FAILED/...     │
   │   · completed_at / completed_by              │
   │   · last_checkpoint_results (JSON, 最新一次) │
   └──────────────────────────────────────────────┘

   ──────────────  跨模板复用的 SQL  ──────────────
   ┌──────────────────────────────────────────────┐
   │ checkpoint_def  (独立表, 跨模板共享)            │
   │   PK: (root_type, checkpoint_key)             │
   │   · sql_template / data_source / timeout     │
   │   · deprecated_at (软删)                     │
   └──────────────────────────────────────────────┘
```

---

## 2. 模板结构（YAML / JSON）

一份模板 = `creation_guide_template` 表里的一行 + `definition` 列里的一份 JSON。
**模板只管结构**：节点、依赖、checkpoint key 引用。
**SQL 细节归 `checkpoint_def` 表管**。

### 2.1 YAML 形式（人写）

```yaml
# templates/customer_onboarding_v2.yaml
template_id: customer_onboarding_v2
version: 5
root_type: customer
customer_type: standard_b2b
display_name: 客户配置标准流程 (B2B)
description: |
  标准 B2B 客户的跨子系统配置向导;
  Sales → Finance/MRP → PLM → Audit 共 7 个节点。

nodes:
  - key: sales.account_creation
    title: 在 Sales 创建客户主数据
    team: sales
    default_owner: 张三
    domain: sales.example.com
    document_url: https://wiki.internal/runbooks/sales-account
    depends_on: []
    sort_order: 10
    estimated_minutes: 30
    require_checkpoints_on_done: true
    checkpoints:                              # ← 一组 key, 不是 SQL
      - sales.account_exists                 #   SQL 在 checkpoint_def 表
      - sales.credit_consistent

  - key: sales.contact_sync
    title: 同步联系人到 Sales
    team: sales
    default_owner: 李四
    document_url: https://wiki.internal/runbooks/sales-contact
    depends_on: [sales.account_creation]
    sort_order: 20
    require_checkpoints_on_done: true
    checkpoints:
      - sales.contact_synced

  - key: finance.tax_region_setup
    title: 在 Finance 配置税区
    team: finance
    default_owner: 王五
    document_url: https://wiki.internal/runbooks/finance-tax
    depends_on: [sales.account_creation]
    sort_order: 30
    require_checkpoints_on_done: true
    checkpoints:
      - finance.tax_region_set

  - key: mrp.demand_planning
    title: 在 MRP 配置需求计划
    team: mrp
    default_owner: 赵六
    depends_on: [sales.contact_sync]
    sort_order: 40
    require_checkpoints_on_done: false       # 无强制校验
    checkpoints: []

  - key: plm.bom_visibility
    title: 在 PLM 配置 BOM 可见性
    team: plm
    default_owner: 钱七
    depends_on: [finance.tax_region_setup, mrp.demand_planning]
    sort_order: 50
    checkpoints: []

  - key: crm.marketing_segment
    title: 在 CRM 标记营销分群
    team: crm
    default_owner: 孙八
    depends_on: [sales.account_creation]
    sort_order: 60
    checkpoints: []

  - key: audit.signoff
    title: 审计签字 (跨团队终审)
    team: ops
    default_owner: 周九
    depends_on: [plm.bom_visibility, crm.marketing_segment]
    sort_order: 99
    checkpoints: []
```

### 2.2 存到 DB 时是 JSON

`creation_guide_template.definition` 列存的等价 JSON：

```json
{
  "template_id": "customer_onboarding_v2",
  "version": 5,
  "root_type": "customer",
  "customer_type": "standard_b2b",
  "display_name": "客户配置标准流程 (B2B)",
  "description": "...",
  "nodes": [
    {
      "key": "sales.account_creation",
      "title": "在 Sales 创建客户主数据",
      "team": "sales",
      "default_owner": "张三",
      "domain": "sales.example.com",
      "document_url": "https://wiki.internal/runbooks/sales-account",
      "depends_on": [],
      "sort_order": 10,
      "estimated_minutes": 30,
      "require_checkpoints_on_done": true,
      "checkpoints": ["sales.account_exists", "sales.credit_consistent"]
    },
    {
      "key": "sales.contact_sync",
      "depends_on": ["sales.account_creation"],
      "checkpoints": ["sales.contact_synced"]
    }
  ]
}
```

### 2.3 模板的版本与生命周期

- `(template_id, version)` PK 寻址；**老版本不可变**
- 同一 `(template_id, version)` 被实例化后，模板内容**冻结**到 instance 上
- 新客户走 `is_active=true` 的最新版；老客户不受影响

---

## 3. Checkpoint 定义（独立表）

为什么 SQL 不放模板里：
- `sales.account_exists` 这种 SQL **跨模板复用**（onboarding / re-onboarding / M&A 模板都查这条）
- SQL 改了要全模板同步，单独管一处
- SQL 是**业务规则**（不是配置结构），适合放在 `checkpoint_def` 表

`checkpoint_def` 是**按 root_type 索引**的，跨模板共享。

```sql
-- 几条示例
INSERT INTO checkpoint_def VALUES
('customer', 'sales.account_exists',
 'Sales 系统中客户存在',
 'SELECT CASE WHEN COUNT(*) > 0 THEN ''PASS'' ELSE ''FAIL'' END AS status,
         CONCAT(''found '', COUNT(*), '' row(s)'') AS message
  FROM sales.account WHERE customer_id = :root_id',
 'sales_db', 10, NULL, NOW(), 'admin', NOW()),

('customer', 'sales.credit_consistent',
 'Sales credit 与中央 credit 一致',
 'SELECT
    CASE WHEN ABS(s.credit_limit - :attr_credit) < 0.01 THEN ''PASS'' ELSE ''FAIL'' END AS status,
    CONCAT(''sales='', s.credit_limit, '' central='', :attr_credit) AS message
  FROM sales.account s WHERE s.customer_id = :root_id',
 'sales_db', 10, NULL, NOW(), 'admin', NOW()),

('customer', 'sales.contact_synced',
 '联系人已同步到 Sales',
 'SELECT CASE WHEN COUNT(*) >= 1 THEN ''PASS'' ELSE ''FAIL'' END AS status,
         CONCAT(''found '', COUNT(*), '' contact(s)'') AS message
  FROM sales.contact WHERE customer_id = :root_id',
 'sales_db', 10, NULL, NOW(), 'admin', NOW()),

('customer', 'finance.tax_region_set',
 '税区已设置',
 'SELECT
    CASE WHEN tax_region IS NOT NULL THEN ''PASS'' ELSE ''FAIL'' END AS status,
    CONCAT(''tax_region='', IFNULL(tax_region, ''NULL'')) AS message
  FROM finance.customer_setup WHERE customer_id = :root_id',
 'finance_db', 10, NULL, NOW(), 'admin', NOW());
```

### 3.1 模板 → checkpoint 的引用

模板 YAML 里写 `checkpoints: [sales.account_exists, ...]`，**只是 key 列表**。
运行期应用层：
1. 按 `(root_type, checkpoint_key)` 查 `checkpoint_def`
2. 拿到的 SQL + data_source + timeout 去跑
3. 查不到 → `result_status='ERROR'`，`error_code='CHECKPOINT_NOT_FOUND'`
4. `deprecated_at` 非空 → `result_status='ERROR'`，`error_code='CHECKPOINT_DEPRECATED'`

> 模板可以**前向引用**一个还没建好的 checkpoint（CI 加载时只 warn 不 fail），
> 实际跑的时候再决定 PASS / ERROR。

### 3.2 SQL 协议

每条 checkpoint = **一条** 参数化、只读 SQL。

**参数绑定**（PreparedStatement，非字符串拼接）：

| 占位符 | 注入值 | 来源 |
|---|---|---|
| `:root_id` | 业务对象主键 | `creation_guide_instance.root_id` |
| `:root_type` | 业务对象类型 | `creation_guide_instance.root_type` |
| `:<column_name>` | 业务对象表的所有列 | `customer.*` / `location.*` |
| `:attr_<attr_key>` | 当前属性值 | `attr_value_current`（按 09） |

**返回协议**（**至多 1 行**；超过 1 行视为 SQL 编写错误，归一为 `result_status='ERROR'`，`error_code='INVALID_RESULT'`）：

| 列 | 必需 | 取值 |
|---|---|---|
| `status` | ✅ | `PASS` / `FAIL` |
| `message` | ✅ | 人类可读说明 |
| `detail` | ⛔ | JSON, 任意附加数据（展示在 UI） |

**应用层归一为 4 态**（写进 `guide_node_status.last_checkpoint_results`）：

| `result_status` | 触发条件 |
|---|---|
| `PASS` | SQL 返回 `status='PASS'` |
| `FAIL` | SQL 返回 `status='FAIL'`，**或** 0 行 |
| `ERROR` | SQL 执行报错 / 找不到 checkpoint / checkpoint 已废弃 |
| `TIMEOUT` | 超过 `timeout_seconds` |

---

## 4. 整体架构

```
                      ┌────────────────────────────┐
                      │   Admin UI / OpenAPI       │
                      └────────────┬───────────────┘
                                   │ 创建向导 / Test / Done / checkpoint CRUD
                                   ▼
   ┌──────────────────────────────────────────────────────────────┐
   │                       Master-Service                         │
   │                                                              │
   │   ┌──────────────────┐    ┌──────────────────┐               │
   │   │ Template Loader  │    │ DAG Engine       │               │
   │   │ (YAML → JSON)    │    │ - instantiate    │               │
   │   │                  │    │ - advance_dag    │               │
   │   └──────────────────┘    │ - overall_status │               │
   │                            │   aggregator     │               │
   │                            └──────────────────┘               │
   │                                                              │
   │   ┌──────────────────┐    ┌──────────────────┐               │
   │   │ Checkpoint       │    │ State Store      │               │
   │   │ Executor         │    │ (MySQL 8)        │               │
   │   │ - 查 checkpoint_ │    │  4 张表:         │               │
   │   │   def 拿 SQL     │    │  · template      │               │
   │   │ - bind params    │    │  · instance      │               │
   │   │ - run on RO pool │    │  · node_status   │               │
   │   │ - parse result   │    │  · checkpoint_   │               │
   │   └──────────────────┘    │    def           │               │
   │                            └──────────────────┘               │
   └──────────────────────────────────────────────────────────────┘
                                   │
                ┌──────────────────┼──────────────────┐
                ▼                  ▼                  ▼
         ┌────────────┐     ┌────────────┐     ┌────────────┐
         │  Sales DB  │     │ Finance DB │     │  MRP DB    │    (只读探查)
         │ (RO pool)  │     │ (RO pool)  │     │ (RO pool)  │
         └────────────┘     └────────────┘     └────────────┘
```

---

## 5. 与 config_task 的边界

两者**并存而非替代**。一个 customer 可以同时有 `config_task`（自动派发层）
和 `creation_guide`（人工配置向导），服务于不同子系统。

| 维度 | `config_task` | `creation_guide` |
|---|---|---|
| 触发 | 模板**自动**物化 | 用户**手动**创建（在 customer 创建时勾选） |
| Owner | 下游服务账号（`sales-svc-pod-7`） | 节点模板里的 `default_owner`（**人**） |
| 完成回执 | 下游系统 `POST /tasks/{id}/done` | `default_owner` 主动点 Done（可叠加 checkpoint 校验） |
| 验证机制 | 下游自报 | **SQL 主动探查**（checkpoint） |
| 适用子系统 | 能接 MQ / REST 的现代模块 | **任何**——包括老系统、外包系统、Excel 流 |
| 状态机 | 9 态（含 CLAIMED/IN_PROGRESS/超时回收） | 6 态（无超时认领） |
| 模板粒度 | 任务级（`sales.customer_profile`） | 团队+`default_owner` 级（带 Runbook 链接） |
| 失败重试 | 自动指数退避 | 人工 retry |
| 与最小集合的关系 | `suggested_config` 派生 | 无派生（向导只串联，不持有值） |

> **什么时候用 config_task**：下游能自动 ack、有自己的状态汇报协议。
> **什么时候用 creation_guide**：下游异构 / 不可控 / 人工操作。

---

## 6. 数据模型

完整 DDL 见 [`10-creation-guide.sql`](10-creation-guide.sql)。**4 张表**：

```
creation_guide_template           (元数据 + 完整 definition JSON)
            │ 1:N (按 template_id+version 引用)
            ▼
creation_guide_instance           (per 业务对象; 冻结的 definition_snapshot + overall_status)
            │ 1:N
            ▼
guide_node_status                 (per 节点; status / 完成时间 / 最新 checkpoint 结果)
       checkpoint_keys ──────────► checkpoint_def
                                  (跨模板共享的 SQL 库; 按 (root_type, key) 索引)
```

### 6.1 表清单

| 表 | 作用 |
|---|---|
| `creation_guide_template` | 模板元数据 + `definition` JSON（节点、依赖、checkpoint key 列表） |
| `creation_guide_instance` | 每个业务对象一份；冻结 `definition_snapshot`；聚合 `overall_status` |
| `guide_node_status` | 一行一节点；`status`、完成时间、最新 checkpoint 结果 |
| `checkpoint_def` | 跨模板共享的 SQL 库（按 `(root_type, checkpoint_key)` 寻址） |

### 6.2 关键约束

| 表 | 约束 | 作用 |
|---|---|---|
| `creation_guide_template` | PK `(template_id, version)` | 一份模板一版本 |
| `creation_guide_instance` | UNIQUE `(root_type, root_id)` | 一份业务对象一份向导 |
| `guide_node_status` | UNIQUE `(guide_instance_id, node_key)` | 实例内节点不重 |
| `checkpoint_def` | PK `(root_type, checkpoint_key)` | 类型内 checkpoint key 唯一 |

> 节点 key 在实例内唯一 —— **DB 层有 `uk_guide_node` UNIQUE 约束兜底**（重复 INSERT 报 1062），
> 应用层在实例化时预校验（fail fast、错误消息更友好）。
> Checkpoint key 在 `checkpoint_def` 内由 DB PK 守护。

### 6.3 与其他表的关系

| 引用 | 说明 |
|---|---|
| `creation_guide_instance.root_id → customer.cust_no` | **不强制 FK**——`root_type` 多态 |
| `creation_guide_instance.(template_id, template_version) → creation_guide_template` | **不强制 FK**——实例已通过 `definition_snapshot` 冻结，模板即使改版/废弃也不影响已物化向导；FK 反而会让"老模板不能删"。应用层在实例化时校验模板存在 |
| 现有 `audit_log` 表（05） | **不复用**——完成信息在 `guide_node_status` 自己 |
| `attr_value_current`（09） | **强依赖**——`:attr_<key>` 占位符从这里读 |
| 模板节点的 `checkpoints` 数组 → `checkpoint_def` | **不强制 FK**——允许前向引用，运行期查不到再 ERROR |

---

## 7. 状态机

人工场景下**没有"超时认领"**——人不会被突然断开，也不必区分"被领走"和"正在做"：

```
              ┌──── [创建向导 / 模板物化]
              │
              ▼
   ┌──────────────────┐
   │     WAITING      │  依赖未满足；不出现在 UI 的"可领取"区
   └────────┬─────────┘
            │ 所有 depends_on 进入终态 (DONE / SKIPPED)
            ▼
   ┌──────────────────┐
   │      READY       │  `default_owner` 可以开始（"领取"是隐式的——人坐过去就开干）
   └────────┬─────────┘
            │
   ┌────────┼────────────────┬──────────────┐
   ▼        ▼                ▼              ▼
┌──────┐ ┌────────┐    ┌──────────┐   ┌──────────┐
│ DONE │ │ FAILED │    │ SKIPPED  │   │ BLOCKED  │
└──────┘ └───┬────┘    └──────────┘   └─────┬────┘
   终态      │ 终态 (可重试)  终态            │  终态 (可解除)
             ▼                              ▼
          [retry]                       [unblock]
             │                              │
             ▼                              ▼
          READY                          WAITING  (重评估 advance_dag)
          (触发 advance_dag:             (触发 advance_dag:
           子节点 deps                    本节点 deps 已满足则
           =DONE/SKIPPED                  WAITING→READY, 再评子节点)
           时可推进)
```

**子节点推进规则**（advance_dag 的核心）：子节点只在 `dep` 处于**终态且成功**（`DONE` / `SKIPPED`）时才被推进到 `READY`。
- `dep = READY`（在工作中）→ 子节点**仍 WAITING**，等 dep 完成
- `dep = FAILED` → 子节点**仍 WAITING**（FAILED 不推进后继）
- `dep = BLOCKED` → 子节点**仍 WAITING**（需 dep 先 unblock 并 re-eval）
- `dep = DONE / SKIPPED` → 子节点可推进

**retry 之后**（FAILED → READY）：retry 动作自身触发 advance_dag，但因 dep 此时是 READY（不是 DONE/SKIPPED），
子节点**仍 WAITING**——语义上 retry 让 dep "可以再做一次"，子节点须等 dep 真正完成才推进。这是有意为之，
避免"retry 中"被误以为是"retry 成功"。

**unblock 之后**（BLOCKED → WAITING）：unblock 触发两段 advance_dag——
1. 先评本节点：所有 deps 都 DONE/SKIPPED 则 WAITING → READY
2. 再评子节点：依据本节点的新状态 + 兄弟节点状态做一轮常规 advance

整体（`creation_guide_instance.overall_status`）的聚合规则（**优先级顺序**）：

| 优先级 | 节点集合 | overall_status |
|---|---|---|
| 1（最高） | 显式取消 | `CANCELLED` |
| 2 | 存在 FAILED 或 BLOCKED | `PARTIAL` |
| 3 | 全部 DONE / SKIPPED（无 WAITING / READY） | `READY` |
| 4 | 全部节点都还在 WAITING（未被任何 advance 推过） | `INIT` |
| 5 | 其余（有 READY，或 WAITING + READY 混合） | `IN_PROGRESS` |

> **`CANCELLED` 不通过聚合派生**：是 instance 级别的**显式动作**（`POST /guides/{id}/cancel`）写入，
> 与节点状态无关。`update_overall_status` 派生逻辑只覆盖 2-5 档；Cancel 是单独路径。
>
> **`READY`（节点级）≠ `READY`（instance 整体）**：节点 READY = "可领取"；instance READY = "全部节点都 DONE/SKIPPED"。
> 不要混淆。

---

## 8. 写入模式

### 8.1 创建向导（物化 DAG）

**全部 6 步必须在同一事务内**——任何一步失败要整体回滚，避免"instance 创建了但节点行不齐"或
"节点行建了但根节点还没置 READY"被外部观察到的中间态。

```
1. SELECT template.definition（按 root_type + customer_type 选 active 最新版）
2. 解析 JSON：抽 nodes[] 数组，建 node_key → 节点元信息 索引
3. 校验：节点 key 唯一、depends_on 引用合法、DAG 无环
4. INSERT creation_guide_instance（template_id + version 冻结；definition_snapshot 整块复制）
5. INSERT N 行 guide_node_status（status=WAITING；owner **不存这里**，在 definition_snapshot 里）
6. 入度=0 的节点：UPDATE status='READY', ready_at=NOW()
   （"入度=0" = depends_on 数组为空 OR 字段缺失；见 SQL §5.4）
```

> **同事务的副作用**：`creation_guide_instance.overall_status` 默认值 `INIT`（步骤 4 时），
> 步骤 6 完成后外部读到的就是聚合后的 `INIT` 或 `IN_PROGRESS`（取决于根节点数量）。

### 8.2 推进 DAG（节点入终态时）

```python
on_node_terminal(node_status):
    if node_status.status in (DONE, SKIPPED):
        for child in successors(node_status):
            if all(dep.status in (DONE, SKIPPED) for dep in child.depends_on):
                child.status = 'READY'
                child.ready_at = now()
    elif node_status.status == FAILED:
        # 不推进后继，保持 WAITING
        pass
    update_overall_status(guide_instance_id)

# retry 路径（FAILED → READY）独立触发：
on_node_retry(node_status):
    # FAILED 节点被 retry 后，自身回到 READY；子节点的 deps 仍是 READY（不是 DONE/SKIPPED），
    # 按 §7 的子节点推进规则，子节点仍 WAITING。retry 仅恢复"重做"能力，不推进 DAG。
    update_overall_status(guide_instance_id)

# unblock 路径（BLOCKED → WAITING）独立触发：
on_node_unblock(node_status):
    node_status.status = 'WAITING'
    # 两段 advance_dag：
    #   1) 先评本节点：deps 全 DONE/SKIPPED 则 WAITING → READY
    #   2) 再评子节点：依据本节点新状态 + 兄弟节点状态
    if all(dep.status in (DONE, SKIPPED) for dep in node_status.depends_on):
        node_status.status = 'READY'
        node_status.ready_at = now()
    for child in successors(node_status):
        if all(dep.status in (DONE, SKIPPED) for dep in child.depends_on):
            child.status = 'READY'
            child.ready_at = now()
    update_overall_status(guide_instance_id)
```

`update_overall_status` 与状态变更**同事务**：

```sql
-- 优先级: PARTIAL > READY > INIT > IN_PROGRESS
-- CANCELLED 不通过此 SQL 派生, 走单独路径 (POST /guides/{id}/cancel)
UPDATE creation_guide_instance
SET overall_status = (
    SELECT CASE
        -- 1. 任何 FAILED/BLOCKED -> PARTIAL (最高优先级)
        WHEN SUM(status IN ('FAILED','BLOCKED')) > 0 THEN 'PARTIAL'
        -- 2. 全部节点都是 DONE/SKIPPED (无 WAITING/READY) -> READY
        WHEN SUM(status NOT IN ('DONE','SKIPPED')) = 0 THEN 'READY'
        -- 3. 全部节点都还在 WAITING (未被推进) -> INIT
        WHEN SUM(status = 'WAITING') = COUNT(*) THEN 'INIT'
        -- 4. 其余 (有 READY, 或 WAITING+READY 混合) -> IN_PROGRESS
        ELSE 'IN_PROGRESS'
    END
    FROM guide_node_status
    WHERE guide_instance_id = ?
)
WHERE guide_instance_id = ?;
```

> **顺序敏感**：`PARTIAL` 必须在 `READY`/`INIT` 之前判断——否则有 FAILED 时会被第二条 (READY)
> 或第三条 (INIT) 误判。原版 SQL 把 `IN_PROGRESS` 放最前，导致"全部 WAITING"也被判成 `IN_PROGRESS`，
> 是顺序错误。

### 8.3 执行 Checkpoint

```python
def run_checkpoint(checkpoint_key, root_type, root_id,
                   node_instance_id=None, user=None):
    # 1. 查 checkpoint_def 拿 SQL
    cp = checkpoint_def.find(root_type, checkpoint_key)
    if not cp:
        return {checkpoint_key: result('ERROR', None, 'CHECKPOINT_NOT_FOUND')}
    if cp.deprecated_at:
        return {checkpoint_key: result('ERROR', None, 'CHECKPOINT_DEPRECATED')}

    # 2. 加载业务对象
    bo = load_business_object(root_type, root_id)
    attrs = load_current_attributes(root_type, root_id)

    params = {
        'root_id': root_id, 'root_type': root_type,
        **bo.column_values(),
        **{f'attr_{k}': v for k, v in attrs.items()},
    }

    # 3. 取连接（只读 + 强超时）
    conn = pool_for(cp.data_source)
    conn.execute("SET SESSION TRANSACTION READ ONLY")

    # 4. 跑
    try:
        with timer() as t:
            rows = conn.execute(cp.sql_template, params,
                                timeout=cp.timeout_seconds)
        row = rows[0] if rows else None
        if row is None:
            status, msg, detail = 'FAIL', 'no rows returned', None
        else:
            status = normalize_status(row.get('status'))
            msg    = row.get('message') or ''
            detail = row.get('detail')
    except Timeout:
        return {checkpoint_key: result('TIMEOUT', 'query timeout', elapsed=t.elapsed)}
    except Exception as e:
        return {checkpoint_key: result('ERROR', str(e)[:1000], err=classify(e))}

    return {checkpoint_key: result(status, msg, detail, t.elapsed)}
```

### 8.4 Mark Done（带 checkpoint 校验）

```python
def mark_node_done(guide_inst_id, node_key, completed_by):
    # 1. 锁定节点
    node = lock_node(guide_inst_id, node_key)
    assert node.status == 'READY', INVALID_TRANSITION

    node_def = lookup_node(node.guide_inst, node_key)
    requires = node_def.require_checkpoints_on_done and bool(node_def.checkpoints)

    # 2. 校验
    if requires:
        results = {cp_key: run_checkpoint(cp_key, ..., node_instance_id=node.id)
                   for cp_key in node_def.checkpoints}
        node.last_checkpoint_results = results
        if any(r['status'] != 'PASS' for r in results.values()):
            return 422, {'code': 'CHECKPOINT_FAILED', 'results': results}

    # 3. 推进
    node.status = 'DONE'
    node.completed_at = now()
    node.completed_by = completed_by
    advance_dag(guide_inst_id)
    update_overall_status(guide_inst_id)
```

### 8.5 Test（不落 status，只更新 last_checkpoint_results）

```python
def test_node_checkpoints(guide_inst_id, node_key):
    node = lock_node(guide_inst_id, node_key)   # 只锁,不校验 status
    node_def = lookup_node(node.guide_inst, node_key)
    results = {cp_key: run_checkpoint(cp_key, ...)
               for cp_key in node_def.checkpoints}
    node.last_checkpoint_results = results      # 更新,但 status 不动
    return 200, {'results': results}
```

---

## 9. API 契约

> 所有写接口**幂等**（带 `Idempotency-Key`），错误码与 06 一致。
> 状态机接口**只能由 READY 起步**（WAITING 不能直接 done）。

### 9.1 列出 / 创建向导

```http
POST /business-objects/{root_type}/{root_id}/guides
Content-Type: application/json
Idempotency-Key: req-uuid-xxx

{
  "template_id": "customer_onboarding_v2",
  "template_version": 5        // 可省,默认 active 最新
}
```

```http
201 Created
{
  "guide_instance_id": 8801,
  "root_type": "customer", "root_id": "C0001",
  "template_id": "customer_onboarding_v2", "template_version": 5,
  "overall_status": "INIT",
  "nodes_total": 7, "nodes_ready": 1,
  "links": { "dag": "/business-objects/customer/C0001/guides/8801/dag" }
}
```

```http
GET /business-objects/customer/C0001/guides/8801
→ 包含 overall_status + 所有节点的 status + definition_snapshot 元信息
```

### 9.2 查看 DAG

```http
GET /business-objects/customer/C0001/guides/8801/dag
```

```json
{
  "nodes": [
    {
      "node_key": "sales.account_creation",
      "title": "在 Sales 创建客户主数据",
      "team": "sales", "default_owner": "张三", "domain": "sales.example.com",
      "document_url": "https://wiki.internal/runbooks/sales-account",
      "status": "DONE",
      "completed_at": "2026-06-08T10:30:00Z",
      "completed_by": "张三",
      "last_checkpoint_results": {
        "sales.account_exists":     { "status": "PASS", "message": "found 1 row" },
        "sales.credit_consistent":  { "status": "PASS", "message": "sales=100000 central=100000" }
      }
    },
    {
      "node_key": "finance.tax_region_setup",
      "status": "WAITING"
    }
  ],
  "edges": [
    { "from": "sales.account_creation", "to": "finance.tax_region_setup" },
    { "from": "sales.account_creation", "to": "mrp.demand_planning" }
  ]
}
```

### 9.3 Test Checkpoint（不动 status，只更新 last_checkpoint_results）

```http
POST /business-objects/customer/C0001/guides/8801/nodes/sales.account_creation/test
Content-Type: application/json
Idempotency-Key: req-uuid-yyy

{ "triggered_by": "张三" }
```

```http
200 OK
{
  "node_key": "sales.account_creation",
  "status": "DONE",                          // status 没变
  "results": {
    "sales.account_exists":     { "status": "PASS", "message": "found 1 row",  "duration_ms": 42 },
    "sales.credit_consistent":  { "status": "FAIL", "message": "mismatch",      "duration_ms": 38 }
  },
  "all_passed": false
}
```

**指定单条**：

```http
POST /business-objects/customer/C0001/guides/8801/nodes/sales.account_creation/test/sales.account_exists
→ 200 OK { "result_status": "PASS", ... }
```

### 9.4 Mark Done

```http
POST /business-objects/customer/C0001/guides/8801/nodes/sales.account_creation/done
Content-Type: application/json
Idempotency-Key: req-uuid-zzz

{
  "completed_by": "张三"
}
```

```http
200 OK
{
  "node_key": "sales.account_creation",
  "status": "DONE",
  "completed_at": "2026-06-08T10:30:00Z",
  "last_checkpoint_results": { "...": "..." },
  "newly_ready": [
    { "node_key": "finance.tax_region_setup" },
    { "node_key": "mrp.demand_planning" }
  ]
}
```

失败（checkpoint 没全 PASS）：

```http
422 Unprocessable Entity
{
  "code": "CHECKPOINT_FAILED",
  "message": "1 of 2 checkpoints failed",
  "node": "sales.account_creation",
  "results": { "sales.credit_consistent": { "status": "FAIL", "message": "..." } }
}
```

### 9.5 状态机其他动作

> **源状态限制**：除 Retry / Unblock 外，所有 `* → X` 动作的源状态限定为
> **`WAITING` 或 `READY`**（非终态）。终态（DONE / SKIPPED / FAILED / BLOCKED）不再接受
> Skip / Failed / Block——避免"已 DONE 的节点又被 Block"这种语义无意义操作。
> 跨过 `require_checkpoints_on_done` 校验的 DONE 是**不可逆**的，撤回要靠"开新向导"。

| 动作 | 路径 | 状态迁移 | 副作用 |
|---|---|---|---|
| Skip | `POST .../nodes/{key}/skip` | `WAITING` / `READY` → `SKIPPED` | 推进子节点（advance_dag） |
| Failed | `POST .../nodes/{key}/failed` | `WAITING` / `READY` → `FAILED` | 不推进子节点；`overall_status` 重新聚合（可能变 `PARTIAL`） |
| Retry | `POST .../nodes/{key}/retry` | `FAILED` → `READY` | 触发 advance_dag（retry 后 dep=READY，**子节点仍 WAITING**直到 dep=DONE） |
| Block | `POST .../nodes/{key}/block` | `WAITING` / `READY` → `BLOCKED` | 不推进子节点；`overall_status` 重新聚合 |
| Unblock | `POST .../nodes/{key}/unblock` | `BLOCKED` → `WAITING` | **两段 advance_dag**：先评本节点 deps 满足则 WAITING→READY，再评子节点 |
| **Cancel（instance 级）** | `POST /guides/{id}/cancel` | instance: * → `CANCELLED`（**与节点状态正交**） | 所有未终态节点冻结在原状态；不再接受任何节点动作（除 Retry 已 FAILED 的以外） |

### 9.6 Checkpoint 定义 CRUD

```http
GET    /checkpoints/customer                          # 列出某 root_type 下所有
GET    /checkpoints/customer/sales.account_exists     # 查一条
POST   /checkpoints                                   # 新建
PUT    /checkpoints/customer/sales.account_exists     # 改 SQL / 改 data_source / 改 timeout
DELETE /checkpoints/customer/sales.account_exists     # 软删 (deprecated_at=NOW())
```

> 软删而非硬删：避免节点模板中"已引用但找不到"导致 run 报 ERROR 时没有上下文。
> 软删后的 checkpoint，run 时会落到 `result_status='ERROR'`，`error_code='CHECKPOINT_DEPRECATED'`。

### 9.7 模板 CRUD

模板既能从 YAML 文件加载（CI / 配置管理工具），也能从 Admin UI 录入。两条路径汇到同一组 API：

```http
GET    /templates                                     # 列出所有模板 (按 template_id + 最新版本)
GET    /templates/{template_id}                      # 列出某 template_id 的所有版本
GET    /templates/{template_id}/{version}            # 查一份模板的完整 definition
POST   /templates                                     # 新建/新版本 (body = YAML 或 JSON, 服务端解析校验)
                                                       # 服务端必须校验: 节点 key 唯一 / 依赖合法 / DAG 无环
                                                       # 校验失败 -> 422, 返回 violations[]
PUT    /templates/{template_id}/{version}/activate    # 切换 active 版本 (同一 template_id 下只允许一个 active)
                                                       # 同 root_type + customer_type 已有 active 版本的, 旧的 is_active=0
DELETE /templates/{template_id}/{version}            # 软删 (deprecated_at=NOW())
                                                       # 已被 instance 引用的, 软删不影响已物化向导 (definition_snapshot 已冻结)
                                                       # 不允许硬删
```

> **新版本自动叠加**：同一 `template_id` 可以有多个 `version`（PK = `(template_id, version)`）。
> 不允许"原地改"——改模板必然是 `version + 1`。
> `is_active=true` 同一 `(root_type, customer_type)` 下唯一；新客户走 active 版本，老客户走 instance 冻结的版本。

---

## 10. Checkpoint 执行协议

### 10.1 数据源

| `data_source` | 物理库 | 账号 | 用途 |
|---|---|---|---|
| `main` | master-service DB | `md_ro` | 查 `attr_value_current` 衍生事实 |
| `sales_db` | Sales 系统 DB | `sales_ro` | 探查 Sales 中客户是否真的存在 |
| `finance_db` | Finance 系统 DB | `fin_ro` | 探查 Finance 配置 |
| … | | | 业务按需扩展 |

> 数据源是**配置**不是代码——新增一个异构子系统 = 配一个只读账号 + 在连接池
> 注册一个别名。`checkpoint_def.data_source` 字段决定运行时走哪个池。

### 10.2 参数绑定

- **永远**用预编译语句 + 参数绑定；禁止字符串拼接（防注入）
- 缺参数 → SQL 报错 → `result_status='ERROR'`，`error_code='MISSING_PARAM'`
- 类型不匹配 → SQL 报错 → 同上

### 10.3 异常、超时、找不到

| 异常 | result_status | error_code |
|---|---|---|
| checkpoint_key 在 checkpoint_def 中**找不到** | `ERROR` | `CHECKPOINT_NOT_FOUND` |
| checkpoint_key 已被软删 | `ERROR` | `CHECKPOINT_DEPRECATED` |
| SQL 语法错 | `ERROR` | `SQL_SYNTAX` |
| 列不存在 | `ERROR` | `SQL_COLUMN_MISSING` |
| 连接断 | `ERROR` | `CONNECTION_FAILED` |
| 慢查询 | `TIMEOUT` | `TIMEOUT` |
| `status` 列非 PASS/FAIL | `ERROR` | `INVALID_RESULT` |
| **返回 > 1 行**（违反"至多 1 行"协议） | `ERROR` | `INVALID_RESULT` |
| 0 行返回 | `FAIL` | — |

**`error_code` 字段约定**（写进 `guide_node_status.last_checkpoint_results` JSON）：

| `result_status` | `error_code` 字段 | 含义 |
|---|---|---|
| `PASS` | `null` | 通过 |
| `FAIL` | `null` | 业务规则未满足（数据问题） |
| `ERROR` | 上面表中的非空 `error_code` | 探查机制故障（SQL 错 / 找不到 / 协议违反等） |
| `TIMEOUT` | `TIMEOUT` | 慢查询 |

> **PASS / FAIL 时 `error_code = null`**；**仅 ERROR / TIMEOUT** 才有非空 `error_code`。
> 这样 UI 可以用 `error_code != null` 直接筛选"探查机制异常"与"业务规则失败"两类问题。

### 10.4 SQL 模板示例

**存在性**

```sql
SELECT
  CASE WHEN COUNT(*) > 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  CONCAT('found ', COUNT(*), ' row(s)') AS message
FROM sales.account WHERE customer_id = :root_id;
```

**值一致性**（中央 credit vs Sales credit_limit）

```sql
SELECT
  CASE WHEN ABS(s.credit_limit - :attr_credit) < 0.01 THEN 'PASS' ELSE 'FAIL' END AS status,
  CONCAT('sales=', s.credit_limit, ' central=', :attr_credit) AS message,
  JSON_OBJECT('sales', s.credit_limit, 'central', :attr_credit) AS detail
FROM sales.account s WHERE s.customer_id = :root_id;
```

**行数阈值**

```sql
SELECT
  CASE WHEN COUNT(*) >= 3 THEN 'PASS' ELSE 'FAIL' END AS status,
  CONCAT('found ', COUNT(*), ' active address(es)') AS message
FROM sales.shipping_address
WHERE customer_id = :root_id AND active = 1;
```

---

## 11. 不变量（Invariants）

| # | 不变量 | 守护位置 |
|---|---|---|
| 1 | 一份业务对象**至多一份**向导 | DB: `uk_root` UNIQUE (root_type, root_id) |
| 2 | 实例内节点 key 唯一 | 应用层：实例化时校验 |
| 3 | 节点的 `depends_on` 引用必须**同实例内已存在**的 node_key | 应用层：实例化时校验 |
| 4 | `depends_on` 数组中**不能包含自己** | 应用层：实例化时校验 |
| 5 | DAG 无环 | 应用层：实例化时 DFS / 拓扑排序 |
| 6 | template 实例化时**冻结** definition 副本 | DB：定义复制到 `instance.definition_snapshot` |
| 7 | FAILED 节点不推进后继（保持 WAITING） | DAG 推进逻辑 |
| 8 | SKIPPED 与 DONE 同等触发后继 | 同上 |
| 9 | BLOCKED → WAITING 时**重新评估依赖**（即使原依赖已满足） | unblock 强制走 `advance_dag` |
| 10 | `require_checkpoints_on_done=true` 且有 checkpoint 时，DONE 必须**先**通过校验 | Mark Done 流程 |
| 11 | checkpoint SQL 永远走**只读数据源** | 数据源账号 `READ ONLY` |
| 12 | SQL 永远用**预编译 + 参数绑定** | 应用层代码 review 强制 |
| 13 | `completed_by` 是**人**而不是服务账号 | API 校验（建议规则而非硬约束） |
| 14 | `last_checkpoint_results` 永远**反映最近一次** Test/Done 执行的真实结果 | Test/Done 在同一事务里写 |
| 15 | checkpoint_key 在 `checkpoint_def` 中可前向引用（模板可先于定义存在） | 不强制 FK；运行期查不到再 ERROR |

---

## 12. 易踩坑点

### 12.1 不要让 checkpoint SQL 写入任何数据

> 反例：`INSERT INTO sales.account_log ...` —— checkpoint 是探针，不是搬运工。

数据搬运属于 `config_task` 体系（自动派发）或专用同步服务。
Checkpoint 只读。

### 12.2 不要把"配置内容"塞进 Done 时的响应体

> 反例：把配好的 `price_book`、`payment_terms` 等值塞回 Done 接口响应

master-service **不持有下游配置内容**——Done 接口返回 `last_checkpoint_results`
（只是 PASS/FAIL + message），**不返回** Sales 那边配成了什么值。

### 12.3 不要为"凑 PASS" 调松 SQL

> 反例：拿不到准确数据时，把 SQL 改成 `SELECT 'PASS' AS status, 'OK' AS message`。
>
> 这是掩耳盗铃。Checkpoint 的存在就是为了**拒绝**"人工事后口头确认"。

拿不到数据时：让 `result_status='ERROR'`，人去修连接/修 SQL/Block 节点。

### 12.4 不要把多个子系统拼成一条 SQL

> 反例：`SELECT ... FROM sales.account a JOIN finance.tax_setup t ON ... WHERE a.customer_id = :root_id`

跨子系统的 join 假设两边在同一库——`data_source` 只能选一个。
要跨子系统验证：**拆成两个 checkpoint**，让节点同时挂两条。

### 12.5 `default_owner` 不要用"团队邮箱"

模板节点的 `default_owner = "sales-team@example.com"`——谁真做了？Done 怎么追责？
`default_owner` 必须写到**个人**（"张三"或"zhangsan"），这是节点 owner 的**唯一**来源。
若要"换人"——改模板，再开新向导。

### 12.6 不要给向导加"并行加速"按钮

向导的 DAG 已经在并行能并行的节点。强行"一键全配"是越权——各节点 owner 是各团队，
没有谁能跨团队代配。

### 12.7 不要把节点 key / checkpoint key 写进 `definition_snapshot` 之外的列

`definition_snapshot` 是节点元信息的**唯一**来源。
别再开 `node_team` / `node_owner` 列——一旦 JSON 改了，列就过时。

> `guide_node_status` 不再持有 `owner` 字段。节点 owner **永远** = `definition_snapshot.nodes[?(@.key == "...")].default_owner`。
> 要追"谁实际做的"看 `completed_by`。

### 12.8 模板升级不要"在老实例上原地应用"

`definition_snapshot` 冻结了老实例的视图。新版本模板只能影响**新创建**的向导；
老向导要走显式"补齐"流程，**不能**直接 `UPDATE guide_node_status SET ...`。

**补丁向导（patch guide）**端点：

```http
POST /business-objects/{root_type}/{root_id}/guides/{guide_instance_id}/patch
Content-Type: application/json
Idempotency-Key: req-uuid-patch

{
  "from_template_id": "customer_onboarding_v2",
  "from_version": 5,
  "to_version": 6,
  "added_nodes": [                              # 模板 v6 比 v5 新增的节点
    { "key": "crm.marketing_segment", ... }
  ]
}
```

服务端：
1. 校验 v5/v6 模板的"差量"（added / removed / changed）—— 服务端**不能**自动 merge，
   仅给运维/客服工具展示 diff；具体的"补齐节点"动作由人确认
2. 创建一个**新**的 creation_guide_instance（`template_id` 用 `from_template_id + '_patch'`，`version` 用 `to_version`），
   这个新 instance 的 `definition_snapshot` 只包含**新增**节点（不带旧节点，状态不重叠）
3. 业务方在两个 instance 之间维护"并行进度"；老的 instance 完成时不影响新 instance

> **不要自动 merge 节点到老 instance**：status / completed_at / completed_by 都是历史事实，
> 自动 merge 会丢失审计。新老并存是合理设计。

### 12.9 不要把 checkpoint SQL 当脚本用

`checkpoint_def.sql_template` 是**一条 SQL**，不是存储过程、不是 BEGIN..END 块。
需要"先查 A 再查 B"？拆成两个 checkpoint，节点上挂两条。

---

## 13. 演进路径

### 阶段 1 · MVP

- [ ] 4 张表 DDL
- [ ] YAML 模板加载器（解析 + 校验：节点 key 唯一 / 依赖合法 / DAG 无环）
- [ ] Checkpoint 定义 CRUD（SQL 管理界面）
- [ ] 物化向导 API（创建时冻结 definition_snapshot）
- [ ] Test 接口（不动 status，更新 last_checkpoint_results）
- [ ] Done 接口（`require_checkpoints_on_done=true` 默认）
- [ ] 1 个数据源（`main`）

### 阶段 2 · 跨子系统探查

- [ ] 引入只读探查账号到 sales_db / finance_db
- [ ] 真实业务 checkpoint 落地（10+ 条）
- [ ] Admin UI：节点色块图 + checkpoint 列表
- [ ] 工单系统对接：Done 时挂工单号

### 阶段 3 · 与 config_task 协同

- [ ] 同一 customer 同时有 config_task + creation_guide 的统一视图
- [ ] "某子系统从人工升级为自动 ack" 的迁移工具
- [ ] Checkpoint 模板化（按 `customer_type` 派生默认 checkpoint 集）

### 阶段 4 · 可选

- [ ] Checkpoint 慢查询大盘（每个 checkpoint_key 的 p50/p95 duration）
- [ ] Checkpoint "漂移告警"——曾经 PASS 的 checkpoint 突然 FAIL
- [ ] 模板 diff 工具：对比两个版本的 definition，找出新增/删除/变更的节点

---

## 14. 与其他文档的关系

| 文档 | 关系 |
|---|---|
| [01-design-overview.md](01-design-overview.md) | 主从关系——本设计是它的**正交扩展**，不替代 |
| [05-data-model.md](05-data-model.md) | **不复用** `config_task` 表；**不复用** `audit_log`（完成信息在 status 表） |
| [06-api-contract.md](06-api-contract.md) | 沿用其错误码规范与幂等约定；URL 路径空间独立 |
| [07-pitfalls-and-invariants.md](07-pitfalls-and-invariants.md) | 本文档 §11 / §12 是其"人工场景"专章 |
| [09-attribute-versioning.md](09-attribute-versioning.md) | **强依赖**——`:attr_<key>` 占位符从 `attr_value_current` 注入 |

---

## 自检清单

- [ ] 所有 checkpoint SQL 走只读数据源？
- [ ] Done 失败时 `result_status` 区分是 SQL 拿不到数据（ERROR/TIMEOUT）还是人没配完（FAIL）？
- [ ] unblock 之后依赖还能正确重评估？
- [ ] 模板升级时，老实例的 `definition_snapshot` 不变？
- [ ] 同 customer 重复创建向导时，UNIQUE 约束能拦下来吗？
- [ ] checkpoint SQL 里有没有"中央数据的 subquery"？应改成 `:attr_*` 参数。
- [ ] 节点 key 唯一、依赖合法、DAG 无环都校验过了吗？
- [ ] `checkpoint_def` 软删后，老节点的 run 会 `CHECKPOINT_DEPRECATED` 吗？
