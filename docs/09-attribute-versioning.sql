-- =====================================================================
-- 09 · 通用属性版本化设计 · DDL 与常用 SQL
--
-- 适用: MySQL 8.0+
-- 配套文档: docs/09-attribute-versioning.md
-- 时间语义: 左闭右开 [valid_from, valid_to)，valid_to = NULL 表示当前生效
-- 多值约定: is_multi=0 ⇒ seq_no=0;  is_multi=1 ⇒ seq_no>=1
-- =====================================================================

-- ---------------------------------------------------------------------
-- §1. 父表 (聚合根的"壳")
--     每个聚合根类型一张表,仅保留业务主键和状态
-- ---------------------------------------------------------------------

CREATE TABLE customer (
    cust_no      VARCHAR(64)  NOT NULL PRIMARY KEY,
    status       ENUM('active','merged','deleted') NOT NULL DEFAULT 'active',
    merged_to    VARCHAR(64)  DEFAULT NULL COMMENT 'status=merged 时指向新主键',
    remark       VARCHAR(512) DEFAULT NULL,
    created_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    KEY idx_status (status)
) ENGINE=InnoDB COMMENT='customer 聚合根的壳,仅记录存在性和状态';

-- location / region / company 同构,这里不重复贴
-- CREATE TABLE location  (loc_no    VARCHAR(64) PRIMARY KEY, status ..., merged_to ...);
-- CREATE TABLE region    (region_no VARCHAR(64) PRIMARY KEY, status ..., merged_to ...);
-- CREATE TABLE company   (company_no VARCHAR(64) PRIMARY KEY, status ..., merged_to ...);


-- ---------------------------------------------------------------------
-- §2. 属性定义表 (schema)
--     演进按 DDL 处理,不在 attr_def 上做版本控制
-- ---------------------------------------------------------------------

CREATE TABLE attr_def (
    root_type     VARCHAR(32)  NOT NULL,
    attr_key      VARCHAR(64)  NOT NULL,
    display_name  VARCHAR(128) NOT NULL,
    value_type    ENUM('int','bigint','decimal','datetime','string','text','bool') NOT NULL,
    is_multi      TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '是否支持多个值;0=单值(seq_no 固定为 0),1=多值(seq_no 从 1 起递增)',
    required      TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '创建聚合根时是否必填;多值时表示"是否至少要有一个 seq_no 有值"',
    deprecated_at DATETIME(3)  DEFAULT NULL COMMENT '废弃时间,不物理删除',
    description   VARCHAR(512),
    created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (root_type, attr_key)
) ENGINE=InnoDB COMMENT='属性元数据,按 (root_type, attr_key) 独立定义;is_multi 决定是否支持多值';


-- ---------------------------------------------------------------------
-- §2.5 is_multi / seq_no 不变量校验 (默认注释,不启用)
--      默认由应用层保证: 写入 attr_value 前检查 is_multi 与 seq_no 是否匹配
--      如需 DB 层强约束,取消下面的注释并执行
-- ---------------------------------------------------------------------

-- DELIMITER //
-- CREATE TRIGGER trg_attr_value_is_multi_insert
-- BEFORE INSERT ON attr_value
-- FOR EACH ROW
-- BEGIN
--     DECLARE v_is_multi TINYINT(1);
--     SELECT is_multi INTO v_is_multi FROM attr_def
--     WHERE root_type = NEW.root_type AND attr_key = NEW.attr_key;
--     IF v_is_multi = 0 AND NEW.seq_no <> 0 THEN
--         SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'is_multi=0 时 seq_no 必须为 0';
--     END IF;
--     IF v_is_multi = 1 AND NEW.seq_no <= 0 THEN
--         SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'is_multi=1 时 seq_no 必须 > 0';
--     END IF;
-- END//
-- CREATE TRIGGER trg_attr_value_is_multi_update
-- BEFORE UPDATE ON attr_value
-- FOR EACH ROW
-- BEGIN
--     DECLARE v_is_multi TINYINT(1);
--     SELECT is_multi INTO v_is_multi FROM attr_def
--     WHERE root_type = NEW.root_type AND attr_key = NEW.attr_key;
--     IF v_is_multi = 0 AND NEW.seq_no <> 0 THEN
--         SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'is_multi=0 时 seq_no 必须为 0';
--     END IF;
--     IF v_is_multi = 1 AND NEW.seq_no <= 0 THEN
--         SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'is_multi=1 时 seq_no 必须 > 0';
--     END IF;
-- END//
-- DELIMITER ;


-- ---------------------------------------------------------------------
-- §3. 属性值主表 (全量历史)
--     强类型分列 + 一行一值 + 当前行唯一
-- ---------------------------------------------------------------------

CREATE TABLE attr_value (
    id              BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    root_type       VARCHAR(32)  NOT NULL,
    root_id         VARCHAR(64)  NOT NULL,
    attr_key        VARCHAR(64)  NOT NULL,
    seq_no          INT          NOT NULL DEFAULT 0 COMMENT '单值 attribute 固定为 0;多值时从 1 起递增',

    -- 7 个强类型值列,每行恰好一列非空
    value_int       INT              DEFAULT NULL,
    value_bigint    BIGINT           DEFAULT NULL,
    value_decimal   DECIMAL(20,6)    DEFAULT NULL,
    value_datetime  DATETIME(3)      DEFAULT NULL,
    value_varchar   VARCHAR(512)     DEFAULT NULL,
    value_text      TEXT             DEFAULT NULL,
    value_bool      TINYINT(1)       DEFAULT NULL,

    -- 时间区间:左闭右开,valid_to = NULL 表示当前生效
    valid_from      DATETIME(3)  NOT NULL,
    valid_to        DATETIME(3)  DEFAULT NULL,
    created_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    created_by      VARCHAR(64)      DEFAULT NULL,

    -- 当前行唯一约束:每个 (root_type, root_id, attr_key, seq_no) 同时刻最多一行
    current_flag TINYINT(1) GENERATED ALWAYS AS
                 (IF(valid_to IS NULL, 1, NULL)) STORED,

    -- 一行一值校验:恰好一列非空
    populated_count TINYINT GENERATED ALWAYS AS (
        (value_int      IS NOT NULL) +
        (value_bigint   IS NOT NULL) +
        (value_decimal  IS NOT NULL) +
        (value_datetime IS NOT NULL) +
        (value_varchar  IS NOT NULL) +
        (value_text     IS NOT NULL) +
        (value_bool     IS NOT NULL)
    ) STORED,

    UNIQUE KEY uk_current    (root_type, root_id, attr_key, seq_no, current_flag),
    KEY        idx_lookup    (root_type, root_id, attr_key, seq_no, valid_from, valid_to),
    KEY        idx_int       (root_type, attr_key, value_int),
    KEY        idx_dec       (root_type, attr_key, value_decimal),
    KEY        idx_datetime  (root_type, attr_key, value_datetime),
    KEY        idx_varchar   (root_type, attr_key, value_varchar(64)),

    CHECK (valid_to IS NULL OR valid_to > valid_from),
    CHECK (populated_count = 1)
) ENGINE=InnoDB COMMENT='属性值全量历史,左闭右开 [valid_from, valid_to)';


-- ---------------------------------------------------------------------
-- §4. 当前视图 (物化,冗余换性能)
--     写入 attr_value 时事务内同步
-- ---------------------------------------------------------------------

CREATE TABLE attr_value_current (
    root_type   VARCHAR(32)  NOT NULL,
    root_id     VARCHAR(64)  NOT NULL,
    attr_key    VARCHAR(64)  NOT NULL,
    seq_no      INT          NOT NULL DEFAULT 0 COMMENT '单值 attribute 固定为 0;多值时从 1 起递增',

    value_int       INT              DEFAULT NULL,
    value_bigint    BIGINT           DEFAULT NULL,
    value_decimal   DECIMAL(20,6)    DEFAULT NULL,
    value_datetime  DATETIME(3)      DEFAULT NULL,
    value_varchar   VARCHAR(512)     DEFAULT NULL,
    value_text      TEXT             DEFAULT NULL,
    value_bool      TINYINT(1)       DEFAULT NULL,

    updated_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    PRIMARY KEY (root_type, root_id, attr_key, seq_no),
    KEY idx_int      (root_type, attr_key, value_int),
    KEY idx_dec      (root_type, attr_key, value_decimal),
    KEY idx_datetime (root_type, attr_key, value_datetime)
) ENGINE=InnoDB COMMENT='当前生效视图,写入 attr_value 时同步';


-- ---------------------------------------------------------------------
-- §5. 读侧视图:带类型信息的统一结果 (推荐给 API 层用)
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW v_attr_current_typed AS
SELECT
    avc.root_type, avc.root_id, avc.attr_key, avc.seq_no,
    ad.display_name, ad.value_type, ad.is_multi,
    CASE
        WHEN avc.value_int      IS NOT NULL THEN avc.value_int
        WHEN avc.value_bigint   IS NOT NULL THEN avc.value_bigint
        WHEN avc.value_decimal  IS NOT NULL THEN avc.value_decimal
        WHEN avc.value_datetime IS NOT NULL THEN avc.value_datetime
        WHEN avc.value_varchar  IS NOT NULL THEN avc.value_varchar
        WHEN avc.value_text     IS NOT NULL THEN avc.value_text
        WHEN avc.value_bool     IS NOT NULL THEN avc.value_bool
    END AS value,
    avc.updated_at
FROM attr_value_current avc
JOIN attr_def ad ON ad.root_type = avc.root_type AND ad.attr_key = avc.attr_key;


-- =====================================================================
-- §6. 常用操作 SQL
-- =====================================================================


-- 6.1 定义新 attribute -------------------------------------------------
-- 同一 attr_key 在不同 root_type 下可有独立元数据 (display_name / value_type / is_multi / 校验规则 等)
-- 例如 "phone": customer 多值 (匿名列表, seq_no>=1), location 单值
INSERT INTO attr_def (root_type, attr_key, display_name, value_type, is_multi, required, description)
VALUES
    ('customer', 'phone',     '客户联系电话', 'string',  1, 1, '主联系方式,11位手机号;支持多个值'),
    ('location', 'phone',     '门店电话',     'string',  0, 1, '座机格式,如 010-12345678'),
    ('customer', 'name',      '客户名称',     'string',  0, 1, NULL),
    ('customer', 'age',       '年龄',         'int',     0, 0, NULL),
    ('customer', 'credit',    '授信额度',     'decimal', 0, 0, '金额字段,decimal 精度'),
    ('customer', 'vip_flag',  '是否 VIP',     'bool',    0, 0, NULL);


-- 6.2 创建聚合根 (仅父表) ---------------------------------------------
INSERT INTO customer (cust_no) VALUES ('C001');


-- 6.3 首次写入一组属性 (事务) -----------------------------------------
-- 一组属性同时首次创建,典型场景:新建 customer 时一次性把必填项落库
-- 单值 attribute 的 seq_no 固定为 0 (可不显式写出)
START TRANSACTION;

INSERT INTO attr_value
    (root_type, root_id, attr_key, seq_no, value_varchar, value_int, value_decimal, value_bool, valid_from, created_by)
VALUES
    ('customer', 'C001', 'name',     0, 'Alice',       NULL, NULL,   NULL, '2024-01-01 00:00:00', 'admin'),
    ('customer', 'C001', 'age',      0, NULL,          30,   NULL,   NULL, '2024-01-01 00:00:00', 'admin'),
    ('customer', 'C001', 'credit',   0, NULL,          NULL, 50000.00,NULL, '2024-01-01 00:00:00', 'admin'),
    ('customer', 'C001', 'vip_flag', 0, NULL,          NULL, NULL,   1,    '2024-01-01 00:00:00', 'admin');

INSERT INTO attr_value_current
    (root_type, root_id, attr_key, seq_no, value_varchar, value_int, value_decimal, value_bool)
VALUES
    ('customer', 'C001', 'name',     0, 'Alice',  NULL, NULL,   NULL),
    ('customer', 'C001', 'age',      0, NULL,     30,   NULL,   NULL),
    ('customer', 'C001', 'credit',   0, NULL,     NULL, 50000.00,NULL),
    ('customer', 'C001', 'vip_flag', 0, NULL,     NULL, NULL,   1)
ON DUPLICATE KEY UPDATE
    value_varchar = VALUES(value_varchar),
    value_int     = VALUES(value_int),
    value_decimal = VALUES(value_decimal),
    value_bool    = VALUES(value_bool);

COMMIT;


-- 6.4 更新单个属性 (关旧开新) -----------------------------------------
-- 业务目标:把 C001 的 name 从 'Alice' 改成 'Alice Wang',生效时间 2024-06-08
-- 单值 attribute,seq_no 固定为 0 (可不显式写出)
START TRANSACTION;

-- 步骤 1:关闭当前行
UPDATE attr_value
SET valid_to = '2024-06-08 00:00:00'
WHERE root_type = 'customer'
  AND root_id   = 'C001'
  AND attr_key  = 'name'
  AND seq_no    = 0
  AND valid_to IS NULL;

-- 步骤 2:插入新当前行
INSERT INTO attr_value (root_type, root_id, attr_key, seq_no, value_varchar, valid_from, created_by)
VALUES ('customer', 'C001', 'name', 0, 'Alice Wang', '2024-06-08 00:00:00', 'admin');

-- 步骤 3:同步当前视图
INSERT INTO attr_value_current (root_type, root_id, attr_key, seq_no, value_varchar)
VALUES ('customer', 'C001', 'name', 0, 'Alice Wang')
ON DUPLICATE KEY UPDATE value_varchar = VALUES(value_varchar);

COMMIT;


-- 6.5 批量更新一个聚合根的多个属性 ------------------------------------
-- 业务目标:同时改 name、credit、vip_flag (不触动 phone 的多值 seq_no)
-- 关键:WHERE 用 attr_key IN (...) 限定关闭范围,避免误关多值 seq_no
START TRANSACTION;

-- 关闭指定 attribute 的当前行 (单值限定 seq_no=0)
UPDATE attr_value
SET valid_to = '2024-06-08 00:00:00'
WHERE root_type = 'customer' AND root_id = 'C001'
  AND valid_to IS NULL
  AND attr_key IN ('name', 'credit', 'vip_flag')
  AND seq_no = 0;

-- 批量插入新行
INSERT INTO attr_value
    (root_type, root_id, attr_key, seq_no, value_varchar, value_decimal, value_bool, valid_from, created_by)
VALUES
    ('customer', 'C001', 'name',     0, 'Alice Wang', NULL,    NULL, '2024-06-08 00:00:00', 'admin'),
    ('customer', 'C001', 'credit',   0, NULL,          80000.00,NULL, '2024-06-08 00:00:00', 'admin'),
    ('customer', 'C001', 'vip_flag', 0, NULL,          NULL,    0,   '2024-06-08 00:00:00', 'admin');

-- 批量同步 current
INSERT INTO attr_value_current (root_type, root_id, attr_key, seq_no, value_varchar, value_decimal, value_bool)
VALUES
    ('customer', 'C001', 'name',     0, 'Alice Wang', NULL,    NULL),
    ('customer', 'C001', 'credit',   0, NULL,          80000.00,NULL),
    ('customer', 'C001', 'vip_flag', 0, NULL,          NULL,    0)
ON DUPLICATE KEY UPDATE
    value_varchar = VALUES(value_varchar),
    value_decimal = VALUES(value_decimal),
    value_bool    = VALUES(value_bool);

COMMIT;


-- 6.6 作废/删除一个属性 (关闭不再使用,历史保留) -----------------------
-- 业务目标:客户 C001 的 vip_flag 从今天起不再使用
UPDATE attr_value
SET valid_to = '2024-06-08 00:00:00'
WHERE root_type = 'customer' AND root_id = 'C001'
  AND attr_key = 'vip_flag' AND seq_no = 0 AND valid_to IS NULL;

DELETE FROM attr_value_current
WHERE root_type = 'customer' AND root_id = 'C001' AND attr_key = 'vip_flag' AND seq_no = 0;

-- 若 attr_def 也废弃:
-- UPDATE attr_def SET deprecated_at = NOW() WHERE (root_type, attr_key) = ('customer', 'vip_flag');


-- 6.7 查询:当前视图 (最快路径) ---------------------------------------
SELECT attr_key, seq_no, value_int, value_bigint, value_decimal,
       value_datetime, value_varchar, value_text, value_bool
FROM attr_value_current
WHERE root_type = 'customer' AND root_id = 'C001';

-- 推荐:直接走视图,得到 (attr_key, seq_no, value, value_type) 四元组
SELECT attr_key, seq_no, value, value_type
FROM v_attr_current_typed
WHERE root_type = 'customer' AND root_id = 'C001';


-- 6.8 查询:时点快照 ("C001 在 2024-03-01 长什么样") -------------------
SELECT attr_key, seq_no, value_int, value_bigint, value_decimal,
       value_datetime, value_varchar, value_text, value_bool
FROM attr_value
WHERE root_type = 'customer' AND root_id = 'C001'
  AND valid_from <= '2024-03-01 00:00:00'
  AND (valid_to >  '2024-03-01 00:00:00' OR valid_to IS NULL);


-- 6.9 查询:变更历史 (一个属性的全生命周期) ---------------------------
SELECT attr_key, seq_no, value_varchar, valid_from, valid_to, created_at, created_by
FROM attr_value
WHERE root_type = 'customer' AND root_id = 'C001' AND attr_key = 'name' AND seq_no = 0
ORDER BY valid_from DESC;


-- 6.10 查询:带类型的统一结果 (API 层推荐) ----------------------------
-- 把"哪个列有值"翻译成 value + value_type
SELECT
    attr_key, seq_no,
    CASE
        WHEN value_int      IS NOT NULL THEN CAST(value_int      AS CHAR)
        WHEN value_bigint   IS NOT NULL THEN CAST(value_bigint   AS CHAR)
        WHEN value_decimal  IS NOT NULL THEN CAST(value_decimal  AS CHAR)
        WHEN value_datetime IS NOT NULL THEN DATE_FORMAT(value_datetime, '%Y-%m-%d %H:%i:%s.%f')
        WHEN value_varchar  IS NOT NULL THEN value_varchar
        WHEN value_text     IS NOT NULL THEN value_text
        WHEN value_bool     IS NOT NULL THEN CAST(value_bool     AS CHAR)
    END AS value_text,
    CASE
        WHEN value_int      IS NOT NULL THEN 'int'
        WHEN value_bigint   IS NOT NULL THEN 'bigint'
        WHEN value_decimal  IS NOT NULL THEN 'decimal'
        WHEN value_datetime IS NOT NULL THEN 'datetime'
        WHEN value_varchar  IS NOT NULL THEN 'string'
        WHEN value_text     IS NOT NULL THEN 'text'
        WHEN value_bool     IS NOT NULL THEN 'bool'
    END AS value_type
FROM attr_value_current
WHERE root_type = 'customer' AND root_id = 'C001';


-- 6.11 生成下游快照 (全量、特定时点) ----------------------------------
-- 给数仓/下游服务导出 2024-06-08 的全量客户维表
SELECT
    av.root_type, av.root_id, av.attr_key, av.seq_no,
    ad.value_type, ad.display_name, ad.is_multi,
    COALESCE(av.value_int, av.value_bigint, av.value_decimal,
             av.value_datetime, av.value_varchar, av.value_text, av.value_bool) AS value
FROM attr_value av
JOIN attr_def  ad ON ad.root_type = av.root_type AND ad.attr_key = av.attr_key
WHERE av.valid_from <= '2024-06-08 00:00:00'
  AND (av.valid_to  >  '2024-06-08 00:00:00' OR av.valid_to IS NULL)
  AND av.root_type = 'customer'
  AND ad.deprecated_at IS NULL;


-- 6.12 合并聚合根 (A → B) --------------------------------------------
-- 业务目标:把 C001 的当前所有 attribute "过户"给 C002
START TRANSACTION;

-- 1. 关闭 C001 所有当前行 (含多值的全部 seq_no)
UPDATE attr_value
SET valid_to = '2024-06-08 00:00:00'
WHERE root_type = 'customer' AND root_id = 'C001' AND valid_to IS NULL;

-- 2. C002 上与 C001 冲突的属性按业务策略处理 (这里演示"覆盖":先关 C002 当前的)
UPDATE attr_value
SET valid_to = '2024-06-08 00:00:00'
WHERE root_type = 'customer' AND root_id = 'C002' AND valid_to IS NULL;

-- 3. 把 C001 的当前值复制为 C002 的当前值 (含多值的全部 seq_no)
INSERT INTO attr_value
    (root_type, root_id, attr_key, seq_no, value_varchar, value_int, value_decimal,
     value_bool, value_datetime, value_text, valid_from, created_by)
SELECT 'customer', 'C002', attr_key, seq_no, value_varchar, value_int, value_decimal,
       value_bool, value_datetime, value_text,
       '2024-06-08 00:00:00', 'merge_script'
FROM attr_value
WHERE root_type = 'customer' AND root_id = 'C001'
  AND valid_to = '2024-06-08 00:00:00';

-- 4. 同步 current 视图 (简化:重建 C002 的 current,含多值 seq_no)
DELETE FROM attr_value_current WHERE root_type = 'customer' AND root_id = 'C002';

INSERT INTO attr_value_current
    (root_type, root_id, attr_key, seq_no, value_varchar, value_int, value_decimal,
     value_bool, value_datetime, value_text)
SELECT 'customer', 'C002', attr_key, seq_no, value_varchar, value_int, value_decimal,
       value_bool, value_datetime, value_text
FROM attr_value
WHERE root_type = 'customer' AND root_id = 'C002' AND valid_to IS NULL;

-- 5. 标记 C001 已合并
UPDATE customer SET status = 'merged', merged_to = 'C002' WHERE cust_no = 'C001';

COMMIT;


-- =====================================================================
-- §7. 多值 attribute 操作 (is_multi=1)
--     关键约定: is_multi=0 ⇒ seq_no=0;  is_multi=1 ⇒ seq_no>=1
--     seq_no 由应用层在 Redis 锁内计算 MAX(seq_no)+1,DB 不强制
-- =====================================================================


-- 7.1 写入第一个 (起始 seq_no=1) ---------------------------------------
-- 业务目标:为 C001 写入第一个电话
INSERT INTO attr_value (root_type, root_id, attr_key, seq_no, value_varchar, valid_from, created_by)
VALUES ('customer', 'C001', 'phone', 1, '13800138000', '2024-01-01 00:00:00', 'admin');

INSERT INTO attr_value_current (root_type, root_id, attr_key, seq_no, value_varchar)
VALUES ('customer', 'C001', 'phone', 1, '13800138000')
ON DUPLICATE KEY UPDATE value_varchar = VALUES(value_varchar);


-- 7.2 追加下一个值 (应用层获取 next_seq_no) ---------------------------
-- MySQL AUTO_INCREMENT 是 per-table 的,不能用;要 per-(root_type, root_id, attr_key) 自增
-- 需在 Redis 锁内计算 MAX(seq_no)+1 (见 Markdown §10.4)
-- 假设已通过 next_seq_no('customer', 'C001', 'phone') 获取到 2
INSERT INTO attr_value (root_type, root_id, attr_key, seq_no, value_varchar, valid_from, created_by)
VALUES ('customer', 'C001', 'phone', 2, '010-12345678', '2024-01-01 00:00:00', 'admin');

INSERT INTO attr_value_current (root_type, root_id, attr_key, seq_no, value_varchar)
VALUES ('customer', 'C001', 'phone', 2, '010-12345678')
ON DUPLICATE KEY UPDATE value_varchar = VALUES(value_varchar);


-- 7.3 一次性写入多个 (假设已获取 next_seq_no=3,4) -------------------
INSERT INTO attr_value (root_type, root_id, attr_key, seq_no, value_varchar, valid_from, created_by)
VALUES
    ('customer', 'C001', 'phone', 3, '021-87654321', '2024-01-01 00:00:00', 'admin'),
    ('customer', 'C001', 'phone', 4, '0571-11112222', '2024-01-01 00:00:00', 'admin');

INSERT INTO attr_value_current (root_type, root_id, attr_key, seq_no, value_varchar)
VALUES
    ('customer', 'C001', 'phone', 3, '021-87654321'),
    ('customer', 'C001', 'phone', 4, '0571-11112222')
ON DUPLICATE KEY UPDATE value_varchar = VALUES(value_varchar);


-- 7.4 更新某一个 seq_no (其他 seq_no 不动) ----------------------------
-- 业务目标:改 C001 的 seq_no=1 (第一个电话) 为 13900000000
START TRANSACTION;

UPDATE attr_value
SET valid_to = '2024-06-08 00:00:00'
WHERE root_type = 'customer' AND root_id = 'C001'
  AND attr_key = 'phone' AND seq_no = 1 AND valid_to IS NULL;

INSERT INTO attr_value (root_type, root_id, attr_key, seq_no, value_varchar, valid_from, created_by)
VALUES ('customer', 'C001', 'phone', 1, '13900000000', '2024-06-08 00:00:00', 'admin');

UPDATE attr_value_current SET value_varchar = '13900000000'
WHERE root_type = 'customer' AND root_id = 'C001'
  AND attr_key = 'phone' AND seq_no = 1;

COMMIT;


-- 7.5 删除某一个 seq_no (其他 seq_no 不动,seq_no 不会重排) ------------
-- 业务目标:移除 C001 的 seq_no=2 (第二个电话);seq_no=3,4 不动
UPDATE attr_value
SET valid_to = '2024-06-08 00:00:00'
WHERE root_type = 'customer' AND root_id = 'C001'
  AND attr_key = 'phone' AND seq_no = 2 AND valid_to IS NULL;

DELETE FROM attr_value_current
WHERE root_type = 'customer' AND root_id = 'C001'
  AND attr_key = 'phone' AND seq_no = 2;

-- 后续 next_seq_no() 会跳过已删除的 seq_no=2;新加的可能落到 seq_no=5 (视当前 MAX+1)


-- 7.6 查询:多值 attribute 的所有当前 seq_no --------------------------
-- 直接走 current 视图
SELECT seq_no, value_varchar
FROM attr_value_current
WHERE root_type = 'customer' AND root_id = 'C001' AND attr_key = 'phone'
ORDER BY seq_no;

-- 或走 v_attr_current_typed 拿带类型信息的结果
SELECT seq_no, value, value_type
FROM v_attr_current_typed
WHERE root_type = 'customer' AND root_id = 'C001' AND attr_key = 'phone'
ORDER BY seq_no;


-- 7.7 查询:某 seq_no 的时点快照 ---------------------------------------
SELECT seq_no, value_varchar, valid_from, valid_to
FROM attr_value
WHERE root_type = 'customer' AND root_id = 'C001'
  AND attr_key = 'phone' AND seq_no = 1
  AND valid_from <= '2024-06-08 00:00:00'
  AND (valid_to >  '2024-06-08 00:00:00' OR valid_to IS NULL);


-- 7.8 查询:某 seq_no 的变更历史 ---------------------------------------
SELECT seq_no, value_varchar, valid_from, valid_to, created_at, created_by
FROM attr_value
WHERE root_type = 'customer' AND root_id = 'C001'
  AND attr_key = 'phone' AND seq_no = 1
ORDER BY valid_from DESC;
