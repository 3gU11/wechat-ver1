# Dealer Portal API

The mini program backend reads summarized inventory from:

```text
rjfinshed.wechat_batch_summary
```

The source-table-to-summary process is handled outside this codebase. This service only consumes `wechat_batch_summary` and serves the mini program API.

## Node.js

```powershell
cd C:\RJ_Wechat_App\server
npm install
npm start
```

Environment variables:

```text
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=rjfinshed
```

Useful endpoints:

```text
GET /api/dealer/health
GET /api/dealer/inventory/available-models
GET /api/dealer/inventory/inbound-plans
GET /api/dealer/models
GET /api/dealer/orders
POST /api/dealer/orders
```

## Inventory Columns

`wechat_batch_summary` is expected to use English columns:

```text
summary_id
batch_no
expected_inbound_time
model
quantity
heightened
original_batch_no
original_expected_inbound_time
updated_at
```
