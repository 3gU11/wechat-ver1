Page({
  data: {
    loading: false,
    account: null,
    isLoggedIn: false,
    isAdminAccount: false,
    isRegionalManager: false,
    models: [],
    phone: "",
    password: "",
    submitting: false,
    statusText: ""
  },

  onShow() {
    getApp().getSession(account => {
      if (!account) {
        this.setData({
          account: null,
          isLoggedIn: false,
          isAdminAccount: false,
          isRegionalManager: false,
          models: [],
          loading: false
        });
        return;
      }
      this.setData({
        account,
        isLoggedIn: true,
        isAdminAccount: account.role === "admin",
        isRegionalManager: account.role === "regional_manager"
      });
      this.loadModels();
    });
  },

  onPhoneInput(e) {
    this.setData({ phone: e.detail.value });
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value });
  },

  login() {
    const phone = this.data.phone.trim();
    const password = this.data.password.trim();

    if (!phone || !password) {
      this.setData({ statusText: "请输入账号和验证码" });
      return;
    }

    this.setData({ submitting: true, statusText: "正在登录，请稍候..." });

    const api = require("../../utils/api");
    api.login({ phone, password })
      .then(res => {
        getApp().setSession(res.data.token, res.data.account);
        this.setData({
          submitting: false,
          account: res.data.account,
          isLoggedIn: true,
          isAdminAccount: res.data.account.role === "admin",
          isRegionalManager: res.data.account.role === "regional_manager",
          statusText: "登录成功"
        });
        this.loadModels();
      })
      .catch(err => {
        this.setData({ submitting: false, statusText: err.message || "登录失败" });
      });
  },

  goRegister() {
    wx.navigateTo({ url: "/pages/auth/register/index" });
  },

  goAdminReviews() {
    wx.navigateTo({ url: "/pages/admin/reviews/index" });
  },

  loadModels() {
    const api = require("../../utils/api");
    const fallbackModels = [
      { model: "DK7735", available: 15, finished: 6, wip: 9 },
      { model: "DK7745", available: 19, finished: 8, wip: 11 },
      { model: "DK7755", available: 11, finished: 4, wip: 7 }
    ];

    this.setData({ loading: true });
    api.getDealerInventory()
      .then(res => {
        this.setData({ loading: false, models: Array.isArray(res.data) ? res.data : fallbackModels });
      })
      .catch(() => {
        this.setData({
          loading: false,
          models: fallbackModels,
          statusText: "未连接云托管接口，当前显示演示数据"
        });
      });
  },

  goMachines() {
    wx.switchTab({ url: "/pages/inbound/index" });
  },

  goCart() {
    wx.navigateTo({ url: "/pages/order-create/index" });
  }
});
