# 经销商 API MySQL 适配层

小程序前端不能直接连接 MySQL。这个服务负责读取：

```text
rjfinshed.finished_goods_data
```

并转换成小程序需要的接口：

```text
GET /api/dealer/inventory/available-models
GET /api/dealer/inventory/inbound-plans
GET /api/dealer/debug/columns
```

## 启动方式 A：Node.js

```powershell
cd C:\RJ_Wechat_App\server
npm install
npm start
```

也可以直接编辑 `server/.env`：

```text
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=你的密码
MYSQL_DATABASE=rjfinshed
FINISHED_GOODS_TABLE=finished_goods_data
```

然后启动：

```powershell
cd C:\RJ_Wechat_App\server
.\start_dealer_api.ps1
```

如果 Windows 提示禁止运行 PowerShell 脚本，使用：
```powershell
cd C:\RJ_Wechat_App\server
.\start_dealer_api.cmd
```

## 同步微信小程序汇总表

从 `finished_goods_data` 重建 `wechat_batch_summary`：

```powershell
cd C:\RJ_Wechat_App\server
.\sync_wechat_batch_summary.cmd
```

同步规则：
- 只统计 `状态` 为 `库存中`、`待入库` 且 `客户` 为空的数据。
- `合同备注` 包含 `加高` 的记录会单独汇总到 `batch_no = 加高`。
- `加高` 记录会写入 `wechat_batch_summary.加高 = 1`，不计入原机型普通批次数量。

## 启动方式 B：Python/FastAPI

如果你的电脑安装了 Python，也可以使用 FastAPI 版本：

```powershell
cd C:\RJ_Wechat_App\server
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:MYSQL_HOST="127.0.0.1"
$env:MYSQL_PORT="3306"
$env:MYSQL_USER="root"
$env:MYSQL_PASSWORD="你的密码"
$env:MYSQL_DATABASE="rjfinshed"
uvicorn dealer_api:app --host 0.0.0.0 --port 8001 --reload
```

## 字段识别

服务会自动识别常见字段名：

- 机型：`model`、`machine_model`、`product_model`、`机型`、`型号`
- 数量：`quantity`、`qty`、`stock`、`数量`、`库存`
- 批次号：`batch_no`、`batch_number`、`批次号`
- 预计入库：`eta`、`expected_inbound_date`、`预计入库时间`
- 绑定状态：`bound`、`is_bound`、`binding_status`、`绑定状态`

如果你的实际字段名不在候选里，修改 `server/dealer_api.py` 的 `FIELD_CANDIDATES`。

Node 版本对应修改 `server/dealer_api_node.js` 的 `fieldCandidates`。
