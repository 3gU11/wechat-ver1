# 经销商订货门户小程序

这是面向经销商的微信小程序前端和本地经销商 API。

## 当前能力

- admin 审核账号注册申请
- 大区经理通过注册申请创建账号，需要填写名称和管辖大区
- 普通经销商注册时选择所属大区经理
- 普通经销商审核通过后登录、加入购物车并提交订单
- 大区经理登录后可查看公开库存表
- 订单提交后写入 `dealer_orders`，包含所属大区经理字段

## 默认账号

```text
admin: admin / admin123
```

经销商和大区经理账号需要自行注册，并由 admin 审核通过后登录。

## 接口配置

修改 `miniprogram/app.js`：

```js
apiBaseUrl: "https://api.wechat-ver1.com/api/dealer"
```

启动本地 API：

```powershell
server\start_dealer_api.cmd
```

清空经销商身份和订单测试数据：

```powershell
cd server
npm run clear:dealer
```
