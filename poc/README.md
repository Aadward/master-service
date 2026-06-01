# Master-Service POC

> 一个"会动的设计文档" —— 让团队可以亲眼看到 master-service 的设计在跑。

本 POC 完整演示了上层设计文档（见 [`../docs/`](../docs/)）所定义的工作流：

- 客户创建 → 任务按模板自动物化为 `WAITING`
- DAG 依赖解析：入度=0 自动 → `READY`，并按"建议配置项"规则派生 `suggested_config`
- **Inbox（域 owner 视角）**：各域 owner 在 master-service 上认领任务、看建议配置 **指引**、
  在自己的下游系统里配置完后回来点 **Confirm Done**
- 状态机推进：`Done` 触发后继；`Failed` 阻塞后继可重试
- 客户整体状态聚合：`INIT` / `IN_PROGRESS` / `READY` / `PARTIAL` / `CANCELLED`
- 审计日志：所有状态迁移可追溯

> ⚠ **关键边界**：master-service 不持有、不校验下游系统的实际配置内容。
> `suggested_config` 只是**指引**；下游 owner 是否采纳由下游决定。

---

## 技术栈

- **Next.js 14 (App Router) + TypeScript** —— 单仓库，API + UI
- **Prisma + SQLite** —— 零配置数据库
- **Tailwind CSS** —— 样式
- **@xyflow/react + dagre** —— DAG 可视化与自动布局
- **Zod + React Hook Form** —— 输入校验
- **客户端轮询 (1.5s)** —— 实时刷新

---

## 启动

```bash
# 1. 安装依赖
cd master-service/poc
npm install

# 2. 初始化数据库 + seed 模板和字典
npm run setup     # = prisma migrate dev + seed

# 3. 启动开发服务器
npm run dev

# 4. 打开浏览器
# http://localhost:3000
```

### 重置数据

```bash
npm run prisma:reset    # 清空 DB 并重新跑 migration（会自动 re-seed）
```

---

## 演示脚本（5 分钟看完）

**两个视角，两条路径：**

### A. 配置管理员视角（看全局）
1. **创建客户**：Dashboard → `+ Create Customer` → 填 `Acme JP / JP / Auto / standard_b2b` → 提交
2. **观察 DAG**：跳转到客户详情。12 个节点；初始只有 `sales.customer_profile` 和 `crm.contact_info` 是蓝色（READY）
3. **看建议派生**：点蓝色节点，右侧抽屉显示 `customer_min_data` + `suggested_config`，注意 `currency` 自动派生为 `JPY`
4. **一键演示推进**：左侧 Demo Helper 点 `⏩ Run All` → 整张 DAG 实时全绿
5. **审计**：Nav → `Audit Log` 看到所有状态迁移

### B. 域 owner 视角（实际操作流） ⭐
1. Nav → **Inbox**（默认 sales tab）
2. 看到自己域里 **Available** 的任务列表，点 **Claim** 认领
3. 任务进入 **In your queue**，展开看到：
   - 左边：客户最小集合数据
   - 右边：**建议配置项**（指引清单）
   - 蓝色横条：「请在你自己的 Sales 系统里打开 Sales-Page-01 完成配置」
4. （此处你切到自己的 ERP 系统配完）
5. 回到 Inbox，点 **✓ Confirm Done** —— 任务推进，下游可能解锁新任务
6. 顶部切换 domain tab（CRM / Finance / MRP / PLM）查看其他域的 inbox
7. 修改"You are"输入框可以模拟同域不同 owner 的协作

---

## 设计文档与代码对应

| 文档 | 实现位置 |
|---|---|
| [01 概览](../docs/01-design-overview.md) | 整个项目结构 |
| [02 状态机](../docs/02-task-state-machine.md) | `lib/types.ts` 的 `isValidTransition` |
| [03 DAG 调度](../docs/03-dag-scheduling.md) | `lib/dag-coordinator.ts` |
| [04 建议配置项](../docs/04-suggested-config.md) | `lib/expression-evaluator.ts` + `templates/standard_b2b.yaml` |
| [05 数据模型](../docs/05-data-model.md) | `prisma/schema.prisma` |
| [06 API 契约](../docs/06-api-contract.md) | `app/api/**/route.ts` |

---

## POC 范围 & 简化项

**包含**（对应"完全展示"）：
- ✅ 客户创建 / DAG 可视化 / 模块模拟
- ✅ suggested_config 派生（`${customer.X}`、`${lookup.X[...]}`、三元）
- ✅ 失败 / 重试 / 跳过 / 阻塞
- ✅ 审计日志 / 整体状态聚合
- ✅ Demo Helper (一键 Step / Run All / Fail / Skip / Retry)

**简化（未做）**：
- ❌ 身份认证、多租户
- ❌ Kafka / 真实消息队列 → 用轮询
- ❌ claim 超时回收的后台 cron → 字段保留，POC 不自动触发
- ❌ 模板版本灰度
- ❌ 部署 / Docker

---

## 目录结构

```
poc/
├── prisma/                Prisma schema + seed
├── templates/             示例 YAML 模板
├── lookups/               字典 JSON
├── app/                   Next.js App Router
│   ├── page.tsx           Dashboard
│   ├── customers/         创建表单 + 客户详情（DAG 页 ⭐ 管理员视角）
│   ├── inbox/             ⭐ 域 owner 视角的 Inbox（指引 + Confirm Done）
│   ├── templates/         模板查看器
│   ├── audit/             审计日志
│   └── api/               全部 REST endpoint
├── components/            DAGViewer / TaskNode / DetailPanel / DemoHelper 等
└── lib/                   核心逻辑：模板引擎 / 状态机 / 表达式 / 聚合
```
