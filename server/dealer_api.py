import os
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal

import pymysql
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware


app = FastAPI(title="Dealer Portal API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


DB_CONFIG = {
    "host": os.getenv("MYSQL_HOST", "127.0.0.1"),
    "port": int(os.getenv("MYSQL_PORT", "3306")),
    "user": os.getenv("MYSQL_USER", "root"),
    "password": os.getenv("MYSQL_PASSWORD", ""),
    "database": os.getenv("MYSQL_DATABASE", "rjfinshed"),
    "charset": "utf8mb4",
    "cursorclass": pymysql.cursors.DictCursor,
}

TABLE_NAME = os.getenv("FINISHED_GOODS_TABLE", "finished_goods_data")


FIELD_CANDIDATES = {
    "model": [
        "model",
        "machine_model",
        "product_model",
        "goods_model",
        "equipment_model",
        "型号",
        "机型",
        "产品型号",
    ],
    "quantity": [
        "available",
        "available_qty",
        "available_quantity",
        "qty",
        "quantity",
        "count",
        "stock",
        "库存",
        "数量",
        "可订数量",
    ],
    "batch_no": [
        "batch_no",
        "batch",
        "batch_number",
        "production_batch",
        "lot_no",
        "批次号",
        "批次",
        "生产批次",
    ],
    "eta": [
        "eta",
        "expected_inbound_time",
        "expected_inbound_date",
        "estimated_storage_time",
        "inbound_date",
        "入库时间",
        "预计入库时间",
        "预计入库日期",
    ],
    "status": [
        "status",
        "state",
        "inventory_status",
        "lifecycle_status",
        "状态",
    ],
    "bound": [
        "bound",
        "is_bound",
        "bind_status",
        "binding_status",
        "订单绑定状态",
        "绑定状态",
        "已绑定",
    ],
}


def get_connection():
    try:
        return pymysql.connect(**DB_CONFIG)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"MySQL连接失败: {exc}") from exc


def json_value(value):
    if isinstance(value, (datetime, date)):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, Decimal):
        return float(value)
    return value


def normalized(value):
    if value is None:
        return ""
    return str(value).strip()


def pick_column(columns, key):
    lower_map = {column.lower(): column for column in columns}
    for candidate in FIELD_CANDIDATES[key]:
        if candidate in columns:
            return candidate
        matched = lower_map.get(candidate.lower())
        if matched:
            return matched
    return None


def is_unbound(row, bound_col):
    if not bound_col:
        return True

    value = normalized(row.get(bound_col)).lower()
    if value in ("", "0", "false", "no", "none", "null", "unbound", "available", "未绑定", "未绑", "可订"):
        return True
    if value in ("1", "true", "yes", "bound", "已绑定", "已绑"):
        return False
    return value != "bound"


def inventory_type(row, status_col, eta):
    if status_col:
        value = normalized(row.get(status_col)).lower()
        if value.startswith("库存中") or value in ("finished", "stock", "in_stock", "成品", "成品库", "现货", "已入库"):
            return "finished"
        if value in ("待入库", "wip", "production", "producing", "在制", "生产中", "排产中"):
            return "wip"
        return ""

    if eta and eta != "现货":
        return "wip"
    return "finished"


def quantity_value(row, quantity_col):
    if not quantity_col:
        return 1
    value = row.get(quantity_col)
    if value in (None, ""):
        return 0
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 1


def load_finished_goods_rows():
    with get_connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(f"SELECT * FROM `{TABLE_NAME}`")
            rows = cursor.fetchall()
            columns = [desc[0] for desc in cursor.description]
    return rows, columns


def reservation_key(row):
    if row.get("inventoryType") == "finished":
        return "|".join(["finished", "FINISHED-STOCK", row.get("model", "")])
    return "|".join([row.get("inventoryType", ""), row.get("batchNo", ""), row.get("model", "")])


def get_active_order_hold_map():
    with get_connection() as conn:
        with conn.cursor() as cursor:
            try:
                cursor.execute(
                    """
                    SELECT model, batch_no AS batchNo, inventory_type AS inventoryType,
                           SUM(GREATEST(quantity - COALESCE(allocated_qty, 0), 0)) AS qty
                    FROM dealer_orders
                    WHERE status IN ('pending', 'approved')
                      AND quantity > COALESCE(allocated_qty, 0)
                    GROUP BY model, batch_no, inventory_type
                    """
                )
                rows = cursor.fetchall()
            except Exception:
                return {}

    result = {}
    for row in rows:
        normalized_row = {
            "model": normalized(row.get("model")),
            "batchNo": normalized(row.get("batchNo")),
            "inventoryType": normalized(row.get("inventoryType")),
        }
        result[reservation_key(normalized_row)] = int(row.get("qty") or 0)
    return result


def map_rows():
    rows, columns = load_finished_goods_rows()
    model_col = pick_column(columns, "model") or "model"
    quantity_col = pick_column(columns, "quantity") or "quantity"
    batch_col = pick_column(columns, "batch_no") or "batch_no"
    eta_col = pick_column(columns, "eta") or "expected_inbound_time"

    for required_col in (model_col, quantity_col, batch_col):
        if required_col not in columns:
            raise HTTPException(
                status_code=500,
                detail=f"无法读取微信汇总表字段: {required_col}。当前字段: {', '.join(columns)}",
            )

    mapped = []
    for row in rows:
        model = normalized(row.get(model_col))
        batch_no = normalized(row.get(batch_col))
        eta = normalized(json_value(row.get(eta_col))) if eta_col in columns else ""
        is_stock = batch_no == "库存中"
        mapped.append({
            "model": model,
            "available": quantity_value(row, quantity_col),
            "batchNo": "FINISHED-STOCK" if is_stock else (batch_no or "UNKNOWN-BATCH"),
            "eta": "现货" if is_stock else (eta or "未排期"),
            "inventoryType": "finished" if is_stock else "wip",
        })

    return [row for row in mapped if row["model"] and row["batchNo"] and row["available"] > 0]


def aggregate_availability_rows():
    grouped = {}
    for row in aggregate_availability_rows():
        key = reservation_key(row)
        if key not in grouped:
            grouped[key] = dict(row, available=0)
        grouped[key]["available"] += int(row.get("available") or 0)

    for key, reserved_qty in get_active_order_hold_map().items():
        if key in grouped:
            grouped[key]["available"] = max(0, int(grouped[key]["available"] or 0) - int(reserved_qty or 0))

    return [row for row in grouped.values() if row["available"] > 0]


@app.get("/api/dealer/health")
def health():
    return {"status": "ok", "database": DB_CONFIG["database"], "table": TABLE_NAME}


@app.get("/api/dealer/inventory/available-models")
def available_models():
    summary = defaultdict(lambda: {"model": "", "available": 0, "finished": 0, "wip": 0})
    for row in aggregate_availability_rows():
        item = summary[row["model"]]
        item["model"] = row["model"]
        item["available"] += row["available"]
        item[row["inventoryType"]] += row["available"]

    return list(summary.values())


@app.get("/api/dealer/inventory/inbound-plans")
def inbound_plans():
    groups = {}
    for row in aggregate_availability_rows():
        group_eta = "现货" if row["inventoryType"] == "finished" else row["eta"]
        group_batch_no = "FINISHED-STOCK" if row["inventoryType"] == "finished" else row["batchNo"]
        key = (row["inventoryType"], group_eta, group_batch_no)
        if key not in groups:
            groups[key] = {
                "id": f"{row['inventoryType']}-{group_batch_no}-{group_eta}",
                "inventoryType": row["inventoryType"],
                "title": "成品现货" if row["inventoryType"] == "finished" else f"预计入库 {group_eta}",
                "batchNo": group_batch_no,
                "eta": group_eta,
                "items": {},
            }

        items = groups[key]["items"]
        if row["model"] not in items:
            items[row["model"]] = {"model": row["model"], "available": 0}
        items[row["model"]]["available"] += row["available"]

    result = []
    for group in groups.values():
        group["items"] = list(group["items"].values())
        result.append(group)

    return sorted(result, key=lambda item: (item["inventoryType"] != "finished", item["eta"], item["batchNo"]))


