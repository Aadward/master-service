-- =====================================================================
-- 10 · 创建引导设计 (简化版) · DDL 与常用 SQL
--
-- 适用: MySQL 8.0+
-- 配套文档: docs/10-creation-guide.md
-- 设计取舍: 模板只放 DAG 结构 + checkpoint key 引用, SQL 抽到独立 checkpoint_def 表
-- 表清单 (4 张):
--   1. creation_guide_template    -- 模板元数据 + 完整 definition JSON
--   2. creation_guide_instance    -- 每业务对象一份, 冻结 definition_snapshot
--   3. guide_node_status          -- 一行一节点, 跟踪完成状态
--   4. checkpoint_def             -- 跨模板复用的 SQL 库, 按 (root_type, key) 索引
-- =====================================================================


-- =====================================================================
-- §1. 引导模板
--     1 行 = 1 份模板的 1 个版本; 全部结构性信息在 definition JSON
--     节点上的 checkpoints 数组只是 key 列表, 不是 SQL
-- =====================================================================

CREATE TABLE creation_guide_template (
    template_id      VARCHAR(64)  NOT NULL,
    version          INT          NOT NULL,
    root_type        VARCHAR(32)  NOT NULL COMMENT '业务对象类型: customer / location / region / company',
    customer_type    VARCHAR(50)  DEFAULT NULL COMMENT '可选,业务对象细分类型,如 standard_b2b',
    display_name     VARCHAR(200) NOT NULL,
    description      TEXT,
    definition       JSON         NOT NULL COMMENT '节点 + 依赖 + checkpoint key 列表; SQL 不在 JSON 里, 在 checkpoint_def',
    is_active        TINYINT(1)   NOT NULL DEFAULT 0,
    created_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    created_by       VARCHAR(64)  DEFAULT NULL,
    updated_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (template_id, version),
    KEY idx_active (root_type, customer_type, is_active)
) ENGINE=InnoDB COMMENT='引导模板: 1 行 1 版本, definition JSON 含 DAG 结构 + checkpoint key 列表';


-- =====================================================================
-- §2. 引导实例
--     每业务对象 1 份; 物化时把 template.definition 整块复制到 definition_snapshot
-- =====================================================================

CREATE TABLE creation_guide_instance (
    guide_instance_id  BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    root_type          VARCHAR(32)  NOT NULL,
    root_id            VARCHAR(64)  NOT NULL COMMENT '业务对象主键, 如 customer.cust_no',
    template_id        VARCHAR(64)  NOT NULL,
    template_version   INT          NOT NULL COMMENT '实例化时冻结的模板版本',
    definition_snapshot JSON        NOT NULL COMMENT '冻结: 物化当时 template.definition 的完整副本',
    overall_status     VARCHAR(20)  NOT NULL DEFAULT 'INIT'
                       COMMENT 'INIT / IN_PROGRESS / READY / PARTIAL / CANCELLED',
    created_at         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    created_by         VARCHAR(64)  DEFAULT NULL,
    completed_at       TIMESTAMP(3) DEFAULT NULL COMMENT '首次进入 READY / CANCELLED 的时间',
    UNIQUE KEY uk_root (root_type, root_id),
    KEY idx_status (overall_status),
    KEY idx_template (template_id, template_version)
) ENGINE=InnoDB COMMENT='引导实例: 每业务对象一份, 冻结定义 + 整体进度';


-- =====================================================================
-- §3. 节点完成状态
--     1 行 = 1 个 (实例, 节点) 的完成状态; 这是"那张完成状态表"
--     last_checkpoint_results 存最新一次 Test/Done 的所有 checkpoint 结果 (JSON)
--     没有 checkpoint_run 表 -- 不保留历史, 只看最新
-- =====================================================================

CREATE TABLE guide_node_status (
    id                      BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    guide_instance_id       BIGINT       NOT NULL,
    node_key                VARCHAR(100) NOT NULL,
    -- 状态机
    status                  VARCHAR(20)  NOT NULL DEFAULT 'WAITING'
                            COMMENT 'WAITING / READY / DONE / FAILED / SKIPPED / BLOCKED',
    -- 完成信息
    completed_at            TIMESTAMP(3) DEFAULT NULL,
    completed_by            VARCHAR(100) DEFAULT NULL,
    -- 最新一次 Test / Done 的所有 checkpoint 结果
    -- 结构: { "<checkpoint_key>": { "status": "PASS|FAIL|ERROR|TIMEOUT",
    --                                "message": "...", "detail": {...},
    --                                "at": "2026-06-08T10:23:45Z",
    --                                "error_code": null|"SQL_SYNTAX"|"CHECKPOINT_NOT_FOUND"|...,
    --                                "duration_ms": 42 }, ... }
    last_checkpoint_results JSON        DEFAULT NULL,
    -- 时间戳
    ready_at                TIMESTAMP(3) DEFAULT NULL COMMENT 'WAITING -> READY 的时间',
    created_at              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uk_guide_node (guide_instance_id, node_key),
    KEY idx_status (guide_instance_id, status)
) ENGINE=InnoDB COMMENT='节点完成状态: 一行一节点, 跟踪 status / 完成时间 / 最新 checkpoint 结果';

-- 节点 owner 不存这里 -- 永远是 definition_snapshot 里节点的 default_owner


-- =====================================================================
-- §4. Checkpoint 定义 (跨模板共享的 SQL 库)
--     按 (root_type, checkpoint_key) 寻址; 软删
-- =====================================================================

CREATE TABLE checkpoint_def (
    root_type         VARCHAR(32)  NOT NULL COMMENT '业务对象类型: customer / location / ...',
    checkpoint_key    VARCHAR(100) NOT NULL,
    display_name      VARCHAR(200) NOT NULL,
    description       TEXT,
    sql_template      TEXT         NOT NULL COMMENT '可执行 SQL, 支持 :root_id / :<column> / :attr_<key> 占位符',
    data_source       VARCHAR(64)  NOT NULL DEFAULT 'main' COMMENT 'SQL 执行目标数据源标识 (main / sales_db / ...)',
    timeout_seconds   INT          NOT NULL DEFAULT 10,
    deprecated_at     DATETIME(3)  DEFAULT NULL COMMENT '废弃时间, 软删而非硬删; 软删后 run 会 ERROR',
    created_at        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    created_by        VARCHAR(64)  DEFAULT NULL,
    updated_at        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (root_type, checkpoint_key),
    KEY idx_data_source (data_source)
) ENGINE=InnoDB COMMENT='Checkpoint 定义: 一段参数化 SQL, 跨模板复用; (root_type, key) 唯一';


-- =====================================================================
-- §5. 常用操作 SQL
-- =====================================================================


-- 5.1 插入一份模板 (definition 是 JSON, 节点 checkpoints 是 key 数组) ----

INSERT INTO creation_guide_template
    (template_id, version, root_type, customer_type, display_name, description, definition, is_active, created_by)
VALUES
    ('customer_onboarding_v2', 5, 'customer', 'standard_b2b',
     '客户配置标准流程 (B2B)', '标准 B2B 客户跨子系统配置向导',
     '{
        "template_id": "customer_onboarding_v2",
        "version": 5,
        "root_type": "customer",
        "customer_type": "standard_b2b",
        "nodes": [
          { "key": "sales.account_creation", "title": "在 Sales 创建客户主数据",
            "team": "sales", "default_owner": "张三",
            "document_url": "https://wiki.internal/runbooks/sales-account",
            "depends_on": [], "sort_order": 10, "estimated_minutes": 30,
            "require_checkpoints_on_done": true,
            "checkpoints": ["sales.account_exists", "sales.credit_consistent"]
          },
          { "key": "sales.contact_sync", "title": "同步联系人到 Sales",
            "team": "sales", "default_owner": "李四",
            "depends_on": ["sales.account_creation"], "sort_order": 20,
            "require_checkpoints_on_done": true,
            "checkpoints": ["sales.contact_synced"]
          },
          { "key": "finance.tax_region_setup", "title": "在 Finance 配置税区",
            "team": "finance", "default_owner": "王五",
            "depends_on": ["sales.account_creation"], "sort_order": 30,
            "require_checkpoints_on_done": true,
            "checkpoints": ["finance.tax_region_set"]
          },
          { "key": "mrp.demand_planning", "title": "在 MRP 配置需求计划",
            "team": "mrp", "default_owner": "赵六",
            "depends_on": ["sales.contact_sync"], "sort_order": 40,
            "require_checkpoints_on_done": false, "checkpoints": []
          }
        ]
      }',
     1, 'admin');


-- 5.2 插入一批 Checkpoint 定义 ---------------------------------------

INSERT INTO checkpoint_def VALUES
('customer', 'sales.account_exists',
 'Sales 系统中客户存在',
 '探查 customer_id 在 sales.account 表中是否存在',
 "SELECT CASE WHEN COUNT(*) > 0 THEN 'PASS' ELSE 'FAIL' END AS status,
         CONCAT('found ', COUNT(*), ' row(s)') AS message
  FROM sales.account WHERE customer_id = :root_id",
 'sales_db', 10, NULL, NOW(3), 'admin', NOW(3)),

('customer', 'sales.credit_consistent',
 'Sales credit 与中央 credit 一致',
 '比对 :attr_credit (中央属性) 与 sales.account.credit_limit',
 "SELECT
    CASE WHEN ABS(s.credit_limit - :attr_credit) < 0.01 THEN 'PASS' ELSE 'FAIL' END AS status,
    CONCAT('sales=', s.credit_limit, ' central=', :attr_credit) AS message,
    JSON_OBJECT('sales', s.credit_limit, 'central', :attr_credit) AS detail
  FROM sales.account s WHERE s.customer_id = :root_id",
 'sales_db', 10, NULL, NOW(3), 'admin', NOW(3)),

('customer', 'sales.contact_synced',
 '联系人已同步到 Sales',
 "SELECT CASE WHEN COUNT(*) >= 1 THEN 'PASS' ELSE 'FAIL' END AS status,
         CONCAT('found ', COUNT(*), ' contact(s)') AS message
  FROM sales.contact WHERE customer_id = :root_id",
 'sales_db', 10, NULL, NOW(3), 'admin', NOW(3)),

('customer', 'finance.tax_region_set',
 '税区已设置',
 "SELECT
    CASE WHEN tax_region IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
    CONCAT('tax_region=', IFNULL(tax_region, 'NULL')) AS message
  FROM finance.customer_setup WHERE customer_id = :root_id",
 'finance_db', 10, NULL, NOW(3), 'admin', NOW(3));


-- 5.3 软删一个 Checkpoint -------------------------------------------

UPDATE checkpoint_def
SET deprecated_at = NOW(3)
WHERE root_type = 'customer' AND checkpoint_key = 'sales.account_exists';


-- 5.4 创建一个引导实例 (事务, 物化所有节点) -------------------------

START TRANSACTION;

-- 步骤 1: 选最新 active 模板
SELECT definition FROM creation_guide_template
WHERE template_id = 'customer_onboarding_v2' AND is_active = 1
ORDER BY version DESC LIMIT 1;
-- 假设返回: @def (JSON), @ver = 5

-- 步骤 2: 插入 instance (definition_snapshot = template.definition 复制)
INSERT INTO creation_guide_instance
    (root_type, root_id, template_id, template_version, definition_snapshot,
     overall_status, created_by)
VALUES
    ('customer', 'C0001', 'customer_onboarding_v2', 5, @def, 'INIT', 'admin');

SET @guide_inst_id = LAST_INSERT_ID();

-- 步骤 3: 为 definition.nodes[] 里的每个节点插一行 guide_node_status
-- 节点 key 从 definition 里取; status 默认 WAITING; owner 不存这里 (在 definition_snapshot 里)
-- (应用层: JSON_TABLE 或者 Python 解析后批量 INSERT)
INSERT INTO guide_node_status (guide_instance_id, node_key, status) VALUES
    (@guide_inst_id, 'sales.account_creation',     'WAITING'),
    (@guide_inst_id, 'sales.contact_sync',         'WAITING'),
    (@guide_inst_id, 'finance.tax_region_setup',   'WAITING'),
    (@guide_inst_id, 'mrp.demand_planning',        'WAITING'),
    (@guide_inst_id, 'plm.bom_visibility',         'WAITING'),
    (@guide_inst_id, 'crm.marketing_segment',      'WAITING'),
    (@guide_inst_id, 'audit.signoff',              'WAITING');

-- 步骤 4: 入度=0 的节点 (无 depends_on) 置为 READY
UPDATE guide_node_status
SET status = 'READY', ready_at = NOW(3)
WHERE guide_instance_id = @guide_inst_id
  AND status = 'WAITING'
  AND node_key IN (
    SELECT node_key FROM JSON_TABLE(
      (SELECT definition_snapshot FROM creation_guide_instance
       WHERE guide_instance_id = @guide_inst_id),
      '$.nodes[*]'
      COLUMNS (node_key VARCHAR(100) PATH '$.key',
               depends_on JSON PATH '$.depends_on')
    ) AS n
    WHERE JSON_LENGTH(n.depends_on) = 0
  );
-- 这里只有 sales.account_creation 会变 READY

COMMIT;


-- 5.5 推进 DAG: 节点 sales.account_creation DONE 后 -----------------

START TRANSACTION;

-- 假设节点 default_owner (张三) 标记 sales.account_creation DONE (含 checkpoint 校验通过)
UPDATE guide_node_status
SET status = 'DONE',
    completed_at = NOW(3),
    completed_by = '张三',
    last_checkpoint_results = JSON_OBJECT(
        'sales.account_exists', JSON_OBJECT(
            'status', 'PASS', 'message', 'found 1 row',
            'at', DATE_FORMAT(NOW(3), '%Y-%m-%dT%H:%i:%sZ')
        ),
        'sales.credit_consistent', JSON_OBJECT(
            'status', 'PASS', 'message', 'sales=100000 central=100000',
            'at', DATE_FORMAT(NOW(3), '%Y-%m-%dT%H:%i:%sZ')
        )
    )
WHERE guide_instance_id = @guide_inst_id
  AND node_key = 'sales.account_creation'
  AND status = 'READY';

-- 推进后继: 从 definition_snapshot 找所有 depends_on 包含 sales.account_creation 的节点
-- 若其所有依赖都已终态, 置为 READY
UPDATE guide_node_status child
JOIN creation_guide_instance i
  ON i.guide_instance_id = child.guide_instance_id
JOIN JSON_TABLE(
  i.definition_snapshot, '$.nodes[*]'
  COLUMNS (
    node_key VARCHAR(100) PATH '$.key',
    depends_on JSON PATH '$.depends_on'
  )
) AS def ON def.node_key = child.node_key
SET child.status = 'READY', child.ready_at = NOW(3)
WHERE child.guide_instance_id = @guide_inst_id
  AND child.status = 'WAITING'
  AND JSON_CONTAINS(def.depends_on, JSON_QUOTE('sales.account_creation'))
  AND NOT EXISTS (
    SELECT 1
    FROM JSON_TABLE(def.depends_on, '$[*]' COLUMNS (dep VARCHAR(100) PATH '$')) AS d
    JOIN guide_node_status dep_node
      ON dep_node.guide_instance_id = @guide_inst_id
     AND dep_node.node_key = d.dep
    WHERE dep_node.status NOT IN ('DONE', 'SKIPPED')
  );
-- 这里 sales.contact_sync 和 finance.tax_region_setup 会变 READY

-- 重新聚合 overall_status
UPDATE creation_guide_instance
SET overall_status = (
    SELECT CASE
        WHEN SUM(status NOT IN ('DONE','SKIPPED','BLOCKED','FAILED')) > 0 THEN 'IN_PROGRESS'
        WHEN SUM(status IN ('FAILED','BLOCKED')) > 0 THEN 'PARTIAL'
        WHEN SUM(status = 'WAITING') = COUNT(*) THEN 'INIT'
        ELSE 'READY'
    END
    FROM guide_node_status
    WHERE guide_instance_id = @guide_inst_id
)
WHERE guide_instance_id = @guide_inst_id;

COMMIT;


-- 5.6 Test (不落 status, 只更新 last_checkpoint_results) ------------
-- 实际流程在 §8.5 详细描述, 这里给 SQL 示意

UPDATE guide_node_status
SET last_checkpoint_results = JSON_OBJECT(
    'sales.account_exists', JSON_OBJECT(
        'status', 'PASS', 'message', 'found 1 row',
        'at', DATE_FORMAT(NOW(3), '%Y-%m-%dT%H:%i:%sZ'),
        'duration_ms', 42
    )
)
WHERE guide_instance_id = @guide_inst_id
  AND node_key = 'sales.account_creation';
-- status 没动


-- 5.7 Mark Done (带 checkpoint 校验) -------------------------------
-- 实际流程在 §8.4 详细描述; 这里给 "校验通过后落 DONE" 的 SQL 示意

START TRANSACTION;

-- 1. 校验前置: 假设应用层已确认 require_checkpoints_on_done=true 且全部 PASS
--    (本次 run 的结果刚写到 last_checkpoint_results)

-- 2. 落 DONE
UPDATE guide_node_status
SET status = 'DONE',
    completed_at = NOW(3),
    completed_by = '张三'
WHERE guide_instance_id = @guide_inst_id
  AND node_key = 'sales.account_creation'
  AND status = 'READY';

-- 3. 推进后继 (同 5.5)
-- 4. 重新聚合 overall_status (同 5.5)

COMMIT;


-- 5.8 Block / Unblock ---------------------------------------------

-- Block (任意非终态 -> BLOCKED, 不推进后继)
UPDATE guide_node_status
SET status = 'BLOCKED'
WHERE guide_instance_id = @guide_inst_id
  AND node_key = 'mrp.demand_planning'
  AND status IN ('READY', 'WAITING');

-- Unblock: 强制回 WAITING, 重新评估依赖
UPDATE guide_node_status
SET status = 'WAITING'
WHERE guide_instance_id = @guide_inst_id
  AND node_key = 'mrp.demand_planning'
  AND status = 'BLOCKED';
-- 之后: 走 advance_dag 流程, 若依赖已终态则 WAITING -> READY


-- 5.9 Retry (FAILED -> READY) --------------------------------------

UPDATE guide_node_status
SET status = 'READY'
WHERE guide_instance_id = @guide_inst_id
  AND node_key = 'mrp.demand_planning'
  AND status = 'FAILED';


-- 5.10 查询某 customer 的整体进度 -----------------------------------

SELECT
    g.guide_instance_id,
    g.root_type, g.root_id,
    g.template_id, g.template_version,
    g.overall_status,
    g.created_at, g.completed_at,
    COUNT(s.id)                AS nodes_total,
    SUM(s.status = 'DONE')     AS nodes_done,
    SUM(s.status = 'SKIPPED')  AS nodes_skipped,
    SUM(s.status = 'READY')    AS nodes_ready,
    SUM(s.status = 'WAITING')  AS nodes_waiting,
    SUM(s.status = 'FAILED')   AS nodes_failed,
    SUM(s.status = 'BLOCKED')  AS nodes_blocked
FROM creation_guide_instance g
LEFT JOIN guide_node_status s ON s.guide_instance_id = g.guide_instance_id
WHERE g.root_type = 'customer' AND g.root_id = 'C0001'
GROUP BY g.guide_instance_id;


-- 5.11 查询某节点详情 (含 latest checkpoint results) ---------------

SELECT
    s.node_key,
    s.status,
    s.completed_at, s.completed_by,
    s.last_checkpoint_results,
    JSON_UNQUOTE(JSON_EXTRACT(g.definition_snapshot,
        CONCAT('$.nodes[?(@.key == "', s.node_key, '")].title'))) AS title,
    JSON_UNQUOTE(JSON_EXTRACT(g.definition_snapshot,
        CONCAT('$.nodes[?(@.key == "', s.node_key, '")].team'))) AS team,
    JSON_UNQUOTE(JSON_EXTRACT(g.definition_snapshot,
        CONCAT('$.nodes[?(@.key == "', s.node_key, '")].default_owner'))) AS default_owner,
    JSON_UNQUOTE(JSON_EXTRACT(g.definition_snapshot,
        CONCAT('$.nodes[?(@.key == "', s.node_key, '")].document_url'))) AS document_url
FROM guide_node_status s
JOIN creation_guide_instance g
  ON g.guide_instance_id = s.guide_instance_id
WHERE g.root_type = 'customer' AND g.root_id = 'C0001'
  AND s.node_key = 'sales.account_creation';


-- 5.12 列出某 customer 所有节点 (DAG 视图用) -----------------------

SELECT
    s.node_key,
    JSON_UNQUOTE(JSON_EXTRACT(g.definition_snapshot,
        CONCAT('$.nodes[?(@.key == "', s.node_key, '")].title'))) AS title,
    JSON_UNQUOTE(JSON_EXTRACT(g.definition_snapshot,
        CONCAT('$.nodes[?(@.key == "', s.node_key, '")].team'))) AS team,
    JSON_UNQUOTE(JSON_EXTRACT(g.definition_snapshot,
        CONCAT('$.nodes[?(@.key == "', s.node_key, '")].default_owner'))) AS default_owner,
    s.status,
    s.completed_at
FROM guide_node_status s
JOIN creation_guide_instance g
  ON g.guide_instance_id = s.guide_instance_id
WHERE g.root_type = 'customer' AND g.root_id = 'C0001'
ORDER BY JSON_EXTRACT(g.definition_snapshot,
        CONCAT('$.nodes[?(@.key == "', s.node_key, '")].sort_order'));


-- 5.13 列出所有可用的 Checkpoint (管理界面用) --------------------

SELECT root_type, checkpoint_key, display_name, data_source, timeout_seconds,
       (deprecated_at IS NOT NULL) AS deprecated
FROM checkpoint_def
WHERE root_type = 'customer'
ORDER BY checkpoint_key;


-- 5.14 模板加载时的校验 (应用层职责, 这里只列检查项) --------------
-- 这些约束不进 DB, 由模板加载器 (YAML/JSON 解析) 在 INSERT 前检查:
--   1. 节点 key 在 nodes[] 内唯一
--   2. depends_on 引用必须存在于 nodes[]
--   3. depends_on 不含自己
--   4. DAG 无环 (DFS / 拓扑排序)
--   5. (建议) 同一 (template_id, version) 内 sort_order 唯一
--   6. (建议) checkpoints 数组中的 key 都在 checkpoint_def 存在 (软警告, 不强制)
