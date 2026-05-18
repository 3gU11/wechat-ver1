const http = require("http");
const { URL } = require("url");
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

loadEnvFile();

const PORT = Number(process.env.PORT || 8001);
const TABLE_NAME = process.env.FINISHED_GOODS_TABLE || "finished_goods_data";

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
  model: ["model", "machine_model", "product_model", "goods_model", "equipment_model", "型号", "机型", "产品型号"],
  quantity: ["available", "available_qty", "available_quantity", "qty", "quantity", "count", "stock", "库存", "数量", "可订数量"],
  batchNo: ["batch_no", "batch", "batch_number", "production_batch", "lot_no", "批次号", "批次", "生产批次"],
  eta: ["eta", "expected_inbound_time", "expected_inbound_date", "estimated_storage_time", "inbound_date", "入库时间", "预计入库时间", "预计入库日期"],
  status: ["status", "state", "inventory_status", "lifecycle_status", "状态"],
  bound: ["bound", "is_bound", "bind_status", "binding_status", "订单绑定状态", "绑定状态", "已绑定"],
  heightened: ["加高", "heightened", "is_heightened", "isHeightened"],
  originalBatchNo: ["原批次号", "original_batch_no", "source_batch_no"],
  originalEta: ["原预计入库时间", "original_expected_inbound_time", "source_expected_inbound_time"]
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
    ["role", "ALTER TABLE dealer_applications ADD COLUMN role VARCHAR(32) NOT NULL DEFAULT 'dealer' AFTER region"],
    ["regional_manager_name", "ALTER TABLE dealer_applications ADD COLUMN regional_manager_name VARCHAR(128) DEFAULT '' AFTER role"]
  ];
  for (const [columnName, sql] of additions) {
    if (!columnNames.has(columnName)) {
      await connection.query(sql);
    }
  }

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

async function createDealerApplication(payload) {
  const companyName = requireText(payload.companyName, "经销商公司");
  const phone = requireText(payload.phone, "手机号");
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
        (dealer_code, company_name, phone, contact_name, region, role, regional_manager_name, remark, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [dealerCode, companyName, phone, contactName, region, role, regionalManagerName, remark]
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
  const password = requireText(payload.password, "验证码/密码");

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

  if (password !== "123456") {
    const err = new Error("验证码错误");
    err.statusCode = 401;
    throw err;
  }

  const connection = await mysql.createConnection(dbConfig);
  try {
    await ensureDealerApplicationsTable(connection);
    const [rows] = await connection.query(
      `SELECT
        dealer_code AS id,
        company_name AS name,
        phone,
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

async function createDealerOrder(payload) {
  const dealer = payload.dealer || {};
  const dealerId = requireText(dealer.id || payload.dealerId, "经销商ID");
  const dealerName = requireText(dealer.name || payload.dealerName, "经销商名称");
  const dealerRole = normalize(dealer.role || payload.dealerRole);
  const regionalManagerName = requireText(
    dealer.regionalManagerName || payload.regionalManagerName || (dealerRole === "regional_manager" ? dealerName : ""),
    "所属大区经理"
  );
  const rawItems = Array.isArray(payload.items) && payload.items.length ? payload.items : [payload];
  const merged = new Map();

  for (const rawItem of rawItems) {
    const model = requireText(rawItem.model, "机型");
    const inventoryType = normalize(rawItem.inventoryType);
    const batchNo = normalize(rawItem.batchNo) || (inventoryType === "finished" ? "FINISHED-STOCK" : "");
    const eta = normalize(rawItem.eta);
    const quantity = Math.max(1, Math.trunc(Number(rawItem.quantity || 1)));
    const key = reservationKey({ inventoryType, batchNo, model });
    if (!merged.has(key)) {
      merged.set(key, { model, batchNo, eta, inventoryType, quantity: 0, available: Number(rawItem.available || 0) });
    }
    merged.get(key).quantity += quantity;
  }

  const items = Array.from(merged.values());
  if (!items.length) {
    const err = new Error("购物车为空");
    err.statusCode = 400;
    throw err;
  }

  const availableRows = await aggregateAvailabilityRows();
  const availableMap = new Map(availableRows.map(row => [reservationKey(row), Number(row.available || 0)]));
  for (const item of items) {
    const available = availableMap.get(reservationKey(item)) || 0;
    if (item.quantity > available) {
      const err = new Error(`${item.model} 可用数量不足，当前可用 ${available}，购物车数量 ${item.quantity}`);
      err.statusCode = 400;
      throw err;
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
    await connection.beginTransaction();
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      await connection.query(
        `INSERT INTO dealer_orders
         (order_no, line_no, dealer_id, dealer_name, dealer_phone, regional_manager_name, customer_name, contact_name, contact_phone,
          model, batch_no, eta, inventory_type, quantity, approved_qty, allocated_qty, delivery_date, remark, status, regional_review_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 'regional_pending', 'pending')`,
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
          order.remark,
        ]
      );
    }
    await connection.commit();
  } catch (err) {
    try { await connection.rollback(); } catch (rollbackErr) {}
    throw err;
  } finally {
    await connection.end();
  }

  return {
    id: order.orderNo,
    status: "regional_pending",
    itemCount: items.length,
    message: "订单已提交，等待大区经理初审",
  };
}

async function listDealerOrders(filters = {}) {
  const connection = await mysql.createConnection(dbConfig);
  try {
    await ensureDealerOrdersTable(connection);
    const where = [];
    const params = [];
    if (filters.dealerId) {
      where.push("dealer_id = ?");
      params.push(filters.dealerId);
    }
    if (filters.regionalManagerName) {
      where.push("regional_manager_name = ?");
      params.push(filters.regionalManagerName);
    }
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
        delivery_date AS deliveryDate,
        remark,
        status,
        regional_review_status AS regionalReviewStatus,
        regional_review_note AS regionalReviewNote,
        regional_reviewed_by AS regionalReviewedBy,
        DATE_FORMAT(regional_reviewed_at, '%Y-%m-%d %H:%i:%s') AS regionalReviewedAt,
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

    return Array.from(grouped.values()).map(order => {
      const statuses = order.items.map(item => item.status);
      const allAllocated = statuses.every(status => status === "allocated");
      const anyAllocated = order.items.some(item => item.status === "allocated" || Number(item.allocatedQty || 0) > 0);
      const anyApproved = statuses.includes("approved");
      const allRejected = statuses.every(status => status === "rejected");
      const status = allAllocated ? "allocated" : anyAllocated ? "partial_allocated" : allRejected ? "rejected" : anyApproved ? "approved" : statuses[0];
      return Object.assign({}, order, {
        status,
        itemCount: order.items.length,
        model: order.items.map(item => `${item.model}x${item.quantity}`).join(" / "),
        batchNo: Array.from(new Set(order.items.map(item => item.batchNo || "-"))).join(" / ")
      });
    });
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

  const regionalManagerName = normalize(payload.regionalManagerName);
  const reviewerName = normalize(payload.reviewerName || payload.reviewedBy || regionalManagerName);
  const note = normalize(payload.note || payload.regionalReviewNote || "");
  const orderId = requireText(orderNo, "订单号");
  const finalStatus = nextStatus === "approved" ? "pending" : "regional_rejected";

  const connection = await mysql.createConnection(dbConfig);
  try {
    await ensureDealerOrdersTable(connection);
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

function reservationKey(row) {
  if (row.heightened || row.inventoryType === "heightened") {
    return [
      "heightened",
      row.originalBatchNo || row.batchNo,
      row.originalEta || row.eta,
      row.model
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
        inventory_type AS inventoryType,
        SUM(GREATEST(quantity - allocated_qty, 0)) AS qty
       FROM dealer_orders
       WHERE status IN ('regional_pending', 'pending', 'approved')
         AND quantity > allocated_qty
       GROUP BY model, batch_no, inventory_type`
    );
    const map = new Map();
    for (const row of rows) {
      const normalizedRow = {
        model: normalize(row.model),
        batchNo: normalize(row.batchNo),
        inventoryType: normalize(row.inventoryType),
      };
      map.set(reservationKey(normalizedRow), Number(row.qty || 0));
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
      const heightened = heightenedCol ? isHeightenedValue(row[heightenedCol]) : false;
      const model = heightened ? heightenedModelName(rawModel) : rawModel;
      const batchNo = heightened ? "加高" : normalize(row[batchCol]);
      const eta = etaCol && columns.includes(etaCol) ? normalize(row[etaCol]) : "";
      const originalBatchNo = originalBatchCol ? normalize(row[originalBatchCol]) : "";
      const originalEta = originalEtaCol ? normalize(row[originalEtaCol]) : "";
      const isStock = isStockBatch(batchNo);
      return {
        model,
        available: quantityValue(row, quantityCol),
        batchNo: isStock ? "FINISHED-STOCK" : (batchNo || "UNKNOWN-BATCH"),
        eta: isStock ? "现货" : (eta || "未排期"),
        inventoryType: isStock ? "finished" : "wip",
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

async function availableModels() {
  const summary = new Map();
  for (const row of await aggregateAvailabilityRows()) {
    if (!summary.has(row.model)) {
      summary.set(row.model, { model: row.model, available: 0, finished: 0, wip: 0 });
    }
    const item = summary.get(row.model);
    item.available += row.available;
    item[row.inventoryType] += row.available;
  }
  return Array.from(summary.values());
}

async function inboundPlans() {
  const groups = new Map();
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
    .map(group => Object.assign({}, group, { items: Array.from(group.items.values()) }))
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
  return rows.map(row => row.model).filter(Boolean).sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
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
      sendJson(res, 200, await listDealerApplications());
      return;
    }
    if (url.pathname === "/api/dealer/regional-managers" && req.method === "GET") {
      sendJson(res, 200, await listRegionalManagers());
      return;
    }
    const reviewMatch = url.pathname.match(/^\/api\/dealer\/admin\/dealers\/([^/]+)\/review$/);
    if (reviewMatch && req.method === "POST") {
      const payload = await readJsonBody(req);
      sendJson(res, 200, await reviewDealerApplication(decodeURIComponent(reviewMatch[1]), payload.status));
      return;
    }
    if (url.pathname === "/api/dealer/orders" && req.method === "POST") {
      const payload = await readJsonBody(req);
      sendJson(res, 200, await createDealerOrder(payload));
      return;
    }
    const regionalOrderReviewMatch = url.pathname.match(/^\/api\/dealer\/orders\/([^/]+)\/regional-review$/);
    if (regionalOrderReviewMatch && req.method === "POST") {
      const payload = await readJsonBody(req);
      sendJson(res, 200, await reviewDealerOrderByRegionalManager(decodeURIComponent(regionalOrderReviewMatch[1]), payload));
      return;
    }
    if (url.pathname === "/api/dealer/orders" && req.method === "GET") {
      sendJson(res, 200, await listDealerOrders({
        dealerId: url.searchParams.get("dealerId"),
        regionalManagerName: url.searchParams.get("regionalManagerName")
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






