# 09 · 通用属性版本化设计

> **目标**：在主数据服务中，为 customer / location / region / company 等多个聚合根
> 提供一套**通用、时点可回溯、对外可消费**的属性管理机制。
>
> **存储引擎**：MySQL 8.0+
> **时间语义**：左闭右开 `[valid_from, valid_to)`，`valid_to = NULL` 表示当前生效

---

## 1. 核心思想

把每个聚合根的**业务主键**（`cust_no` / `loc_no` / `region_no` / `company_no`）之外的
所有元素都视为"可变的属性 attribute"，并通过**生效时间区间**实现版本化：

```
聚合根(customer C001) = 业务主键 + 一组随时间可变的 attributes
                       └─ 这一组 attributes 共享 [valid_from, valid_to) 时间轴
```

设计取舍：
- 业务主键留在**专属父表**（`customer` / `location` …），不参与版本化
- 所有非主键字段统一进入通用属性表，**加字段零 DDL**
- 同一时间点，每个 `(root_type, root_id, attr_key)` 最多存在一个**当前行**
- 历史行只追加不修改，提供任意时点快照能力

---

## 2. 整体架构

```
┌─────────────────┐
│  parent table   │  customer / location / region / company
│  (业务主键+元数据)│  记录聚合根存在性、合并/删除状态
└─────────────────┘
         │
         │ (root_type, root_id)
         ▼
┌─────────────────┐
│   attr_def      │  属性定义（schema）：attr_key、value_type、display_name
└─────────────────┘
         │
         ▼
┌─────────────────┐         ┌──────────────────────┐
│   attr_value    │  ────►  │ attr_value_current   │
│  (全量历史)      │  物化   │  (当前视图，快)        │
└─────────────────┘         └──────────────────────┘
         │
         ▼
   下游消费（CDC/快照表）
```

**四张表**：
| 表 | 作用 |
|---|---|
| 父表（`customer` 等） | 业务主键 + 状态（active / merged / deleted） |
| `attr_def` | 属性元数据：按 `(root_type, attr_key)` 独立定义 (display_name / value_type / is_multi / 校验描述) |
| `attr_value` | 属性值全量历史（`valid_from` / `valid_to` / `seq_no`） |
| `attr_value_current` | 当前生效视图（PK 含 seq_no） |

完整 DDL 见同目录 [`09-attribute-versioning.sql`](09-attribute-versioning.sql)。

---

## 3. 关键设计决策

### 3.1 时间语义：左闭右开

- `valid_from <= T` 且 `(valid_to > T OR valid_to IS NULL)` 表示"T 时刻生效"
- `valid_to = NULL` 表示**当前行**（开区间右侧无穷）
- DB 层 CHECK：`valid_to IS NULL OR valid_to > valid_from`

### 3.2 强类型分列 + 一行一值

为支撑"按金额排序""按时间筛选"等真实查询（纯 `TEXT` 会因字典序导致排序错乱），
`attr_value` 表为每种类型预留独立列：

| 列 | 用途 |
|---|---|
| `value_int` | INT |
| `value_bigint` | BIGINT |
| `value_decimal(20,6)` | DECIMAL（金额、汇率，**禁浮点**） |
| `value_datetime(3)` | DATETIME(3)（业务时间） |
| `value_varchar(512)` | VARCHAR(512)（短文本） |
| `value_text` | TEXT（长文本） |
| `value_bool` | TINYINT(1) |

通过生成列 + CHECK 约束保证**每行恰好一列有值**：

```sql
populated_count TINYINT GENERATED ALWAYS AS (
    (value_int      IS NOT NULL) +
    (value_bigint   IS NOT NULL) +
    ...
) STORED,
CHECK (populated_count = 1)
```

### 3.3 "当前行唯一"约束

每个 `(root_type, root_id, attr_key)` 同一时刻最多一个当前行（`valid_to IS NULL`）。
DB 层用一个**生成列 + 唯一索引**实现：

```sql
current_flag TINYINT(1) GENERATED ALWAYS AS
             (IF(valid_to IS NULL, 1, NULL)) STORED,
UNIQUE KEY uk_current (root_type, root_id, attr_key, current_flag)
```

MySQL 唯一索引中 `NULL` 不参与去重 → 历史行（`current_flag=NULL`）可多条共存，
当前行（`current_flag=1`）全局唯一。写入时若忘记关旧行，DB 直接报 1062 错误。

### 3.4 元数据变化 = 字段变化，不保留历史

`attr_def` 是这套体系的"schema"：
- **加 attribute**：往 `attr_def` 插一行 → 加 `(root_type, attr_key)` 零 DDL
- **改 attribute 含义**：保留旧 key，新数据走新 key，旧的置 `deprecated_at`
- **删 attribute**：物理删除对应 `attr_value` 历史行（一次性）

**不在 `attr_def` 上再做一层版本控制**——会陷入无限套娃。

### 3.5 业务有效时间 vs 事务时间

- `valid_from` / `valid_to`：**业务时间**（数据从哪天起算"是这样"）
- `created_at`：**事务时间**（数据什么时候写入系统）
- 两者分开：补录历史数据时 `valid_from='2024-01-15'` 而 `created_at='2024-06-08'`

### 3.6 父表 = 聚合根的"壳"

每个聚合根类型一张父表，**仅**保留：
- 业务主键（PK）
- `status`：`active` / `merged` / `deleted`
- `merged_to`：合并时的目标主键
- 创建/更新时间

聚合根的所有"内容"通过 `attr_value` 拼装。

---

## 4. 写入模式

### 4.1 关旧开新（最核心的操作）

```sql
START TRANSACTION;
-- 关旧
UPDATE attr_value SET valid_to = :new_valid_from
WHERE root_type=:rt AND root_id=:ri AND attr_key=:ak AND valid_to IS NULL;
-- 开新
INSERT INTO attr_value (root_type, root_id, attr_key, value_xxx, valid_from, created_by)
VALUES (:rt, :ri, :ak, :v, :new_valid_from, :op);
-- 同步当前视图
INSERT INTO attr_value_current ...
ON DUPLICATE KEY UPDATE value_xxx = VALUES(value_xxx);
COMMIT;
```

`uk_current` 是 DB 层兜底——步骤 1 漏了关旧，步骤 2 会因 UNIQUE 冲突而失败。

### 4.2 并发控制

使用 **Redis 分布式锁**（按 `root_type:root_id` 加锁），`ttl=10s` 作为安全网。
DB 的 `uk_current` 约束是终极保险：即使 Redis 锁失效，DB 也不会写出脏数据。

> 不使用 `aggregate_lock` 表是有意为之——Redis 锁的失败语义（锁丢失 → 重试）比 DB
> 悲观锁更轻量，且 MD 维护场景的写并发通常不高。

---

## 5. 读取模式

| 场景 | 走哪张表 | 关键条件 |
|---|---|---|
| 当前视图（绝大多数 API） | `attr_value_current` | 直接按 PK 查 |
| 时点快照 | `attr_value` | `valid_from <= T AND (valid_to > T OR valid_to IS NULL)` |
| 变更历史 | `attr_value` | `ORDER BY valid_from DESC` |
| 跨聚合根按值筛选 | `attr_value` | 用对应类型的列上的索引（`idx_int` / `idx_dec` / `idx_datetime`） |

应用层拿到行后，**按 `attr_def.value_type` 派发到对应列**，反序列化为强类型值返回。

为简化应用层，建议使用视图 [`v_attr_current_typed`](09-attribute-versioning.sql)，它直接
输出 `(attr_key, value, value_type)` 三元组。

---

## 6. 下游消费

主数据服务的输出形态是**版本化维表**。两种分发方式：

### 6.1 CDC（推荐）

通过 Canal / Debezium 订阅 `attr_value` 与 `attr_value_current` 的 binlog，
识别"当前行变化"事件后投递到 Kafka：
- `valid_to` 由 `NULL → 非空`：旧版本结束（属性变更）
- `INSERT` 且 `valid_to IS NULL`：新当前值

### 6.2 物化快照（按需）

给数仓/数据湖定期生成指定时点的全量快照：

```sql
SELECT * FROM attr_value
WHERE valid_from <= :T AND (valid_to > :T OR valid_to IS NULL);
```

大量数据按 `root_id` 范围分批导出。

---

## 7. 常用操作一览

所有 SQL 见 [`09-attribute-versioning.sql`](09-attribute-versioning.sql)。简要清单：

| # | 操作 | 关键表 |
|---|---|---|
| 1 | 定义新 attribute | `attr_def` |
| 2 | 创建聚合根 | `customer` / `location` … |
| 3 | 首次写入一组属性 | `attr_value` + `attr_value_current` |
| 4 | 更新单个属性（关旧开新） | `attr_value` |
| 5 | 批量更新一个聚合根的多个属性 | `attr_value` |
| 6 | 作废/删除一个属性 | `attr_value` |
| 7 | 查询当前视图 | `attr_value_current` / `v_attr_current_typed` |
| 8 | 查询时点快照 | `attr_value` |
| 9 | 查询变更历史 | `attr_value` |
| 10 | 查询带类型统一结果 | `v_attr_current_typed` |
| 11 | 生成下游全量快照 | `attr_value` + `attr_def` |
| 12 | 合并聚合根（A → B） | 父表 + `attr_value` + `attr_value_current` |

---

## 8. 索引与性能

```sql
KEY idx_lookup    (root_type, root_id, attr_key, valid_from, valid_to),
KEY idx_int       (root_type, attr_key, value_int),
KEY idx_dec       (root_type, attr_key, value_decimal),
KEY idx_datetime  (root_type, attr_key, value_datetime),
KEY idx_varchar   (root_type, attr_key, value_varchar(64))
```

- `idx_lookup` 覆盖时点查询和历史回溯
- `idx_int` / `idx_dec` / `idx_datetime` 支撑"按值筛选"（如"找出所有 credit > 100000 的客户"）
- 单表 < 5 亿行时这套索引足够；超过考虑按 `root_type` 物理分表或冷热分离

---

## 9. 工程化补充

### 9.1 时区
全库统一 `DATETIME(3)`，**应用层统一按 UTC 写入/读取**；展示层按用户时区转换。

### 9.2 `attr_def` 按 `(root_type, attr_key)` 独立定义

`attr_def` 的主键是 `(root_type, attr_key)`，而不是单 `attr_key`：

- **同一 attr_key 在不同 root_type 下可以有不同元数据**
  - 例如 `phone`：customer 是 "客户联系电话 / 11 位手机号"，location 是 "门店电话 / 座机格式"
  - 例如 `code`：region 是 `int` (行政编号)，company 是 `string` (公司代号)
- **写入校验**：应用层按 `(root_type, attr_key)` 查 `attr_def`，未命中即拒绝
- **UI 加载候选 attribute**：直接按 `root_type` 查 `attr_def` 即可，无需 `applicable_to` 过滤

这与 `attr_value` 的实例粒度保持一致——值按实例存储，定义也按实例存储。

### 9.3 何时物理分表
- `attr_value` 行数 < 5 亿：单表
- 5–20 亿：按 `root_type` 分表
- \> 20 亿：再叠加时间冷热分离（`attr_value` 当前 6 个月 + `attr_value_hist` 归档）

### 9.4 合并场景的"过户"
合并 A → B 时，B 的 `attr_value` 会被 A 当前值**覆盖**（先关 B 的当前行，再用 A 的当前值开新行）。
A 的历史行**保留**用于审计（虽然 `customer.status='merged'`）。

---

## 10. 多值 attribute

> 一个 `attr_key` 下可存储多个值（用 `seq_no INT` 区分），覆盖客户标签、多值选项等匿名列表场景。

### 10.1 设计：`seq_no` + `is_multi`

| 元素 | 作用 |
|---|---|
| `attr_def.is_multi` | 标记该 attribute 是否支持多个值；`0`=单值（`seq_no=0`），`1`=多值（`seq_no>=1`） |
| `attr_value.seq_no` | 单值固定为 `0`；多值从 `1` 起递增 |
| 不变量 | `is_multi=0 ⇒ seq_no=0`；`is_multi=1 ⇒ seq_no>=1` |

`attr_value` 与 `attr_value_current` 的 PK 升级为 `(root_type, root_id, attr_key, seq_no)`；`uk_current` 同步升级。

**为什么不用 VARCHAR sub_key**：
- 业务上没有"子类型"概念（一个 tag 就是"标签"），不需要 mobile/home/work 这种命名
- 匿名列表下，`seq_no=0` / `seq_no>=1` 的占位规则比"sub_key 用什么字符串占位"清晰
- INT 列更小、索引更紧

### 10.2 关键规则

| is_multi | seq_no 合法值 | 含义 |
|---|---|---|
| 0 | 只能为 0 | 唯一一个值 |
| 1 | 1, 2, 3, ... | 第 N 个值 |

**不变量由应用层保证**（推荐）。如需 DB 层强约束，启用 [`09-attribute-versioning.sql`](09-attribute-versioning.sql) §2.5 中注释的 trigger（默认不启用）。

### 10.3 关键操作

完整 SQL 见 [`09-attribute-versioning.sql`](09-attribute-versioning.sql) §7.1-7.8，要点：

```sql
-- 写入第一个 (seq_no=1)
INSERT INTO attr_value (root_type, root_id, attr_key, seq_no, value_varchar, valid_from)
VALUES ('customer', 'C001', 'phone', 1, '13800138000', '2024-01-01');

-- 追加下一个: 应用层获取 next_seq_no (见 10.4)
INSERT INTO attr_value (..., seq_no, value_varchar, valid_from)
VALUES (..., 2, '010-12345678', '2024-01-01');

-- 更新某 seq_no (关旧开新)
UPDATE attr_value SET valid_to = '2024-06-08'
WHERE ... AND attr_key='phone' AND seq_no=1 AND valid_to IS NULL;
INSERT INTO attr_value (..., seq_no, value_varchar, valid_from)
VALUES (..., 1, '13900000000', '2024-06-08');

-- 删除某 seq_no (其他不动)
UPDATE attr_value SET valid_to = '2024-06-08'
WHERE ... AND seq_no=2 AND valid_to IS NULL;
DELETE FROM attr_value_current WHERE ... AND seq_no=2;

-- 查询所有
SELECT seq_no, value_varchar FROM attr_value_current
WHERE root_type='customer' AND root_id='C001' AND attr_key='phone'
ORDER BY seq_no;
```

### 10.4 seq_no 的生成（next_seq_no）

MySQL `AUTO_INCREMENT` 是 per-table 的，**不能 per-(root_type, root_id, attr_key)**。
在 Redis 锁内用 `MAX(seq_no)+1`：

```python
def next_seq_no(root_type, root_id, attr_key):
    lock_key = f"seq_lock:{root_type}:{root_id}:{attr_key}"
    with redis_lock(lock_key, ttl=5):
        row = db.query("""
            SELECT COALESCE(MAX(seq_no), 0) + 1 AS next_seq
            FROM attr_value
            WHERE root_type=:rt AND root_id=:ri
              AND attr_key=:ak AND valid_to IS NULL
        """, rt=root_type, ri=root_id, ak=attr_key)
        return row.next_seq
```

**为什么需要锁**：`MAX(seq_no)+1` 不是原子的，两个并发请求可能都读到 `3` 都尝试插入 `seq_no=3`，后者被 `uk_current` 拒掉。Redis 锁范围小（一个 `(root, attr_key)`），开销可控。

**替代方案**（无锁）：用"INSERT 后重试"——直接尝试 `seq_no=1, 2, 3...`，碰 UNIQUE 冲突就 +1 重试。简单但并发下浪费 INSERT。

### 10.5 边角情况

- **删除的空洞**：删 `seq_no=2` 后剩 1, 3, 4。新加的会是 `seq_no=5`。对匿名列表无影响；如果在意连续需定期 normalize（不推荐）
- **`is_multi=0 ⇒ seq_no=0`**：DB 不强制，应用层写入前检查 `is_multi`；如需强约束见 SQL §2.5 trigger
- **API 路径建议**：`/attr/{attr_key}/{seq_no}`（多值）或 `/attr/{attr_key}`（单值）
- **合并场景**：C001 → C002 的合并会把 C001 的所有多值 seq_no 整体迁移到 C002（见 SQL §6.12）
- **不重排**：seq_no 一旦分配就不复用，物理删除后也不会被新值顶替


## 11. 与其他方案对比（取舍记录）

| 方案 | 适用 | 优势 | 代价 |
|---|---|---|---|
| **本方案（分列 + 时间区间）** | MD 维护、读多写少、维表发布 | 灵活加字段、时点回溯天然、跨聚合根统一 | EAV 风格、应用层校验集中 |
| Temporal Table（DB 原生） | 用现成 DB 能力 | DB 自动管理 | 依赖 DB 特性，MySQL 支持有限 |
| Event Sourcing | 写多、需完整审计 | 时间穿越天然、回溯强 | 学习曲线、需快照 |
| CQRS + 独立历史模型 | 读写分离 | 读侧定制 | 维护两套 |

本方案是 MDM 场景下**实现复杂度与表达能力的最佳折中**。
