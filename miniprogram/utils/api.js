const mock = require("./mock");

let mockDealerApplications = null;

function getAppSafe() {
  if (typeof getApp === "function") {
    return getApp();
  }
  return { globalData: {} };
}

function request(options) {
  const app = getAppSafe();
  const baseUrl = app.globalData.apiBaseUrl || "";
  const token = app.globalData.token || "";

  if (!baseUrl || baseUrl.indexOf("example.com") !== -1) {
    return Promise.reject(new Error("MOCK_MODE"));
  }

  return new Promise((resolve, reject) => {
    const query = options.method && options.method !== "GET" ? "" : buildQuery(options.data || {});
    wx.request({
      url: baseUrl + options.url + query,
      method: options.method || "GET",
      data: options.data || {},
      header: {
        "content-type": "application/json",
        "Authorization": token ? "Bearer " + token : ""
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        reject(new Error(res.data && res.data.message ? res.data.message : "请求失败"));
      },
      fail(err) {
        reject(err);
      }
    });
  });
}

function buildQuery(data) {
  const keys = Object.keys(data || {}).filter(key => data[key] !== undefined && data[key] !== null && data[key] !== "");
  if (!keys.length) {
    return "";
  }
  return "?" + keys.map(key => encodeURIComponent(key) + "=" + encodeURIComponent(data[key])).join("&");
}

function isMockMode() {
  const app = getAppSafe();
  const baseUrl = app.globalData.apiBaseUrl || "";
  return !baseUrl || baseUrl.indexOf("example.com") !== -1;
}

function getMockDealers() {
  const initial = [
    {
      id: "dealer-approved-demo",
      companyName: "苏州锐捷机床销售有限公司",
      phone: "13800000000",
      contactName: "王经理",
      region: "江苏",
      status: "approved",
      createdAt: "2026-05-16 09:00"
    },
    {
      id: "dealer-pending-demo",
      companyName: "宁波线切割设备服务部",
      phone: "13900000000",
      contactName: "李经理",
      region: "浙江",
      status: "pending",
      createdAt: "2026-05-16 10:30"
    }
  ];

  if (mockDealerApplications && mockDealerApplications.length) {
    const rows = mockDealerApplications.slice();
    initial.forEach(seed => {
      const exists = rows.find(item => item.phone === seed.phone);
      if (!exists) {
        rows.push(seed);
      }
    });
    mockDealerApplications = rows;
    return rows;
  }

  mockDealerApplications = initial;
  return initial;
}

function saveMockDealers(rows) {
  mockDealerApplications = rows;
}

function getCurrentAccount() {
  const app = getAppSafe();
  return app.globalData.account || null;
}

function requireLogin() {
  return !!getCurrentAccount();
}

function isAdmin() {
  const account = getCurrentAccount();
  return !!account && account.role === "admin";
}

function login(payload) {
  const phone = (payload.phone || "").trim();
  const password = (payload.password || "").trim();

  function mockLogin() {
    if (phone === "admin" && password === "admin123") {
      return {
        data: {
          token: "mock-admin-token",
          account: {
            id: "admin",
            role: "admin",
            name: "系统管理员",
            phone: "admin",
            status: "approved"
          }
        },
        mock: true
      };
    }

    const dealer = getMockDealers().find(item => item.phone === phone);
    if (!dealer) {
      return Promise.reject(new Error("手机号未注册，请先提交注册申请"));
    }
    if (dealer.status !== "approved") {
      return Promise.reject(new Error("账号还未审核通过，暂不能登录"));
    }
    if (password !== "123456") {
      return Promise.reject(new Error("验证码错误，演示验证码为 123456"));
    }

    return {
      data: {
        token: "mock-dealer-token-" + dealer.id,
        account: {
          id: dealer.id,
          role: "dealer",
          name: dealer.companyName,
          phone: dealer.phone,
          contactName: dealer.contactName,
          region: dealer.region,
          status: dealer.status
        }
      },
      mock: true
    };
  }

  if (isMockMode()) {
    try {
      return Promise.resolve(mockLogin());
    } catch (err) {
      return Promise.reject(err);
    }
  }

  return request({
    url: "/auth/login",
    method: "POST",
    data: { phone, password }
  }).then(data => {
    return { data, mock: false };
  }).catch(err => {
    if (err.message === "MOCK_MODE") {
      return { data: mockLogin().data, mock: true };
    }
    return Promise.reject(err);
  });
}

function registerDealer(payload) {
  return request({
    url: "/auth/register",
    method: "POST",
    data: payload
  }).then(data => {
    return { data, mock: false };
  }).catch(err => {
    if (err.message === "MOCK_MODE") {
      return {
        data: {
          status: "pending",
          message: "注册申请已提交，请等待管理员审核"
        },
        mock: true
      };
    }
    return Promise.reject(err);
  });
}

function getDealerApplications() {
  return withMock(request({ url: "/admin/dealers/applications" }), getMockDealers());
}

function reviewDealerApplication(id, status) {
  return request({
    url: "/admin/dealers/" + id + "/review",
    method: "POST",
    data: { status }
  }).catch(() => {
    const rows = getMockDealers().map(item => {
      if (item.id === id) {
        return Object.assign({}, item, { status });
      }
      return item;
    });
    saveMockDealers(rows);
    return {
      data: { success: true },
      mock: true
    };
  });
}

function withMock(apiPromise, fallback) {
  return apiPromise.then(data => {
    return {
      data,
      mock: false
    };
  }).catch(() => {
    return Promise.resolve({
      data: fallback,
      mock: true
    });
  });
}

function getDashboard() {
  return withMock(request({ url: "/dashboard" }), mock.dashboard);
}

function getAvailableMachines(filters) {
  const query = filters || {};
  let rows = mock.machines;

  if (query.status && query.status !== "all") {
    rows = rows.filter(item => item.status === query.status);
  }
  if (query.model) {
    rows = rows.filter(item => item.model.indexOf(query.model) !== -1);
  }

  return withMock(request({ url: "/machines/available", data: query }), rows);
}

function getDealerInventory(filters) {
  const query = filters || {};
  let rows = mock.dashboard.categories.map(item => ({
    model: item.model,
    available: item.finished + item.wip,
    finished: item.finished,
    wip: item.wip
  }));

  if (query.model) {
    rows = rows.filter(item => item.model.indexOf(query.model) !== -1);
  }

  return withMock(request({ url: "/inventory/available-models", data: query }), rows);
}

function getInboundPlans() {
  return withMock(request({ url: "/inventory/inbound-plans" }), mock.inboundPlans);
}

function getModelOptions() {
  const fallback = Array.from(new Set((mock.inboundPlans || []).flatMap(plan => {
    return (plan.items || []).map(item => item.model);
  }))).filter(Boolean);
  return withMock(request({ url: "/models" }), fallback);
}

function getBatches() {
  return withMock(request({ url: "/batches/available" }), mock.dashboard.batches);
}

function createOrder(payload) {
  const app = getAppSafe();
  const account = app.globalData.account || {};
  return withMock(request({
    url: "/orders",
    method: "POST",
    data: Object.assign({}, payload, {
      dealer: {
        id: account.id || "",
        name: account.name || "",
        phone: account.phone || ""
      }
    })
  }), {
    id: "O" + Date.now(),
    status: "pending",
    message: "订单已提交，等待工厂审核并绑定机台"
  });
}

function getOrders() {
  const app = getAppSafe();
  const account = app.globalData.account || {};
  const query = account.role === "admin" ? {} : { dealerId: account.id || "" };
  return withMock(request({
    url: "/orders",
    data: query
  }), mock.orders);
}

module.exports = {
  login,
  registerDealer,
  getDealerApplications,
  reviewDealerApplication,
  requireLogin,
  isAdmin,
  getDashboard,
  getDealerInventory,
  getInboundPlans,
  getModelOptions,
  getAvailableMachines,
  getBatches,
  createOrder,
  getOrders
};
