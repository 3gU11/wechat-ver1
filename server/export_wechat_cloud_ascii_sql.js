const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

function loadEnv() {
  const env = {};
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return env;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

function sqlDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function cleanText(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (text.indexOf("鍔犻珮") !== -1) return "加高";
  if (text.indexOf("搴撳瓨") !== -1) return "库存中";
  return text.replace(/闄勫姞/g, "附加");
}

function valueSql(value) {
  if (value === null || value === undefined) return "NULL";
  if (value instanceof Date) return `'${sqlDate(value)}'`;
  if (typeof value === "number") return String(value);
  return mysql.escape(cleanText(value));
}

function insertRows(table, columns, rows) {
  if (!rows.length) return "";
  const lines = [];
  const colSql = columns.map(col => `\`${col}\``).join(", ");
  for (const row of rows) {
    const values = columns.map(col => valueSql(row[col])).join(", ");
    lines.push(`INSERT INTO \`${table}\` (${colSql}) VALUES (${values});`);
  }
  return lines.join("\n") + "\n";
}

async function main() {
  const env = loadEnv();
  const connection = await mysql.createConnection({
    host: env.MYSQL_HOST || "127.0.0.1",
    port: Number(env.MYSQL_PORT || 3306),
    user: env.MYSQL_USER || "root",
    password: env.MYSQL_PASSWORD || "",
    database: env.MYSQL_DATABASE || "rjfinshed",
    charset: "utf8mb4"
  });

  const [summaryRows] = await connection.query(`
    SELECT
      summary_id,
      batch_no,
      expected_inbound_time,
      model,
      quantity,
      heightened,
      original_batch_no,
      original_expected_inbound_time,
      updated_at
    FROM wechat_batch_summary
    ORDER BY expected_inbound_time ASC, batch_no ASC, model ASC
  `);
  const [modelRows] = await connection.query(`
    SELECT id, model_name, model_family, model_size, sort_order, enabled, remark, updated_at
    FROM model_dictionary
    ORDER BY sort_order ASC, model_name ASC
  `);
  await connection.end();

  const output = [];
  output.push("-- WeChat cloud database import, ASCII column version");
  output.push("-- Requires existing database: rjfinshed");
  output.push("USE `rjfinshed`;");
  output.push("SET NAMES utf8mb4;");
  output.push("SET FOREIGN_KEY_CHECKS=0;");
  output.push("");
  output.push("DROP TABLE IF EXISTS `wechat_batch_summary`;");
  output.push(`CREATE TABLE \`wechat_batch_summary\` (
  \`summary_id\` char(32) NOT NULL,
  \`batch_no\` varchar(100) NOT NULL,
  \`expected_inbound_time\` datetime DEFAULT NULL,
  \`model\` varchar(100) NOT NULL,
  \`quantity\` int NOT NULL DEFAULT 0,
  \`heightened\` tinyint(1) NOT NULL DEFAULT 0,
  \`original_batch_no\` varchar(100) DEFAULT '',
  \`original_expected_inbound_time\` datetime DEFAULT NULL,
  \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`summary_id\`),
  KEY \`idx_wechat_batch_summary_batch\` (\`batch_no\`),
  KEY \`idx_wechat_batch_summary_inbound\` (\`expected_inbound_time\`),
  KEY \`idx_wechat_batch_summary_model\` (\`model\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;`);
  output.push(insertRows("wechat_batch_summary", [
    "summary_id",
    "batch_no",
    "expected_inbound_time",
    "model",
    "quantity",
    "heightened",
    "original_batch_no",
    "original_expected_inbound_time",
    "updated_at"
  ], summaryRows));

  output.push("DROP TABLE IF EXISTS `dealer_applications`;");
  output.push(`CREATE TABLE \`dealer_applications\` (
  \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
  \`dealer_code\` varchar(128) NOT NULL,
  \`company_name\` varchar(255) NOT NULL,
  \`phone\` varchar(64) NOT NULL,
  \`password\` varchar(255) NOT NULL DEFAULT '',
  \`contact_name\` varchar(128) NOT NULL,
  \`region\` varchar(255) DEFAULT '',
  \`role\` varchar(32) NOT NULL DEFAULT 'dealer',
  \`regional_manager_name\` varchar(128) DEFAULT '',
  \`remark\` text,
  \`status\` varchar(32) NOT NULL DEFAULT 'pending',
  \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`dealer_code\` (\`dealer_code\`),
  UNIQUE KEY \`phone\` (\`phone\`),
  KEY \`idx_status\` (\`status\`),
  KEY \`idx_phone\` (\`phone\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;`);

  output.push("DROP TABLE IF EXISTS `dealer_orders`;");
  output.push(`CREATE TABLE \`dealer_orders\` (
  \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
  \`order_no\` varchar(64) NOT NULL,
  \`line_no\` int NOT NULL DEFAULT 1,
  \`dealer_id\` varchar(128) NOT NULL,
  \`dealer_name\` varchar(255) NOT NULL,
  \`dealer_phone\` varchar(64) DEFAULT '',
  \`regional_manager_name\` varchar(128) DEFAULT '',
  \`customer_name\` varchar(255) NOT NULL,
  \`contact_name\` varchar(128) NOT NULL,
  \`contact_phone\` varchar(64) NOT NULL,
  \`model\` varchar(255) NOT NULL,
  \`batch_no\` varchar(255) DEFAULT '',
  \`eta\` varchar(64) DEFAULT '',
  \`inventory_type\` varchar(32) DEFAULT '',
  \`quantity\` int NOT NULL DEFAULT 1,
  \`approved_qty\` int NOT NULL DEFAULT 0,
  \`allocated_qty\` int NOT NULL DEFAULT 0,
  \`extra_remark\` text,
  \`ERMQ\` int NOT NULL DEFAULT 0,
  \`factory_pending\` tinyint(1) NOT NULL DEFAULT 0,
  \`source\` varchar(32) NOT NULL DEFAULT 'wechat',
  \`last_synced_at\` datetime DEFAULT NULL,
  \`sync_status\` varchar(32) NOT NULL DEFAULT 'pending',
  \`sync_error\` text,
  \`factory_reviewed_at\` datetime DEFAULT NULL,
  \`factory_reviewed_by\` varchar(128) DEFAULT '',
  \`extra_remark_reviewed_at\` datetime DEFAULT NULL,
  \`extra_remark_reviewed_by\` varchar(128) DEFAULT '',
  \`delivery_date\` varchar(64) DEFAULT '',
  \`remark\` text,
  \`status\` varchar(32) NOT NULL DEFAULT 'pending',
  \`reviewed_at\` datetime DEFAULT NULL,
  \`reviewed_by\` varchar(128) DEFAULT '',
  \`contract_no\` varchar(128) DEFAULT '',
  \`v7_order_no\` varchar(128) DEFAULT '',
  \`review_note\` text,
  \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_dealer_order_line\` (\`order_no\`, \`line_no\`),
  KEY \`idx_dealer_order_no\` (\`order_no\`),
  KEY \`idx_dealer_id\` (\`dealer_id\`),
  KEY \`idx_status\` (\`status\`),
  KEY \`idx_batch_model_status\` (\`batch_no\`, \`model\`, \`status\`),
  KEY \`idx_created_at\` (\`created_at\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;`);

  output.push("DROP TABLE IF EXISTS `schema_migrations`;");
  output.push(`CREATE TABLE \`schema_migrations\` (
  \`version\` varchar(128) NOT NULL,
  \`applied_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`version\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;`);

  output.push("DROP TABLE IF EXISTS `dealer_order_sync_events`;");
  output.push(`CREATE TABLE \`dealer_order_sync_events\` (
  \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
  \`event_id\` varchar(64) NOT NULL,
  \`order_no\` varchar(64) NOT NULL,
  \`event_type\` varchar(64) NOT NULL,
  \`source\` varchar(32) NOT NULL DEFAULT 'wechat',
  \`payload_json\` json NOT NULL,
  \`status\` varchar(32) NOT NULL DEFAULT 'pending',
  \`attempts\` int NOT NULL DEFAULT 0,
  \`last_error\` text,
  \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`acked_at\` datetime DEFAULT NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`event_id\` (\`event_id\`),
  KEY \`idx_sync_events_order\` (\`order_no\`),
  KEY \`idx_sync_events_status\` (\`status\`, \`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;`);

  output.push("DROP TABLE IF EXISTS `model_dictionary`;");
  output.push(`CREATE TABLE \`model_dictionary\` (
  \`id\` int NOT NULL AUTO_INCREMENT,
  \`model_name\` varchar(100) NOT NULL,
  \`model_family\` varchar(100) DEFAULT '',
  \`model_size\` varchar(100) DEFAULT NULL,
  \`sort_order\` int NOT NULL DEFAULT 0,
  \`enabled\` tinyint(1) NOT NULL DEFAULT 1,
  \`remark\` varchar(255) DEFAULT '',
  \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_model_dictionary_name\` (\`model_name\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;`);
  output.push(insertRows("model_dictionary", [
    "id",
    "model_name",
    "model_family",
    "model_size",
    "sort_order",
    "enabled",
    "remark",
    "updated_at"
  ], modelRows));
  output.push("SET FOREIGN_KEY_CHECKS=1;");
  output.push("");

  const outPath = "D:\\V7STD\\rjfinshed_wechat_cloud_ascii.sql";
  fs.writeFileSync(outPath, output.join("\n"), "utf8");
  console.log(outPath);
  console.log(`wechat_batch_summary=${summaryRows.length}`);
  console.log(`model_dictionary=${modelRows.length}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
