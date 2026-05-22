const api = require("../../utils/api");

Page({
  data: {
    loading: false,
    account: null,
    isLoggedIn: false,
    isAdminAccount: false,
    isRegionalManager: false,
    models: [],
    submitting: false,
    statusText: ""
  },

  onShow() {
    getApp().getSession(account => {
      api.refreshRegionalPendingBadge();
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

  wechatLogin() {
    if (this.data.submitting) return;
    this.setData({ submitting: true, statusText: "正在获取微信登录凭证..." });

    wx.login({
      success: loginRes => {
        if (!loginRes.code) {
          this.setData({ submitting: false, statusText: "微信登录失败，请重试" });
          return;
        }
        this.setData({ statusText: "正在登录..." });
        api.wechatLogin({ code: loginRes.code })
          .then(res => {
            const data = res.data || {};
            if (data.token && data.account) {
              getApp().setSession(data.token, data.account);
              this.setData({
                submitting: false,
                account: data.account,
                isLoggedIn: true,
                isAdminAccount: data.account.role === "admin",
                isRegionalManager: data.account.role === "regional_manager",
                statusText: "登录成功"
              });
              api.refreshRegionalPendingBadge();
              this.loadModels();
              return;
            }
            if (data.needRegister && data.openidToken) {
              this.setData({ submitting: false, statusText: "请先填写注册信息" });
              wx.navigateTo({
                url: "/pages/auth/register/index?openidToken=" + encodeURIComponent(data.openidToken)
              });
              return;
            }
            const message = data.message || "账号还未审核通过";
            this.setData({ submitting: false, statusText: message });
            wx.showModal({ title: "暂不能登录", content: message, showCancel: false });
          })
          .catch(err => {
            this.setData({ submitting: false, statusText: err.message || "微信登录失败" });
          });
      },
      fail: err => {
        this.setData({ submitting: false, statusText: err.errMsg || "微信登录失败" });
      }
    });
  },

  goAdminLogin() {
    wx.navigateTo({ url: "/pages/auth/login/index" });
  },

  goAdminReviews() {
    wx.navigateTo({ url: "/pages/admin/reviews/index" });
  },

  loadModels() {
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
    if (this.data.isRegionalManager) {
      wx.switchTab({ url: "/pages/inbound/index" });
      return;
    }
    wx.navigateTo({ url: "/pages/machines/index" });
  },

  goCart() {
    wx.navigateTo({ url: "/pages/order-create/index" });
  }
});
