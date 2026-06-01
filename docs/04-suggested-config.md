# 04 · 建议配置项（Suggested Config）

> 这是这个设计的**灵魂之一**：master-service 不持有任何下游域的字段值，
> 但能根据**最小集合 + 模板规则**为下游导出"建议值"，让下游少填、少错。

## 1. 核心原则

| 原则 | 说明 |
|---|---|
| **只是建议** | 下游可全盘采纳、可部分覆盖、可完全忽略 |
| **只读派生** | master-service 不存"下游最终用了什么" |
| **延迟计算** | 在 task 进入 READY 时才计算（上游可能还在改 min_data） |
| **规则集中** | 派生规则写在模板里，统一维护，可灰度 |

## 2. 模板示例（YAML）

```yaml
# templates/customer/standard_b2b.yaml
customer_type: "standard_b2b"
version: 3
modules:
  sales:
    tasks:
      - task_key: sales.customer_profile
        page_ref: "Sales-Page-01"
        required: true
        depends_on: []
        suggestions:                     # 仅是建议
          currency:        "${lookup.currency_by_country[customer.country]}"
          tax_region:      "${customer.country}"
          price_book:      "${customer.customer_type}_${customer.country}"
          payment_terms:   "NET30"       # 静态默认

      - task_key: sales.shipping_address
        page_ref: "Sales-Page-02"
        required: true
        depends_on: [sales.customer_profile]

  mrp:
    tasks:
      - task_key: mrp.demand_planning_rule
        page_ref: "MRP-Page-05"
        required: false
        depends_on: [sales.customer_profile]
        suggestions:
          planning_horizon_days: "${customer.industry == 'Auto' ? 180 : 90}"
          safety_stock_pct:      "${customer.industry == 'Auto' ? 15 : 5}"

  plm:
    tasks:
      - task_key: plm.bom_visibility
        page_ref: "PLM-Page-12"
        required: true
        depends_on: [mrp.demand_planning_rule]
```

## 3. 派生表达式语法（建议）

支持的元素（按"够用就好"原则）：

| 类型 | 例子 | 说明 |
|---|---|---|
| 字段引用 | `${customer.country}` | 引用最小集合字段 |
| 字典查找 | `${lookup.currency_by_country[customer.country]}` | 命名字典查找 |
| 三元 | `${customer.industry == 'Auto' ? 180 : 90}` | 简单条件 |
| 拼接 | `"${customer.customer_type}_${customer.country}"` | 字符串模板 |
| 静态值 | `"NET30"` | 直接是字面量 |

**不支持** 复杂逻辑（循环、跨任务引用、调用下游接口）——
派生规则应当**纯函数**：输入 minimum_data，输出 suggested_config。

## 4. 派生时机

```
task.status: WAITING → READY 时：

    customer = load(task.customer_id)
    template = template_engine.get(customer.customer_type)
    rules    = template.find_task(task.task_key).suggestions
    suggested_config = evaluate(rules, customer.min_data)
    cache(task.id, suggested_config)         # 写入 task 表的 suggested_config_snapshot
    emit_event("customer.task.ready", task, suggested_config)
```

> 一旦快照到 task 上，**不再随 min_data 变化重算**（避免下游已经基于旧建议开始工作）。
> 若 min_data 真的变了，需走"模板重派生"接口显式触发。

## 5. 下游拿到的完整 payload

```http
GET /customers/C0001/tasks/sales.customer_profile

200 OK
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

## 6. 字典（lookup）管理

`lookup.*` 表达式引用的字典，由 master-service 提供 CRUD：

```sql
CREATE TABLE lookup_table (
    name        VARCHAR(64) PRIMARY KEY,    -- 'currency_by_country'
    version     INT,
    entries     JSONB,                       -- {"JP":"JPY","US":"USD",...}
    updated_at  TIMESTAMP,
    updated_by  VARCHAR(100)
);
```

> 字典的 owner 不一定是 master-service 团队 —— 财务团队维护汇率字典、
> 销售团队维护价格簿字典都可以。Master-service 只是托管 + 版本化。

## 7. 模板版本与灰度

- 每个 customer 创建时**冻结**当前 active 模板版本（写入 `customer.template_version`）
- 已经创建的客户**不会**因为模板升级被静默改变
- 新版本模板生效后：
  - 新客户用新版
  - 老客户走"模板升级补齐"流程（[详见 roadmap](08-roadmap.md)）

## 8. 反例：什么不该做

| ❌ 反例 | 为什么 |
|---|---|
| 在派生规则里调用 Sales 系统获取价格 | 引入外部依赖，违反"纯函数"原则 |
| 把 Sales 配置完的 currency 值回写到 master | 越界，master 开始持有域字段 |
| 用派生规则覆盖下游已 done 的 task | 已 done 是下游的真相，master 不能改写 |
| 在 suggested_config 里嵌入"必填校验" | 校验是下游域的职责 |
