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

async function main() {
  const env = loadEnv();
  const [addressHost, addressPort] = String(env.MYSQL_ADDRESS || "").split(":");
  const connection = await mysql.createConnection({
    host: env.MYSQL_HOST || addressHost || "127.0.0.1",
    port: Number(env.MYSQL_PORT || addressPort || 3306),
    user: env.MYSQL_USER || env.MYSQL_USERNAME || "root",
    password: env.MYSQL_PASSWORD || "",
    database: env.MYSQL_DATABASE || "rjfinshed",
    charset: "utf8mb4"
  });

  try {
    await connection.beginTransaction();
    const [orders] = await connection.query("DELETE FROM dealer_orders");
    const [applications] = await connection.query("DELETE FROM dealer_applications");
    await connection.query("ALTER TABLE dealer_orders AUTO_INCREMENT = 1");
    await connection.query("ALTER TABLE dealer_applications AUTO_INCREMENT = 1");
    await connection.commit();
    console.log(`deleted dealer_orders=${orders.affectedRows}`);
    console.log(`deleted dealer_applications=${applications.affectedRows}`);
  } catch (err) {
    try {
      await connection.rollback();
    } catch (rollbackErr) {}
    throw err;
  } finally {
    await connection.end();
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
