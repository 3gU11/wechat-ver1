const http = require("http");
const { URL } = require("url");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
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

loadEnvFile();

const PORT = Number(process.env.PORT || 8001);
const TABLE_NAME = "wechat_batch_summary";
const ORDER_HOLD_STATUSES = ["regional_pending", "pending", "approved"];
const PASSWORD_HASH_PREFIX = "scrypt$";

function parseMysqlAddress(address) {
  const text = normalize(address);
  if (!text) {
    return {};
  }
  const [host, port] = text.split(":");
  return {
    host: host || "",
    port: port ? Number(port) : undefined
  };
}

const mysqlAddress = parseMysqlAddress(process.env.MYSQL_ADDRESS);

const dbConfig = {
  host: process.env.MYSQL_HOST || mysqlAddress.host || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT || mysqlAddress.port || 3306),
  user: process.env.MYSQL_USER || process.env.MYSQL_USERNAME || "root",
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DATABASE || "rjfinshed",
  charset: "utf8mb4"
};

const fieldCandidates = {
  model: ["model"],
  quantity: ["quantity"],
  batchNo: ["batch_no"],
  eta: ["expected_inbound_time"],
  status: ["status", "state", "inventory_status", "lifecycle_status"],
  bound: ["bound", "is_bound", "bind_status", "binding_status"],
  heightened: ["heightened"],
  originalBatchNo: ["original_batch_no"],
  originalEta: ["original_expected_inbound_time"]
};

function pickColumn(columns, key) {
  const lowerMap = new Map(columns.map(column => [column.toLowerCase(), column]));
  for (const candidate of fieldCandidates[key]) {
    if (columns.includes(candidate)) {
      return candidate;
    }
    const matched = lowerMap.get(candidate.toLowerCase());
    if (matched) {
      return matched;
    }
  }
  return "";
}

function normalize(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).trim();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 32).toString("hex");
  return `${PASSWORD_HASH_PREFIX}${salt}$${hash}`;
}

function verifyPassword(password, storedPassword) {
  const stored = normalize(storedPassword);
  if (!stored.startsWith(PASSWORD_HASH_PREFIX)) {
    return String(password) === stored;
  }
  const parts = stored.split("$");
  if (parts.length !== 3 || !parts[1] || !parts[2]) {
    return false;
  }
  const hash = crypto.scryptSync(String(password), parts[1], 32);
  const storedHash = Buffer.from(parts[2], "hex");
  return storedHash.length === hash.length && crypto.timingSafeEqual(hash, storedHash);
}

function isPasswordHash(value) {
  return normalize(value).startsWith(PASSWORD_HASH_PREFIX);
}

function isUnbound(row, boundCol) {
  if (!boundCol) {
    return true;
  }
  const value = normalize(row[boundCol]).toLowerCase();
  if (["", "0", "false", "no", "none", "null", "unbound", "available", "未绑定", "未绑", "可订"].includes(value)) {
    return true;
  }
  if (["1", "true", "yes", "bound", "已绑定", "已绑"].includes(value)) {
    return false;
  }
  return value !== "bound";
}

function inventoryType(row, statusCol, eta) {
  if (statusCol) {
    const value = normalize(row[statusCol]).toLowerCase();
    if (value.startsWith("库存中") || ["finished", "stock", "in_stock", "成品", "成品库", "现货", "已入库"].includes(value)) {
      return "finished";
    }
    if (["待入库", "wip", "production", "producing", "在制", "生产中", "排产中"].includes(value)) {
      return "wip";
    }
    return "";
  }
  return eta && eta !== "现货" ? "wip" : "finished";
}

function isStockBatch(batchNo) {
  const text = normalize(batchNo).toLowerCase();
  return ["库存中", "finished-stock", "stock", "in_stock", "finished"].includes(text);
}

function quantityValue(row, quantityCol) {
  if (!quantityCol) {
    return 1;
  }
  const value = row[quantityCol];
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 1;
}

function isHeightenedValue(value) {
  const text = normalize(value).toLowerCase();
  return ["1", "true", "yes", "加高", "heightened"].includes(text);
}

function heightenedModelName(model) {
  if (!model || model.indexOf("加高") !== -1) {
    return model;
  }
  return `${model}(加高)`;
}

async function loadRows() {
  const connection = await mysql.createConnection(dbConfig);
  try {
    const [rows, fields] = await connection.query(`SELECT * FROM \`${TABLE_NAME}\``);
    return { rows, columns: fields.map(field => field.name) };
  } finally {
    await connection.end();
  }
}

async function loadColumns() {
  const connection = await mysql.createConnection(dbConfig);
  try {
    const [fields] = await connection.query(`SHOW COLUMNS FROM \`${TABLE_NAME}\``);
    return fields.map(field => ({
      field: field.Field,
      type: field.Type,
      nullable: field.Null,
      key: field.Key,
      default: field.Default
    }));
  } finally {
    await connection.end();
  }
}

async function ensureDealerOrdersTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS dealer_orders (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      order_no VARCHAR(64) NOT NULL,
      line_no INT NOT NULL DEFAULT 1,
      dealer_id VARCHAR(128) NOT NULL,
      dealer_name VARCHAR(255) NOT NULL,
      dealer_phone VARCHAR(64) DEFAULT '',
      regional_manager_name VARCHAR(128) DEFAULT '',
      customer_name VARCHAR(255) NOT NULL,
      contact_name VARCHAR(128) NOT NULL,
      contact_phone VARCHAR(64) NOT NULL,
      model VARCHAR(255) NOT NULL,
      batch_no VARCHAR(255) DEFAULT '',
      eta VARCHAR(64) DEFAULT '',
      inventory_type VARCHAR(32) DEFAULT '',
      quantity INT NOT NULL DEFAULT 1,
      approved_qty INT NOT NULL DEFAULT 0,
      allocated_qty INT NOT NULL DEFAULT 0,
      extra_remark TEXT,
      ERMQ INT NOT NULL DEFAULT 0,
      factory_pending TINYINT(1) NOT NULL DEFAULT 0,
      source VARCHAR(32) NOT NULL DEFAULT 'wechat',
      last_synced_at DATETIME NULL,
      sync_status VARCHAR(32) NOT NULL DEFAULT 'pending',
      sync_error TEXT,
      factory_reviewed_at DATETIME NULL,
      factory_reviewed_by VARCHAR(128) DEFAULT '',
      extra_remark_reviewed_at DATETIME NULL,
      extra_remark_reviewed_by VARCHAR(128) DEFAULT '',
      delivery_date VARCHAR(64) DEFAULT '',
      remark TEXT,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      regional_review_status VARCHAR(32) NOT NULL DEFAULT 'pending',
      regional_review_note TEXT,
      regional_reviewed_by VARCHAR(128) DEFAULT '',
      regional_reviewed_at DATETIME NULL,
      reviewed_at DATETIME NULL,
      reviewed_by VARCHAR(128) DEFAULT '',
      contract_no VARCHAR(128) DEFAULT '',
      v7_order_no VARCHAR(128) DEFAULT '',
      review_note TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_dealer_order_line (order_no, line_no),
      INDEX idx_dealer_order_no (order_no),
      INDEX idx_dealer_id (dealer_id),
      INDEX idx_status (status),
      INDEX idx_batch_model_status (batch_no, model, status),
      INDEX idx_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [columns] = await connection.query("SHOW COLUMNS FROM dealer_orders");
  const columnNames = new Set(columns.map(column => column.Field));
  const additions = [
    ["line_no", "ALTER TABLE dealer_orders ADD COLUMN line_no INT NOT NULL DEFAULT 1 AFTER order_no"],
    ["regional_manager_name", "ALTER TABLE dealer_orders ADD COLUMN regional_manager_name VARCHAR(128) DEFAULT '' AFTER dealer_phone"],
    ["approved_qty", "ALTER TABLE dealer_orders ADD COLUMN approved_qty INT NOT NULL DEFAULT 0 AFTER quantity"],
    ["allocated_qty", "ALTER TABLE dealer_orders ADD COLUMN allocated_qty INT NOT NULL DEFAULT 0 AFTER approved_qty"],
    ["extra_remark", "ALTER TABLE dealer_orders ADD COLUMN extra_remark TEXT AFTER allocated_qty"],
    ["ERMQ", "ALTER TABLE dealer_orders ADD COLUMN ERMQ INT NOT NULL DEFAULT 0 AFTER extra_remark"],
    ["factory_pending", "ALTER TABLE dealer_orders ADD COLUMN factory_pending TINYINT(1) NOT NULL DEFAULT 0 AFTER ERMQ"],
    ["source", "ALTER TABLE dealer_orders ADD COLUMN source VARCHAR(32) NOT NULL DEFAULT 'wechat' AFTER factory_pending"],
    ["last_synced_at", "ALTER TABLE dealer_orders ADD COLUMN last_synced_at DATETIME NULL AFTER source"],
    ["sync_status", "ALTER TABLE dealer_orders ADD COLUMN sync_status VARCHAR(32) NOT NULL DEFAULT 'pending' AFTER last_synced_at"],
    ["sync_error", "ALTER TABLE dealer_orders ADD COLUMN sync_error TEXT AFTER sync_status"],
    ["factory_reviewed_at", "ALTER TABLE dealer_orders ADD COLUMN factory_reviewed_at DATETIME NULL AFTER sync_error"],
    ["factory_reviewed_by", "ALTER TABLE dealer_orders ADD COLUMN factory_reviewed_by VARCHAR(128) DEFAULT '' AFTER factory_reviewed_at"],
    ["extra_remark_reviewed_at", "ALTER TABLE dealer_orders ADD COLUMN extra_remark_reviewed_at DATETIME NULL AFTER factory_reviewed_by"],
    ["extra_remark_reviewed_by", "ALTER TABLE dealer_orders ADD COLUMN extra_remark_reviewed_by VARCHAR(128) DEFAULT '' AFTER extra_remark_reviewed_at"],
    ["regional_review_status", "ALTER TABLE dealer_orders ADD COLUMN regional_review_status VARCHAR(32) NOT NULL DEFAULT 'pending' AFTER status"],
    ["regional_review_note", "ALTER TABLE dealer_orders ADD COLUMN regional_review_note TEXT AFTER regional_review_status"],
    ["regional_reviewed_by", "ALTER TABLE dealer_orders ADD COLUMN regional_reviewed_by VARCHAR(128) DEFAULT '' AFTER regional_review_note"],
    ["regional_reviewed_at", "ALTER TABLE dealer_orders ADD COLUMN regional_reviewed_at DATETIME NULL AFTER regional_reviewed_by"],
    ["reviewed_at", "ALTER TABLE dealer_orders ADD COLUMN reviewed_at DATETIME NULL AFTER status"],
    ["reviewed_by", "ALTER TABLE dealer_orders ADD COLUMN reviewed_by VARCHAR(128) DEFAULT '' AFTER reviewed_at"],
    ["contract_no", "ALTER TABLE dealer_orders ADD COLUMN contract_no VARCHAR(128) DEFAULT '' AFTER reviewed_by"],
    ["v7_order_no", "ALTER TABLE dealer_orders ADD COLUMN v7_order_no VARCHAR(128) DEFAULT '' AFTER contract_no"],
    ["review_note", "ALTER TABLE dealer_orders ADD COLUMN review_note TEXT AFTER v7_order_no"]
  ];
  for (const [columnName, sql] of additions) {
    if (!columnNames.has(columnName)) {
      await connection.query(sql);
    }
  }

  const [indexes] = await connection.query("SHOW INDEX FROM dealer_orders");
  const indexNames = new Set(indexes.map(index => index.Key_name));
  for (const indexName of ["order_no", "uq_order_no"]) {
    if (indexNames.has(indexName)) {
      await connection.query(`ALTER TABLE dealer_orders DROP INDEX \`${indexName}\``);
    }
  }
  const [nextIndexes] = await connection.query("SHOW INDEX FROM dealer_orders");
  const nextIndexNames = new Set(nextIndexes.map(index => index.Key_name));
  if (!nextIndexNames.has("idx_dealer_order_no")) {
    await connection.query("ALTER TABLE dealer_orders ADD INDEX idx_dealer_order_no (order_no)");
  }
  if (!nextIndexNames.has("uq_dealer_order_line")) {
    await connection.query("ALTER TABLE dealer_orders ADD UNIQUE KEY uq_dealer_order_line (order_no, line_no)");
  }
}
async function ensureDealerApplicationsTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS dealer_applications (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      dealer_code VARCHAR(128) NOT NULL UNIQUE,
      company_name VARCHAR(255) NOT NULL,
      phone VARCHAR(64) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL DEFAULT '',
      contact_name VARCHAR(128) NOT NULL,
      region VARCHAR(255) DEFAULT '',
      role VARCHAR(32) NOT NULL DEFAULT 'dealer',
      regional_manager_name VARCHAR(128) DEFAULT '',
      remark TEXT,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status (status),
      INDEX idx_phone (phone)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [columns] = await connection.query("SHOW COLUMNS FROM dealer_applications");
  const columnNames = new Set(columns.map(column => column.Field));
  const additions = [
    ["password", "ALTER TABLE dealer_applications ADD COLUMN password VARCHAR(255) NOT NULL DEFAULT '' AFTER phone"],
    ["role", "ALTER TABLE dealer_applications ADD COLUMN role VARCHAR(32) NOT NULL DEFAULT 'dealer' AFTER region"],
    ["regional_manager_name", "ALTER TABLE dealer_applications ADD COLUMN regional_manager_name VARCHAR(128) DEFAULT '' AFTER role"]
  ];
  for (const [columnName, sql] of additions) {
    if (!columnNames.has(columnName)) {
      await connection.query(sql);
    }
  }
  const passwordColumn = columns.find(column => column.Field === "password");
  if (passwordColumn && !/char|text/i.test(String(passwordColumn.Type || ""))) {
    await connection.query("ALTER TABLE dealer_applications MODIFY COLUMN password VARCHAR(255) NOT NULL DEFAULT ''");
  }

}

async function ensureSchemaMigrationsTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(128) NOT NULL PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureDealerOrderSyncEventsTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS dealer_order_sync_events (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      event_id VARCHAR(64) NOT NULL UNIQUE,
      order_no VARCHAR(64) NOT NULL,
      event_type VARCHAR(64) NOT NULL,
      source VARCHAR(32) NOT NULL DEFAULT 'wechat',
      payload_json JSON NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      attempts INT NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      acked_at DATETIME NULL,
      KEY idx_sync_events_order (order_no),
      KEY idx_sync_events_status (status, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureSupportSchema(connection) {
  await ensureSchemaMigrationsTable(connection);
  await ensureDealerOrderSyncEventsTable(connection);
  await connection.query(
    "INSERT IGNORE INTO schema_migrations (version) VALUES (?)",
    ["20260522_001_dealer_order_sync_foundation"]
  );
}

async function createDealerOrderSyncEvent(connection, orderNo, eventType, payload = {}, source = "wechat") {
  const eventId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
  await connection.query(
    `INSERT INTO dealer_order_sync_events
      (event_id, order_no, event_type, source, payload_json)
     VALUES (?, ?, ?, ?, CAST(? AS JSON))`,
    [eventId, orderNo, eventType, source, JSON.stringify(payload, null, 0)]
  );
  return eventId;
}

async function readJsonBody(req) {
  return await new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("请求体过大"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error("JSON格式错误"));
      }
    });
    req.on("error", reject);
  });
}

function makeOrderNo() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const random = Math.floor(Math.random() * 9000 + 1000);
  return `DO${y}${m}${d}${hh}${mm}${ss}${random}`;
}

function requireText(value, fieldName) {
  const text = normalize(value);
  if (!text) {
    const err = new Error(`${fieldName}不能为空`);
    err.statusCode = 400;
    throw err;
  }
  return text;
}

function accountIdFromToken(req) {
  const header = normalize(req && req.headers && req.headers.authorization);
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1] : "";
  if (token === "local-admin-token" || token === "mock-admin-token") return "admin";
  if (token.startsWith("dealer-token-")) return token.slice("dealer-token-".length);
  if (token.startsWith("mock-dealer-token-")) return token.slice("mock-dealer-token-".length);
  return "";
}

function requireAdminRequest(req) {
  if (accountIdFromToken(req) !== "admin") {
    const err = new Error("无管理员权限");
    err.statusCode = 403;
    throw err;
  }
}

async function loadAccountByToken(req) {
  const accountId = accountIdFromToken(req);
  if (!accountId) {
    const err = new Error("请先登录");
    err.statusCode = 401;
    throw err;
  }
  if (accountId === "admin") {
    return { id: "admin", role: "admin", name: "系统管理员", phone: "admin", contactName: "系统管理员" };
  }
  const connection = await mysql.createConnection(dbConfig);
  try {
    await ensureDealerApplicationsTable(connection);
    const [rows] = await connection.query(
      `SELECT dealer_code AS id, company_name AS name, phone, contact_name AS contactName,
              region, role, regional_manager_name AS regionalManagerName, status
       FROM dealer_applications
       WHERE dealer_code = ?
       LIMIT 1`,
      [accountId]
    );
    if (!rows.length || rows[0].status !== "approved") {
      const err = new Error("账号不存在或未审核通过");
      err.statusCode = 403;
      throw err;
    }
    return rows[0];
  } finally {
    await connection.end();
  }
}

async function createDealerApplication(payload) {
  const companyName = requireText(payload.companyName, "经销商公司");
  const phone = requireText(payload.phone, "手机号");
  const password = hashPassword(requireText(payload.password, "登录密码"));
  const contactName = requireText(payload.contactName, "姓名");
  const region = requireText(payload.region, "所在地区");
  const role = normalize(payload.role) === "regional_manager" ? "regional_manager" : "dealer";
  const regionalManagerName = normalize(payload.regionalManagerName);
  if (role === "dealer" && !regionalManagerName) {
    const err = new Error("请选择所属大区经理");
    err.statusCode = 400;
    throw err;
  }
  const remark = normalize(payload.remark);
  const dealerCode = `dealer-${Date.now()}`;

  const connection = await mysql.createConnection(dbConfig);
  try {
    await ensureDealerApplicationsTable(connection);
    const [exists] = await connection.query(
      "SELECT dealer_code FROM dealer_applications WHERE phone = ? LIMIT 1",
      [phone]
    );
    if (exists.length) {
      const err = new Error("该手机号已提交过注册申请");
      err.statusCode = 400;
      throw err;
    }

    await connection.query(
      `INSERT INTO dealer_applications
        (dealer_code, company_name, phone, password, contact_name, region, role, regional_manager_name, remark, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [dealerCode, companyName, phone, password, contactName, region, role, regionalManagerName, remark]
    );
  } finally {
    await connection.end();
  }

  return {
    status: "pending",
    message: "注册申请已提交，请等待管理员审核",
  };
}

async function loginDealer(payload) {
  const phone = requireText(payload.phone, "手机号");
  const password = requireText(payload.password, "密码");

  if (phone === "admin" && password === "admin123") {
    return {
      token: "local-admin-token",
      account: {
        id: "admin",
        role: "admin",
        name: "系统管理员",
        phone: "admin",
        status: "approved",
      },
    };
  }

  const connection = await mysql.createConnection(dbConfig);
  try {
    await ensureDealerApplicationsTable(connection);
    const [rows] = await connection.query(
      `SELECT
        dealer_code AS id,
        company_name AS name,
        phone,
        password,
        contact_name AS contactName,
        region,
        role,
        regional_manager_name AS regionalManagerName,
        status
       FROM dealer_applications
       WHERE phone = ?
       LIMIT 1`,
      [phone]
    );

    if (!rows.length) {
      const err = new Error("手机号未注册，请先提交注册申请");
      err.statusCode = 404;
      throw err;
    }

    const dealer = rows[0];
    if (!verifyPassword(password, dealer.password)) {
      const err = new Error("密码错误");
      err.statusCode = 401;
      throw err;
    }
    if (!isPasswordHash(dealer.password)) {
      await connection.query(
        "UPDATE dealer_applications SET password = ? WHERE dealer_code = ?",
        [hashPassword(password), dealer.id]
      );
    }
    if (dealer.status !== "approved") {
      const err = new Error("账号还未审核通过，暂不能登录");
      err.statusCode = 403;
      throw err;
    }

    return {
      token: `dealer-token-${dealer.id}`,
      account: {
        id: dealer.id,
        role: dealer.role || "dealer",
        name: dealer.name,
        phone: dealer.phone,
        contactName: dealer.contactName,
        region: dealer.region,
        regionalManagerName: dealer.regionalManagerName,
        status: dealer.status,
      },
    };
  } finally {
    await connection.end();
  }
}

async function listDealerApplications() {
  const connection = await mysql.createConnection(dbConfig);
  try {
    await ensureDealerApplicationsTable(connection);
    const [rows] = await connection.query(
      `SELECT
        dealer_code AS id,
        company_name AS companyName,
        phone,
        contact_name AS contactName,
        region,
        role,
        regional_manager_name AS regionalManagerName,
        remark,
        status,
        DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS createdAt
       FROM dealer_applications
       ORDER BY FIELD(status, 'pending', 'approved', 'rejected'), created_at DESC`
    );
    return rows;
  } finally {
    await connection.end();
  }
}

async function listRegionalManagers() {
  const connection = await mysql.createConnection(dbConfig);
  try {
    await ensureDealerApplicationsTable(connection);
    const [rows] = await connection.query(
      `SELECT
        dealer_code AS id,
        company_name AS name,
        contact_name AS contactName,
        phone,
        region
       FROM dealer_applications
       WHERE role = 'regional_manager' AND status = 'approved'
       ORDER BY company_name ASC, contact_name ASC`
    );
    return rows;
  } finally {
    await connection.end();
  }
}

async function reviewDealerApplication(id, status) {
  const dealerCode = requireText(id, "经销商申请ID");
  const nextStatus = requireText(status, "审核状态");
  if (!["approved", "rejected", "pending"].includes(nextStatus)) {
    const err = new Error("审核状态不合法");
    err.statusCode = 400;
    throw err;
  }

  const connection = await mysql.createConnection(dbConfig);
  try {
    await ensureDealerApplicationsTable(connection);
    const [result] = await connection.query(
      "UPDATE dealer_applications SET status = ? WHERE dealer_code = ?",
      [nextStatus, dealerCode]
    );
    if (result.affectedRows === 0) {
      const err = new Error("未找到经销商申请");
      err.statusCode = 404;
      throw err;
    }
  } finally {
    await connection.end();
  }

  return { success: true };
}

async function deleteDealerApplication(id) {
  const dealerCode = requireText(id, "经销商申请ID");
  const connection = await mysql.createConnection(dbConfig);
  try {
    await ensureDealerApplicationsTable(connection);
    const [result] = await connection.query(
      "DELETE FROM dealer_applications WHERE dealer_code = ?",
      [dealerCode]
    );
    if (!result.affectedRows) {
      const err = new Error("未找到经销商账号");
      err.statusCode = 404;
      throw err;
    }
  } finally {
    await connection.end();
  }
  return { success: true };
}

async function updateDealerApplicationPassword(id, password) {
  const dealerCode = requireText(id, "经销商申请ID");
  const nextPassword = hashPassword(requireText(password, "新密码"));
  const connection = await mysql.createConnection(dbConfig);
  try {
    await ensureDealerApplicationsTable(connection);
    const [result] = await connection.query(
      "UPDATE dealer_applications SET password = ? WHERE dealer_code = ?",
      [nextPassword, dealerCode]
    );
    if (!result.affectedRows) {
      const err = new Error("未找到经销商账号");
      err.statusCode = 404;
      throw err;
    }
  } finally {
    await connection.end();
  }
  return { success: true };
}

async function assertDealerAccountActive(dealerId) {
  const dealerCode = requireText(dealerId, "经销商ID");
  const connection = await mysql.createConnection(dbConfig);
  try {
    await ensureDealerApplicationsTable(connection);
    const [rows] = await connection.query(
      "SELECT status FROM dealer_applications WHERE dealer_code = ? LIMIT 1",
      [dealerCode]
    );
    if (!rows.length) {
      const err = new Error("账号不存在，请重新登录");
      err.statusCode = 401;
      throw err;
    }
    if (rows[0].status !== "approved") {
      const err = new Error("账号未审核通过或已停用，请重新登录");
      err.statusCode = 403;
      throw err;
    }
  } finally {
    await connection.end();
  }
}

async function resolveRegionalManagerContactName(value) {
  const name = normalize(value);
  if (!name) {
    return "";
  }
  const connection = await mysql.createConnection(dbConfig);
  try {
    await ensureDealerApplicationsTable(connection);
    const [rows] = await connection.query(
      `SELECT contact_name AS contactName
       FROM dealer_applications
       WHERE role = 'regional_manager'
         AND status = 'approved'
         AND (company_name = ? OR contact_name = ? OR dealer_code = ? OR phone = ?)
       ORDER BY updated_at DESC
       LIMIT 1`,
      [name, name, name, name]
    );
    return rows.length ? normalize(rows[0].contactName) : name;
  } finally {
    await connection.end();
  }
}

async function createDealerOrder(payload) {
  const dealer = payload.dealer || {};
  const dealerId = requireText(dealer.id || payload.dealerId, "经销商ID");
  await assertDealerAccountActive(dealerId);
  const dealerName = requireText(dealer.name || payload.dealerName, "经销商名称");
  const dealerRole = normalize(dealer.role || payload.dealerRole);
  const rawRegionalManagerName = requireText(
    dealer.regionalManagerName || payload.regionalManagerName || (dealerRole === "regional_manager" ? (dealer.contactName || dealerName) : ""),
    "所属大区经理"
  );
  const regionalManagerName = dealerRole === "regional_manager"
    ? normalize(dealer.contactName || rawRegionalManagerName)
    : await resolveRegionalManagerContactName(rawRegionalManagerName);
  const rawItems = Array.isArray(payload.items) && payload.items.length ? payload.items : [payload];
  const merged = new Map();

  for (const rawItem of rawItems) {
    const model = requireText(rawItem.model, "机型");
    const inventoryType = normalize(rawItem.inventoryType);
    const batchNo = normalize(rawItem.batchNo) || "";
    const eta = normalize(rawItem.eta);
    const remark = normalize(rawItem.remark);
    const demandType = normalize(rawItem.demandType || (!batchNo && inventoryType === "heightened" ? "heightened" : ""));
    const quantity = Math.max(1, Math.trunc(Number(rawItem.quantity || 1)));
    const key = batchNo ? reservationKey({ inventoryType, batchNo, model }) : `demand|${demandType || "standard"}|${model}`;
    if (!merged.has(key)) {
      merged.set(key, { model, batchNo, eta, inventoryType: demandType || inventoryType, quantity: 0, available: Number(rawItem.available || 0), remarks: [] });
    }
    const item = merged.get(key);
    item.quantity += quantity;
    if (remark && item.remarks.indexOf(remark) === -1) {
      item.remarks.push(remark);
    }
  }

  const items = Array.from(merged.values()).map(item => Object.assign({}, item, {
    remark: item.remarks.join("；")
  }));
  if (!items.length) {
    const err = new Error("购物车为空");
    err.statusCode = 400;
    throw err;
  }

  const batchItems = items.filter(item => item.batchNo);
  const allItemsHaveBatch = items.every(item => normalize(item.batchNo));
  if (batchItems.length) {
    const availableRows = await aggregateAvailabilityRows();
    const availableMap = new Map(availableRows.map(row => [reservationKey(row), Number(row.available || 0)]));
    for (const item of batchItems) {
      const normalizedItem = Object.assign({}, item, {
        batchNo: item.batchNo || (item.inventoryType === "finished" ? "FINISHED-STOCK" : "")
      });
      const available = availableMap.get(reservationKey(normalizedItem)) || 0;
      if (item.quantity > available) {
        const err = new Error(`${item.model} 可用数量不足，当前可用 ${available}，购物车数量 ${item.quantity}`);
        err.statusCode = 400;
        throw err;
      }
    }
  }

  const order = {
    orderNo: makeOrderNo(),
    dealerId,
    dealerName,
    dealerPhone: normalize(dealer.phone || payload.dealerPhone),
    regionalManagerName,
    customerName: requireText(payload.customerName, "客户名称"),
    contactName: requireText(payload.contactName, "联系人"),
    contactPhone: requireText(payload.contactPhone, "联系电话"),
    deliveryDate: normalize(payload.deliveryDate),
    remark: normalize(payload.remark),
  };

  const connection = await mysql.createConnection(dbConfig);
  try {
    await ensureDealerOrdersTable(connection);
    await ensureSupportSchema(connection);
    await connection.beginTransaction();
    const initialStatus = allItemsHaveBatch ? "pending" : "regional_pending";
    const regionalReviewStatus = allItemsHaveBatch ? "approved" : "pending";
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      await connection.query(
        `INSERT INTO dealer_orders
         (order_no, line_no, dealer_id, dealer_name, dealer_phone, regional_manager_name, customer_name, contact_name, contact_phone,
          model, batch_no, eta, inventory_type, quantity, approved_qty, allocated_qty, delivery_date, remark, status, regional_review_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`,
        [
          order.orderNo,
          index + 1,
          order.dealerId,
          order.dealerName,
          order.dealerPhone,
          order.regionalManagerName,
          order.customerName,
          order.contactName,
          order.contactPhone,
          item.model,
          item.batchNo,
          item.eta,
          item.inventoryType,
          item.quantity,
          order.deliveryDate,
          item.remark || order.remark,
          initialStatus,
          regionalReviewStatus
        ]
      );
    }
    await createDealerOrderSyncEvent(connection, order.orderNo, "dealer_order.created", {
      orderNo: order.orderNo,
      status: allItemsHaveBatch ? "pending" : "regional_pending",
      itemCount: items.length
    });
    await connection.commit();
  } catch (err) {
    try { await connection.rollback(); } catch (rollbackErr) {}
    throw err;
  } finally {
    await connection.end();
  }

  return {
    id: order.orderNo,
    status: allItemsHaveBatch ? "pending" : "regional_pending",
    itemCount: items.length,
    message: allItemsHaveBatch ? "订单已提交，已进入工厂审核" : "订单已提交，等待大区经理初审",
  };
}

async function listDealerOrders(filters = {}) {
  const connection = await mysql.createConnection(dbConfig);
  try {
    await ensureDealerOrdersTable(connection);
    const where = [];
    const params = [];
    if (filters.dealerId && filters.regionalManagerName) {
      where.push("(dealer_id = ? OR regional_manager_name = ?)");
      params.push(filters.dealerId, filters.regionalManagerName);
    } else if (filters.dealerId) {
      where.push("dealer_id = ?");
      params.push(filters.dealerId);
    } else if (filters.regionalManagerName) {
      where.push("regional_manager_name = ?");
      params.push(filters.regionalManagerName);
    }
    const keyword = normalize(filters.keyword).toLowerCase();
    const statusFilter = normalize(filters.status).toLowerCase();
    const page = Math.max(1, Math.trunc(Number(filters.page || 1)));
    const pageSize = Math.min(200, Math.max(1, Math.trunc(Number(filters.pageSize || filters.page_size || 200))));
    const usePaging = Boolean(filters.page || filters.pageSize || filters.page_size || keyword || statusFilter);
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const [rows] = await connection.query(
      `SELECT
        order_no AS id,
        line_no AS lineNo,
        dealer_id AS dealerId,
        dealer_name AS dealerName,
        regional_manager_name AS regionalManagerName,
        customer_name AS customerName,
        contact_name AS contactName,
        contact_phone AS contactPhone,
        model,
        batch_no AS batchNo,
        eta,
        inventory_type AS inventoryType,
        quantity,
        allocated_qty AS allocatedQty,
        extra_remark AS extraRemark,
        ERMQ,
        factory_pending AS factoryPending,
        delivery_date AS deliveryDate,
        remark,
        status,
        regional_review_status AS regionalReviewStatus,
        regional_review_note AS regionalReviewNote,
        regional_reviewed_by AS regionalReviewedBy,
        DATE_FORMAT(regional_reviewed_at, '%Y-%m-%d %H:%i:%s') AS regionalReviewedAt,
        contract_no AS contractNo,
        v7_order_no AS v7OrderNo,
        sync_status AS syncStatus,
        sync_error AS syncError,
        source,
        DATE_FORMAT(last_synced_at, '%Y-%m-%d %H:%i:%s') AS lastSyncedAt,
        DATE_FORMAT(factory_reviewed_at, '%Y-%m-%d %H:%i:%s') AS factoryReviewedAt,
        factory_reviewed_by AS factoryReviewedBy,
        DATE_FORMAT(extra_remark_reviewed_at, '%Y-%m-%d %H:%i:%s') AS extraRemarkReviewedAt,
        extra_remark_reviewed_by AS extraRemarkReviewedBy,
        DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS createdAt
       FROM dealer_orders
       ${whereSql}
       ORDER BY created_at DESC, order_no DESC, line_no ASC`,
      params
    );

    const grouped = new Map();
    for (const row of rows) {
      if (!grouped.has(row.id)) {
        grouped.set(row.id, Object.assign({}, row, { items: [], quantity: 0 }));
      }
      const order = grouped.get(row.id);
      order.items.push(row);
      order.quantity += Number(row.quantity || 0);
    }

    let orders = Array.from(grouped.values()).map(order => {
      const allStatuses = order.items.map(item => normalize(item.status).toLowerCase()).filter(Boolean);
      const reviewStatuses = order.items.map(item => normalize(item.regionalReviewStatus).toLowerCase()).filter(Boolean);
      const anyRejected = allStatuses.some(isRejectedStatus) || reviewStatuses.some(isRejectedStatus);
      const rejectedStatus = allStatuses.includes("regional_rejected") || reviewStatuses.some(isRejectedStatus)
        ? "regional_rejected"
        : "rejected";
      const statusItems = order.items.filter(item => Number(item.quantity || 0) > 0);
      const effectiveItems = statusItems.length ? statusItems : order.items;
      const statuses = effectiveItems.map(item => normalize(item.status).toLowerCase());
      const isCompletedStatus = status => status === "completed" || status === "complete";
      const allCompleted = statuses.length > 0 && statuses.every(isCompletedStatus);
      const anyCompleted = statuses.some(isCompletedStatus);
      const allAllocated = statuses.every(status => status === "allocated");
      const anyAllocated = effectiveItems.some(item => normalize(item.status).toLowerCase() === "allocated" || Number(item.allocatedQty || 0) > 0);
      const anyApproved = statuses.includes("approved");
      const anyFactoryPending = effectiveItems.some(item => Number(item.factoryPending || 0) === 1);
      const status = anyRejected
        ? rejectedStatus
        : allCompleted
          ? "completed"
          : anyCompleted
            ? "partial_allocated"
            : allAllocated
              ? "allocated"
              : anyAllocated
                ? "partial_allocated"
                : anyApproved
                  ? "approved"
                  : statuses[0];
      return Object.assign({}, order, {
        status,
        factoryPending: allCompleted ? 0 : (anyFactoryPending ? 1 : 0),
        itemCount: order.items.length,
        model: order.items.map(item => `${item.model}x${item.quantity}`).join(" / "),
        batchNo: Array.from(new Set(order.items.map(item => item.batchNo || "-"))).join(" / ")
      });
    });
    if (keyword) {
      orders = orders.filter(order => {
        const haystack = [
          order.id, order.customerName, order.contactName, order.contactPhone, order.dealerName,
          order.regionalManagerName, order.remark, order.regionalReviewNote, order.model, order.batchNo
        ].concat((order.items || []).flatMap(item => [
          item.model, item.batchNo, item.eta, item.inventoryType, item.remark, item.extraRemark
        ])).map(normalize).join(" ").toLowerCase();
        return haystack.includes(keyword);
      });
    }
    if (statusFilter) {
      orders = orders.filter(order => {
        if (statusFilter === "factory_pending") {
          return Number(order.factoryPending || 0) === 1 && !isCompletedOrderStatus(order.status);
        }
        return normalize(order.status).toLowerCase() === statusFilter;
      });
    }
    if (usePaging) {
      return {
        data: orders.slice((page - 1) * pageSize, page * pageSize),
        total: orders.length,
        page,
        pageSize
      };
    }
    return orders;
  } finally {
    await connection.end();
  }
}

function isRejectedStatus(status) {
  const value = normalize(status).toLowerCase();
  return value === "rejected" || value === "reject" || value.endsWith("_rejected") || value.endsWith("_reject");
}

function isCompletedOrderStatus(status) {
  const value = normalize(status).toLowerCase();
  return value === "complete" || value === "completed";
}

async function updateDealerOrderExtraRemarks(orderNo, payload, account = null) {
  const orderId = requireText(orderNo, "订单号");
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  if (!rawItems.length) {
    const err = new Error("请至少提交一条附加备注");
    err.statusCode = 400;
    throw err;
  }

  const connection = await mysql.createConnection(dbConfig);
  try {
    await ensureDealerOrdersTable(connection);
    await ensureSupportSchema(connection);
    await connection.beginTransaction();

    const [rows] = await connection.query(
      "SELECT line_no, dealer_id, regional_manager_name, quantity, status, extra_remark, ERMQ, factory_pending FROM dealer_orders WHERE order_no = ? ORDER BY line_no ASC FOR UPDATE",
      [orderId]
    );
    if (!rows.length) {
      const err = new Error("订单不存在");
      err.statusCode = 404;
      throw err;
    }
    if (account && account.role !== "admin") {
      const allowed = rows.some(row => {
        if (account.role === "regional_manager") {
          return normalize(row.regional_manager_name) === normalize(account.contactName || account.name) || normalize(row.dealer_id) === normalize(account.id);
        }
        return normalize(row.dealer_id) === normalize(account.id);
      });
      if (!allowed) {
        const err = new Error("无权修改该订单");
        err.statusCode = 403;
        throw err;
      }
    }
    const statuses = rows.map(row => normalize(row.status).toLowerCase());
    if (statuses.length && statuses.every(isCompletedOrderStatus)) {
      const err = new Error("已完成订单不能修改附加备注");
      err.statusCode = 400;
      throw err;
    }

    const rowsByLine = new Map(rows.map(row => [Number(row.line_no), row]));
    let changed = false;
    for (const rawItem of rawItems) {
      const lineNo = Number(rawItem.lineNo);
      const row = rowsByLine.get(lineNo);
      if (!row) {
        const err = new Error(`订单行不存在: ${lineNo}`);
        err.statusCode = 400;
        throw err;
      }
      const quantity = Math.max(0, Math.trunc(Number(row.quantity || 0)));
      const extraRemark = normalize(rawItem.extraRemark);
      let ermq = Math.max(0, Math.trunc(Number(rawItem.ERMQ || rawItem.ermq || 0)));
      if (extraRemark && ermq === 0) {
        ermq = quantity;
      }
      if (ermq > quantity) {
        ermq = quantity;
      }
      if (extraRemark !== normalize(row.extra_remark) || ermq !== Number(row.ERMQ || 0)) {
        changed = true;
      }
      await connection.query(
        "UPDATE dealer_orders SET extra_remark = ?, ERMQ = ? WHERE order_no = ? AND line_no = ?",
        [extraRemark, ermq, orderId, lineNo]
      );
    }

    await connection.query(
      "UPDATE dealer_orders SET factory_pending = 1 WHERE order_no = ?",
      [orderId]
    );
    await createDealerOrderSyncEvent(connection, orderId, "dealer_order.extra_remark.updated", {
      orderNo: orderId,
      items: rawItems
    });

    await connection.commit();
    return {
      id: orderId,
      factoryPending: 1,
      message: "附加备注已保存"
    };
  } catch (err) {
    try { await connection.rollback(); } catch (rollbackErr) {}
    throw err;
  } finally {
    await connection.end();
  }
}

async function reviewDealerOrderByRegionalManager(orderNo, payload) {
  const nextStatus = normalize(payload.status);
  if (!["approved", "rejected"].includes(nextStatus)) {
    const err = new Error("审核状态只能是 approved 或 rejected");
    err.statusCode = 400;
    throw err;
  }
  if (nextStatus === "approved") {
    const err = new Error("请先分配具体批次，再提交工厂审核");
    err.statusCode = 400;
    throw err;
  }

  const regionalManagerName = normalize(payload.regionalManagerName);
  const reviewerName = normalize(payload.reviewerName || payload.reviewedBy || regionalManagerName);
  const note = normalize(payload.note || payload.regionalReviewNote || "");
  const orderId = requireText(orderNo, "订单号");
  const finalStatus = nextStatus === "approved" ? "pending" : "regional_rejected";

  const connection = await mysql.createConnection(dbConfig);
  try {
    await ensureDealerOrdersTable(connection);
    await ensureSupportSchema(connection);
    const where = ["order_no = ?", "status = 'regional_pending'"];
    const params = [orderId];
    if (regionalManagerName) {
      where.push("regional_manager_name = ?");
      params.push(regionalManagerName);
    }
    const [result] = await connection.query(
      `UPDATE dealer_orders
       SET status = ?,
           regional_review_status = ?,
           regional_review_note = ?,
           regional_reviewed_by = ?,
           regional_reviewed_at = NOW()
       WHERE ${where.join(" AND ")}`,
      [finalStatus, nextStatus, note, reviewerName].concat(params)
    );
    if (!result.affectedRows) {
      const err = new Error("订单不存在、已审核，或不属于当前大区经理");
      err.statusCode = 404;
      throw err;
    }
    await createDealerOrderSyncEvent(connection, orderId, nextStatus === "approved" ? "dealer_order.regional_approved" : "dealer_order.regional_rejected", {
      orderNo: orderId,
      status: finalStatus,
      reviewedBy: reviewerName,
      note
    });
    return {
      id: orderId,
      status: finalStatus,
      regionalReviewStatus: nextStatus,
      message: nextStatus === "approved" ? "初审通过，已进入工厂审核" : "订单已驳回"
    };
  } finally {
    await connection.end();
  }
}

async function allocateDealerOrderByRegionalManager(orderNo, payload) {
  const orderId = requireText(orderNo, "订单号");
  const regionalManagerName = normalize(payload.regionalManagerName);
  const reviewerName = normalize(payload.reviewerName || payload.reviewedBy || regionalManagerName);
  const note = normalize(payload.note || payload.regionalReviewNote || "");
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  if (!rawItems.length) {
    const err = new Error("请至少分配一个批次");
    err.statusCode = 400;
    throw err;
  }

  const connection = await mysql.createConnection(dbConfig);
  try {
    await ensureDealerOrdersTable(connection);
    await ensureSupportSchema(connection);
    await connection.beginTransaction();

    const where = ["order_no = ?", "status = 'regional_pending'"];
    const params = [orderId];
    if (regionalManagerName) {
      where.push("regional_manager_name = ?");
      params.push(regionalManagerName);
    }
    const [rows] = await connection.query(
      `SELECT *
       FROM dealer_orders
       WHERE ${where.join(" AND ")}
       ORDER BY line_no ASC
       FOR UPDATE`,
      params
    );
    if (!rows.length) {
      const err = new Error("订单不存在、已分配，或不属于当前大区经理");
      err.statusCode = 404;
      throw err;
    }

    const demandByType = new Map();
    const demandMeta = new Map();
    for (const row of rows) {
      const model = baseModelName(row.model);
      const inventoryType = normalize(row.inventory_type);
      const key = demandTypeKey(row.model, inventoryType, { allowModelMark: true });
      demandByType.set(key, (demandByType.get(key) || 0) + Number(row.quantity || 0));
      if (!demandMeta.has(key)) {
        demandMeta.set(key, { model, inventoryType: key.endsWith("|heightened") ? "heightened" : inventoryType });
      }
    }

    const allocations = [];
    for (const rawLine of rawItems) {
      const model = baseModelName(requireText(rawLine.model, "机型"));
      const lineAllocations = Array.isArray(rawLine.allocations) ? rawLine.allocations : [rawLine];
      for (const rawAllocation of lineAllocations) {
        const quantity = Math.max(0, Math.trunc(Number(rawAllocation.quantity || 0)));
        if (!quantity) continue;
        const inventoryType = requireText(rawAllocation.inventoryType, "库存类型");
        const batchNo = normalize(rawAllocation.batchNo) || (inventoryType === "finished" ? "FINISHED-STOCK" : "");
        allocations.push({
          model,
          batchNo: requireText(batchNo, "批次号"),
          eta: normalize(rawAllocation.eta),
          inventoryType,
          quantity,
          demandTypeKey: demandTypeKey(model, inventoryType)
        });
      }
    }

    if (!allocations.length) {
      const err = new Error("请至少分配一个有效批次数量");
      err.statusCode = 400;
      throw err;
    }

    const allocatedByType = new Map();
    for (const allocation of allocations) {
      allocatedByType.set(allocation.demandTypeKey, (allocatedByType.get(allocation.demandTypeKey) || 0) + allocation.quantity);
    }
    for (const [key, demandQty] of demandByType.entries()) {
      const allocatedQty = allocatedByType.get(key) || 0;
      if (allocatedQty !== demandQty) {
        const err = new Error(`${demandTypeLabel(demandMeta.get(key))} 分配数量必须等于需求数量 ${demandQty}，当前分配 ${allocatedQty}`);
        err.statusCode = 400;
        throw err;
      }
    }
    for (const [key] of allocatedByType.entries()) {
      if (!demandByType.has(key)) {
        const allocation = allocations.find(item => item.demandTypeKey === key);
        const err = new Error(`${demandTypeLabel(allocation)} 不在当前订单需求中`);
        err.statusCode = 400;
        throw err;
      }
    }

    const requestedByBatch = new Map();
    for (const allocation of allocations) {
      const key = reservationKey(allocation);
      requestedByBatch.set(key, (requestedByBatch.get(key) || 0) + allocation.quantity);
    }
    const availableRows = await aggregateAvailabilityRows();
    const availableMap = new Map(availableRows.map(row => [reservationKey(row), Number(row.available || 0)]));
    for (const [key, quantity] of requestedByBatch.entries()) {
      const available = availableMap.get(key) || 0;
      if (quantity > available) {
        const err = new Error(`批次可用数量不足，当前可用 ${available}，分配 ${quantity}`);
        err.statusCode = 400;
        throw err;
      }
    }

    const header = rows[0];
    await connection.query("DELETE FROM dealer_orders WHERE order_no = ? AND status = 'regional_pending'", [orderId]);
    for (let index = 0; index < allocations.length; index += 1) {
      const item = allocations[index];
      await connection.query(
        `INSERT INTO dealer_orders
         (order_no, line_no, dealer_id, dealer_name, dealer_phone, regional_manager_name, customer_name, contact_name, contact_phone,
          model, batch_no, eta, inventory_type, quantity, approved_qty, allocated_qty, delivery_date, remark, status,
          regional_review_status, regional_review_note, regional_reviewed_by, regional_reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 'pending',
          'approved', ?, ?, NOW())`,
        [
          orderId,
          index + 1,
          header.dealer_id,
          header.dealer_name,
          header.dealer_phone,
          header.regional_manager_name,
          header.customer_name,
          header.contact_name,
          header.contact_phone,
          item.model,
          item.batchNo,
          item.eta,
          item.inventoryType,
          item.quantity,
          header.delivery_date,
          header.remark,
          note,
          reviewerName
        ]
      );
    }

    await createDealerOrderSyncEvent(connection, orderId, "dealer_order.regional_allocated", {
      orderNo: orderId,
      itemCount: allocations.length
    });
    await connection.commit();
    return {
      id: orderId,
      status: "pending",
      itemCount: allocations.length,
      message: "批次已分配，订单已进入工厂审核"
    };
  } catch (err) {
    try { await connection.rollback(); } catch (rollbackErr) {}
    throw err;
  } finally {
    await connection.end();
  }
}

function reservationKey(row) {
  if (row.heightened || row.inventoryType === "heightened") {
    return [
      "heightened",
      heightenedReservationBatchNo(row),
      heightenedReservationEta(row),
      baseModelName(row.model)
    ].join("|");
  }
  if (row.inventoryType === "finished") {
    return ["finished", "FINISHED-STOCK", row.model].join("|");
  }
  return [row.inventoryType, row.batchNo, row.model].join("|");
}

async function getActiveOrderHoldMap() {
  const connection = await mysql.createConnection(dbConfig);
  try {
    await ensureDealerOrdersTable(connection);
    const [rows] = await connection.query(
      `SELECT
        model,
        batch_no AS batchNo,
        eta,
        inventory_type AS inventoryType,
        SUM(quantity) AS qty
       FROM dealer_orders
       WHERE LOWER(status) IN (?, ?, ?)
         AND batch_no <> ''
         AND quantity > 0
       GROUP BY model, batch_no, eta, inventory_type`,
      ORDER_HOLD_STATUSES
    );
    const map = new Map();
    for (const row of rows) {
      const normalizedRow = {
        model: normalize(row.model),
        batchNo: normalize(row.batchNo),
        eta: normalize(row.eta),
        inventoryType: normalize(row.inventoryType),
      };
      const key = reservationKey(normalizedRow);
      map.set(key, (map.get(key) || 0) + Number(row.qty || 0));
    }
    return map;
  } finally {
    await connection.end();
  }
}
async function mapRows() {
  const { rows, columns } = await loadRows();
  const modelCol = pickColumn(columns, "model") || "model";
  const quantityCol = pickColumn(columns, "quantity") || "quantity";
  const batchCol = pickColumn(columns, "batchNo") || "batch_no";
  const etaCol = pickColumn(columns, "eta") || "expected_inbound_time";
  const heightenedCol = pickColumn(columns, "heightened");
  const originalBatchCol = pickColumn(columns, "originalBatchNo");
  const originalEtaCol = pickColumn(columns, "originalEta");

  for (const requiredCol of [modelCol, quantityCol, batchCol]) {
    if (!columns.includes(requiredCol)) {
      const err = new Error(`无法读取微信汇总表字段: ${requiredCol}。当前字段: ${columns.join(", ")}`);
      err.statusCode = 500;
      throw err;
    }
  }

  return rows
    .map(row => {
      const rawModel = normalize(row[modelCol]);
      const rawBatchNo = normalize(row[batchCol]);
      const heightened = (heightenedCol ? isHeightenedValue(row[heightenedCol]) : false) || rawBatchNo === "加高";
      const model = rawModel;
      const batchNo = heightened ? "加高" : rawBatchNo;
      const eta = etaCol && columns.includes(etaCol) ? normalize(row[etaCol]) : "";
      const originalBatchNo = originalBatchCol ? normalize(row[originalBatchCol]) : "";
      const originalEta = originalEtaCol ? normalize(row[originalEtaCol]) : "";
      const isStock = isStockBatch(batchNo);
      return {
        model,
        available: quantityValue(row, quantityCol),
        batchNo: isStock ? "FINISHED-STOCK" : (batchNo || "UNKNOWN-BATCH"),
        eta: isStock ? "现货" : (eta || "未排期"),
        inventoryType: heightened ? "heightened" : (isStock ? "finished" : "wip"),
        heightened,
        originalBatchNo,
        originalEta
      };
    })
    .filter(row => row.model && row.batchNo && row.available > 0);
}

async function aggregateAvailabilityRows() {
  const rawRows = await mapRows();
  const reservationMap = await getActiveOrderHoldMap();
  const grouped = new Map();

  for (const row of rawRows) {
    const key = reservationKey(row);
    if (!grouped.has(key)) {
      grouped.set(key, Object.assign({}, row, { available: 0 }));
    }
    grouped.get(key).available += row.available;
  }

  for (const [key, reservedQty] of reservationMap.entries()) {
    const row = grouped.get(key);
    if (!row) {
      continue;
    }
    row.available = Math.max(0, Number(row.available || 0) - Number(reservedQty || 0));
  }

  return Array.from(grouped.values()).filter(row => row.available > 0);
}

async function loadModelSortMap() {
  const connection = await mysql.createConnection(dbConfig);
  try {
    const [rows] = await connection.query(
      `SELECT model_name AS model, sort_order AS sortOrder
       FROM model_dictionary
       WHERE enabled = 1
       ORDER BY sort_order ASC, model_name ASC`
    );
    const map = new Map();
    rows.forEach((row, index) => {
      const model = normalize(row.model);
      if (model && !map.has(model)) {
        const sortOrder = row.sortOrder === null || row.sortOrder === undefined ? index : Number(row.sortOrder);
        map.set(model, Number.isFinite(sortOrder) ? sortOrder : index);
      }
    });
    return map;
  } catch (err) {
    return new Map();
  } finally {
    await connection.end();
  }
}

function baseModelName(model) {
  return normalize(model).replace(/\(加高\)|（加高）/g, "");
}

function hasHeightenedModelMark(model) {
  const value = normalize(model);
  return value.indexOf("(加高)") !== -1 || value.indexOf("（加高）") !== -1;
}

function heightenedReservationBatchNo(row) {
  return normalize(row && (row.originalBatchNo || row.batchNo));
}

function heightenedReservationEta(row) {
  const originalEta = normalize(row && row.originalEta);
  if (originalEta) return originalEta;
  const batchNo = heightenedReservationBatchNo(row);
  if (isStockBatch(batchNo)) return "现货";
  return normalize(row && row.eta);
}

function allocationDemandType(inventoryType) {
  return normalize(inventoryType) === "heightened" ? "heightened" : "standard";
}

function demandTypeKey(model, inventoryType, options = {}) {
  const type = allocationDemandType(inventoryType) === "heightened" || (options.allowModelMark && hasHeightenedModelMark(model))
    ? "heightened"
    : "standard";
  return [baseModelName(model), type].join("|");
}

function demandTypeLabel(item) {
  const model = baseModelName(item && item.model);
  return allocationDemandType(item && item.inventoryType) === "heightened" ? `${model}（加高）` : model;
}

function modelSortValue(model, sortMap) {
  const name = normalize(model);
  if (sortMap.has(name)) return sortMap.get(name);
  const baseName = baseModelName(name);
  if (sortMap.has(baseName)) return sortMap.get(baseName);
  return Number.MAX_SAFE_INTEGER;
}

function compareModels(a, b, sortMap) {
  const modelA = typeof a === "string" ? a : a.model;
  const modelB = typeof b === "string" ? b : b.model;
  const sortA = modelSortValue(modelA, sortMap);
  const sortB = modelSortValue(modelB, sortMap);
  if (sortA !== sortB) return sortA - sortB;
  return normalize(modelA).localeCompare(normalize(modelB), "zh-CN", { numeric: true });
}

async function availableModels() {
  const summary = new Map();
  for (const row of await aggregateAvailabilityRows()) {
    const model = row.heightened ? heightenedModelName(row.model) : row.model;
    if (!summary.has(model)) {
      summary.set(model, { model, available: 0, finished: 0, wip: 0, heightened: 0 });
    }
    const item = summary.get(model);
    const bucket = row.heightened || row.inventoryType === "heightened" ? "heightened" : row.inventoryType;
    item.available += row.available;
    item[bucket] = Number(item[bucket] || 0) + row.available;
  }
  const sortMap = await loadModelSortMap();
  return Array.from(summary.values()).sort((a, b) => compareModels(a, b, sortMap));
}

async function inboundPlans() {
  const groups = new Map();
  const sortMap = await loadModelSortMap();
  for (const row of await aggregateAvailabilityRows()) {
    const groupEta = row.heightened ? "按原批次" : (row.inventoryType === "finished" ? "现货" : row.eta);
    const groupBatchNo = row.heightened ? "加高" : (row.inventoryType === "finished" ? "FINISHED-STOCK" : row.batchNo);
    const groupInventoryType = row.heightened ? "heightened" : row.inventoryType;
    const key = `${groupInventoryType}|${groupEta}|${groupBatchNo}`;
    if (!groups.has(key)) {
      groups.set(key, {
        id: `${groupInventoryType}-${groupBatchNo}-${groupEta}`,
        inventoryType: groupInventoryType,
        title: row.heightened ? "加高" : (row.inventoryType === "finished" ? "成品现货" : `预计入库 ${groupEta}`),
        batchNo: groupBatchNo,
        eta: groupEta,
        items: new Map()
      });
    }
    const group = groups.get(key);
    const itemKey = row.heightened ? `${row.model}|${row.originalBatchNo || row.batchNo}|${row.originalEta || row.eta}` : row.model;
    if (!group.items.has(itemKey)) {
      group.items.set(itemKey, {
        model: row.model,
        available: 0,
        batchNo: row.heightened ? (row.originalBatchNo || row.batchNo) : row.batchNo,
        eta: row.heightened ? (row.originalEta || (isStockBatch(row.originalBatchNo) ? "现货" : row.eta)) : row.eta,
        heightened: row.heightened
      });
    }
    group.items.get(itemKey).available += row.available;
  }

  return Array.from(groups.values())
    .map(group => Object.assign({}, group, {
      items: Array.from(group.items.values()).sort((a, b) => compareModels(a, b, sortMap))
    }))
    .sort((a, b) => {
      if (a.inventoryType === "heightened" || b.inventoryType === "heightened") {
        return a.inventoryType === "heightened" ? -1 : 1;
      }
      if (a.inventoryType !== b.inventoryType) {
        return a.inventoryType === "finished" ? -1 : 1;
      }
      return `${a.eta}-${a.batchNo}`.localeCompare(`${b.eta}-${b.batchNo}`);
    });
}

async function listModelOptions() {
  const connection = await mysql.createConnection(dbConfig);
  try {
    try {
      const [rows] = await connection.query(
        `SELECT model_name AS model
         FROM model_dictionary
         WHERE enabled = 1
         ORDER BY sort_order ASC, model_name ASC`
      );
      const models = rows.map(row => normalize(row.model)).filter(Boolean);
      if (models.length) {
        return models;
      }
    } catch (err) {
      // Older deployments may not have model_dictionary yet; fall back to inventory models.
    }
  } finally {
    await connection.end();
  }

  const rows = await availableModels();
  const sortMap = await loadModelSortMap();
  return rows.map(row => row.model).filter(Boolean).sort((a, b) => compareModels(a, b, sortMap));
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 200, {});
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === "/api/dealer/auth/login" && req.method === "POST") {
      const payload = await readJsonBody(req);
      sendJson(res, 200, await loginDealer(payload));
      return;
    }
    if (url.pathname === "/api/dealer/auth/register" && req.method === "POST") {
      const payload = await readJsonBody(req);
      sendJson(res, 200, await createDealerApplication(payload));
      return;
    }
    if (url.pathname === "/api/dealer/admin/dealers/applications" && req.method === "GET") {
      requireAdminRequest(req);
      sendJson(res, 200, await listDealerApplications());
      return;
    }
    if (url.pathname === "/api/dealer/regional-managers" && req.method === "GET") {
      sendJson(res, 200, await listRegionalManagers());
      return;
    }
    const reviewMatch = url.pathname.match(/^\/api\/dealer\/admin\/dealers\/([^/]+)\/review$/);
    if (reviewMatch && req.method === "POST") {
      requireAdminRequest(req);
      const payload = await readJsonBody(req);
      sendJson(res, 200, await reviewDealerApplication(decodeURIComponent(reviewMatch[1]), payload.status));
      return;
    }
    const passwordMatch = url.pathname.match(/^\/api\/dealer\/admin\/dealers\/([^/]+)\/password$/);
    if (passwordMatch && req.method === "POST") {
      requireAdminRequest(req);
      const payload = await readJsonBody(req);
      sendJson(res, 200, await updateDealerApplicationPassword(decodeURIComponent(passwordMatch[1]), payload.password));
      return;
    }
    const deleteDealerMatch = url.pathname.match(/^\/api\/dealer\/admin\/dealers\/([^/]+)$/);
    if (deleteDealerMatch && req.method === "DELETE") {
      requireAdminRequest(req);
      sendJson(res, 200, await deleteDealerApplication(decodeURIComponent(deleteDealerMatch[1])));
      return;
    }
    if (url.pathname === "/api/dealer/orders" && req.method === "POST") {
      const account = await loadAccountByToken(req);
      const payload = await readJsonBody(req);
      payload.dealer = Object.assign({}, payload.dealer || {}, account);
      sendJson(res, 200, await createDealerOrder(payload));
      return;
    }
    const regionalOrderReviewMatch = url.pathname.match(/^\/api\/dealer\/orders\/([^/]+)\/regional-review$/);
    if (regionalOrderReviewMatch && req.method === "POST") {
      const account = await loadAccountByToken(req);
      if (account.role !== "regional_manager") {
        const err = new Error("无大区经理权限");
        err.statusCode = 403;
        throw err;
      }
      const payload = await readJsonBody(req);
      payload.regionalManagerName = account.contactName || account.name || "";
      payload.reviewerName = account.contactName || account.name || account.phone || "";
      sendJson(res, 200, await reviewDealerOrderByRegionalManager(decodeURIComponent(regionalOrderReviewMatch[1]), payload));
      return;
    }
    const regionalOrderAllocateMatch = url.pathname.match(/^\/api\/dealer\/orders\/([^/]+)\/regional-allocate$/);
    if (regionalOrderAllocateMatch && req.method === "POST") {
      const account = await loadAccountByToken(req);
      if (account.role !== "regional_manager") {
        const err = new Error("无大区经理权限");
        err.statusCode = 403;
        throw err;
      }
      const payload = await readJsonBody(req);
      payload.regionalManagerName = account.contactName || account.name || "";
      payload.reviewerName = account.contactName || account.name || account.phone || "";
      sendJson(res, 200, await allocateDealerOrderByRegionalManager(decodeURIComponent(regionalOrderAllocateMatch[1]), payload));
      return;
    }
    const extraRemarkMatch = url.pathname.match(/^\/api\/dealer\/orders\/([^/]+)\/extra-remarks$/);
    if (extraRemarkMatch && req.method === "POST") {
      const account = await loadAccountByToken(req);
      const payload = await readJsonBody(req);
      sendJson(res, 200, await updateDealerOrderExtraRemarks(decodeURIComponent(extraRemarkMatch[1]), payload, account));
      return;
    }
    if (url.pathname === "/api/dealer/orders" && req.method === "GET") {
      const account = await loadAccountByToken(req);
      const orderFilters = {
        status: url.searchParams.get("status"),
        keyword: url.searchParams.get("keyword"),
        page: url.searchParams.get("page"),
        pageSize: url.searchParams.get("pageSize")
      };
      if (account.role === "regional_manager") {
        orderFilters.dealerId = account.id;
        orderFilters.regionalManagerName = account.contactName || account.name || "";
      } else if (account.role !== "admin") {
        orderFilters.dealerId = account.id;
      }
      sendJson(res, 200, await listDealerOrders({
        dealerId: orderFilters.dealerId,
        regionalManagerName: orderFilters.regionalManagerName,
        status: orderFilters.status,
        keyword: orderFilters.keyword,
        page: orderFilters.page,
        pageSize: orderFilters.pageSize
      }));
      return;
    }
    if (url.pathname === "/api/dealer/health") {
      sendJson(res, 200, { status: "ok", database: dbConfig.database, table: TABLE_NAME });
      return;
    }
    if (url.pathname === "/api/dealer/debug/columns") {
      sendJson(res, 200, await loadColumns());
      return;
    }
    if (url.pathname === "/api/dealer/inventory/available-models") {
      sendJson(res, 200, await availableModels());
      return;
    }
    if (url.pathname === "/api/dealer/inventory/inbound-plans") {
      sendJson(res, 200, await inboundPlans());
      return;
    }
    if (url.pathname === "/api/dealer/models") {
      sendJson(res, 200, await listModelOptions());
      return;
    }
    sendJson(res, 404, { message: "Not Found" });
  } catch (err) {
    sendJson(res, err.statusCode || 500, { message: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Dealer API listening on http://127.0.0.1:${PORT}`);
});






