const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function idFor(row) {
  return crypto
    .createHash("md5")
    .update([
      row.batchNo,
      row.expectedInboundTime || "",
      row.model,
      row.heightened ? "1" : "0",
      row.originalBatchNo || ""
    ].join("|"))
    .digest("hex");
}

loadEnvFile();

const dbConfig = {
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DATABASE || "rjfinshed",
  charset: "utf8mb4"
};

async function ensureHeightenedColumn(connection) {
  const [columns] = await connection.query("SHOW COLUMNS FROM wechat_batch_summary");
  const names = new Set(columns.map(column => column.Field));
  if (!names.has("加高")) {
    await connection.query("ALTER TABLE wechat_batch_summary ADD COLUMN `加高` TINYINT(1) NOT NULL DEFAULT 0 AFTER `数量`");
  }
  if (!names.has("原批次号")) {
    await connection.query("ALTER TABLE wechat_batch_summary ADD COLUMN `原批次号` VARCHAR(100) DEFAULT '' AFTER `加高`");
  }
  if (!names.has("原预计入库时间")) {
    await connection.query("ALTER TABLE wechat_batch_summary ADD COLUMN `原预计入库时间` DATETIME NULL AFTER `原批次号`");
  }
}

async function loadSummaryRows(connection) {
  const [rows] = await connection.query(`
    SELECT
      CASE
        WHEN \`合同备注\` LIKE '%加高%' THEN '加高'
        WHEN \`状态\` LIKE '库存中%' THEN '库存中'
        ELSE \`批次号\`
      END AS batchNo,
      \`预计入库时间\` AS expectedInboundTime,
      \`机型\` AS model,
      CASE WHEN \`合同备注\` LIKE '%加高%' THEN 1 ELSE 0 END AS heightened,
      COALESCE(NULLIF(\`批次号\`, ''), \`状态\`) AS originalBatchNo,
      \`预计入库时间\` AS originalExpectedInboundTime,
      COUNT(*) AS quantity
    FROM finished_goods_data
    WHERE (\`状态\` = '待入库' OR \`状态\` LIKE '库存中%')
      AND (\`客户\` IS NULL OR \`客户\` = '')
    GROUP BY
      CASE
        WHEN \`合同备注\` LIKE '%加高%' THEN '加高'
        WHEN \`状态\` LIKE '库存中%' THEN '库存中'
        ELSE \`批次号\`
      END,
      \`预计入库时间\`,
      \`机型\`,
      CASE WHEN \`合同备注\` LIKE '%加高%' THEN 1 ELSE 0 END,
      COALESCE(NULLIF(\`批次号\`, ''), \`状态\`)
    ORDER BY expectedInboundTime ASC, batchNo ASC, model ASC
  `);

  return rows.map(row => ({
    batchNo: row.batchNo || "UNKNOWN-BATCH",
    expectedInboundTime: row.expectedInboundTime,
    model: row.model || "",
    quantity: Number(row.quantity || 0),
    heightened: Number(row.heightened || 0),
    originalBatchNo: row.originalBatchNo || "",
    originalExpectedInboundTime: row.originalExpectedInboundTime
  })).filter(row => row.model && row.quantity > 0);
}

async function sync() {
  const connection = await mysql.createConnection(dbConfig);
  try {
    await ensureHeightenedColumn(connection);
    const rows = await loadSummaryRows(connection);

    await connection.beginTransaction();
    await connection.query("DELETE FROM wechat_batch_summary");
    for (const row of rows) {
      await connection.query(
        `INSERT INTO wechat_batch_summary
          (summary_id, batch_no, expected_inbound_time, model, quantity, \`批次号\`, \`预计入库时间\`, \`机型\`, \`数量\`, \`加高\`, \`原批次号\`, \`原预计入库时间\`, \`更新时间\`)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          idFor(row),
          row.batchNo,
          row.expectedInboundTime,
          row.model,
          row.quantity,
          row.batchNo,
          row.expectedInboundTime,
          row.model,
          row.quantity,
          row.heightened,
          row.heightened ? row.originalBatchNo : "",
          row.heightened ? row.originalExpectedInboundTime : null
        ]
      );
    }
    await connection.commit();

    const heightenedRows = rows.filter(row => row.heightened);
    const totalQty = rows.reduce((sum, row) => sum + row.quantity, 0);
    const heightenedQty = heightenedRows.reduce((sum, row) => sum + row.quantity, 0);
    console.log(`Synced ${rows.length} rows, total quantity ${totalQty}.`);
    console.log(`Heightened rows ${heightenedRows.length}, quantity ${heightenedQty}.`);
  } catch (err) {
    try {
      await connection.rollback();
    } catch (rollbackErr) {}
    throw err;
  } finally {
    await connection.end();
  }
}

sync().catch(err => {
  console.error(err);
  process.exit(1);
});
