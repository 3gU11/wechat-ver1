# 经销商小程序门户框架

## 定位

经销商小程序不是新的库存系统，而是现有 V7STD1.0 系统的外部门户层。

数据仍以现有 FastAPI 业务中台和 MySQL 为准：

- 成品库存来自现有成品库存表或库存查询服务
- 在制数量来自现有排产/批次数据
- 机台是否可订以现有 Bound 状态为准
- 经销商提交的是订单和绑定申请，不直接修改原始库存

## 推荐链路

```text
微信小程序前端
  -> 经销商专用 API
  -> 现有 FastAPI 业务中台
  -> 现有 MySQL 数据库
```

经销商专用 API 负责：

- 鉴权经销商身份
- 过滤内部字段
- 只返回未绑定机台
- 接收订单申请
- 调用现有 FastAPI 创建订单、锁定或发起绑定审批
- 记录外部访问审计

## 小程序当前页面

- `pages/auth/login/index`：手机号登录；演示 admin 账号为 `admin / admin123`
- `pages/auth/register/index`：普通经销商注册申请
- `pages/admin/reviews/index`：admin 审核经销商注册申请
- `pages/index/index`：普通经销商查看机型、成品可订数量、在制可订数量
- `pages/inbound/index`：按预计入库时间和批次号查看可订机型，并点击机型上传订单
- `pages/machines/index`：普通经销商按机型查看成品/在制数量
- `pages/batches/index`：在制批次列表，展示批次数量、可订数量、进度、预计完工
- `pages/order-create/index`：上传订单并申请绑定机台
- `pages/orders/index`：经销商自己的订单申请列表
- `pages/profile/index`：经销商账号和接口边界说明

## 小程序需要的经销商 API

### POST `/auth/login`

普通经销商使用手机号登录，只有审核通过后才允许登录。admin 使用后台账号登录。

```json
{
  "phone": "13800000000",
  "password": "123456"
}
```

返回：

```json
{
  "token": "jwt-token",
  "account": {
    "id": "dealer-1",
    "role": "dealer",
    "name": "苏州锐捷机床销售有限公司",
    "phone": "13800000000",
    "status": "approved"
  }
}
```

### POST `/auth/register`

提交经销商注册申请，默认状态为 `pending`。

```json
{
  "companyName": "苏州锐捷机床销售有限公司",
  "phone": "13800000000",
  "contactName": "王经理",
  "region": "江苏苏州",
  "remark": "已有合作客户资源"
}
```

### GET `/inventory/available-models`

普通经销商专用库存接口。返回机型维度的成品和在制可订数量，不返回机台编号、库位、内部生命周期状态。

```json
[
  { "model": "DK7745", "available": 19, "finished": 8, "wip": 11 },
  { "model": "DK7735", "available": 15, "finished": 6, "wip": 9 }
]
```

### GET `/inventory/inbound-plans`

按预计入库时间和批次号分组返回经销商可订数据。成品可使用 `eta = "现货"` 独立分组；在制品按实际预计入库时间分组。同一个预计入库时间对应一个批次号。

```json
[
  {
    "id": "B2026051601",
    "inventoryType": "wip",
    "batchNo": "B2026051601",
    "eta": "2026-05-22",
    "items": [
      { "model": "DK7745", "available": 8 },
      { "model": "DK7735", "available": 3 }
    ]
  },
  {
    "id": "finished-stock",
    "inventoryType": "finished",
    "batchNo": "FINISHED-STOCK",
    "eta": "现货",
    "items": [
      { "model": "DK7745", "available": 8 }
    ]
  }
]
```

### GET `/admin/dealers/applications`

admin 查询经销商注册申请列表。

```json
[
  {
    "id": "dealer-1",
    "companyName": "苏州锐捷机床销售有限公司",
    "phone": "13800000000",
    "contactName": "王经理",
    "status": "pending",
    "createdAt": "2026-05-16 10:30"
  }
]
```

### POST `/admin/dealers/{id}/review`

admin 审核经销商注册申请。

```json
{
  "status": "approved"
}
```

### GET `/dashboard`

返回经销商可见总览。

```json
{
  "finishedAvailable": 18,
  "wipAvailable": 27,
  "boundMachines": 42,
  "pendingOrders": 5,
  "updatedAt": "2026-05-16 14:30",
  "categories": [
    { "model": "DK7745", "finished": 8, "wip": 11 }
  ],
  "batches": [
    {
      "batchNo": "B2026051601",
      "line": "装配一线",
      "model": "DK7745",
      "total": 12,
      "available": 8,
      "progress": 68,
      "eta": "2026-05-22"
    }
  ]
}
```

### GET `/machines/available`

只返回未绑定机台。可支持查询参数：

- `status`: `all`、`finished`、`wip`
- `model`: 机型关键字

```json
[
  {
    "id": "M001",
    "serialNo": "RJ-7745-260516-001",
    "model": "DK7745",
    "status": "finished",
    "batchNo": "B2026051201",
    "location": "成品库 A-03",
    "available": true,
    "bound": false,
    "eta": "现货"
  }
]
```

### GET `/batches/available`

返回经销商可见的在制批次。

```json
[
  {
    "batchNo": "B2026051601",
    "line": "装配一线",
    "model": "DK7745",
    "total": 12,
    "available": 8,
    "progress": 68,
    "eta": "2026-05-22"
  }
]
```

### POST `/orders`

提交订单和绑定申请。后端应在事务里校验机台仍未绑定。

```json
{
  "machineId": "M001",
  "customerName": "苏州某精密制造",
  "contactName": "张三",
  "contactPhone": "13800000000",
  "model": "DK7745",
  "batchNo": "B2026051601",
  "eta": "2026-05-22",
  "inventoryType": "wip",
  "quantity": 1,
  "deliveryDate": "2026-05-30",
  "remark": "客户要求尽快发货"
}
```

建议返回：

```json
{
  "id": "O20260516001",
  "status": "pending",
  "message": "订单已提交，等待工厂审核并绑定机台"
}
```

### GET `/orders`

只返回当前经销商自己的订单申请。

```json
[
  {
    "id": "O20260516001",
    "customerName": "苏州某精密制造",
    "model": "DK7745",
    "quantity": 2,
    "status": "pending",
    "createdAt": "2026-05-16 10:20"
  }
]
```

## 接入位置

小程序 API 客户端在：

```text
miniprogram/utils/api.js
```

接口根地址在：

```text
miniprogram/app.js
```

把 `apiBaseUrl` 从演示地址改成你的经销商 API 地址即可。

当前本地开发默认地址：

```text
http://127.0.0.1:8000/api/dealer
```

MySQL 适配服务在：

```text
server/dealer_api.py
```
