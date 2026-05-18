const api = require("../../../utils/api");

Page({
  data: {
    phone: "",
    password: "",
    submitting: false,
    statusText: ""
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
      wx.showToast({ title: "请输入账号和验证码", icon: "none" });
      return;
    }

    this.setData({
      submitting: true,
      statusText: "正在登录，请稍候..."
    });
    api.login({
      phone,
      password
    }).then(res => {
      const app = getApp();
      app.setSession(res.data.token, res.data.account);
      this.setData({
        submitting: false,
        statusText: "登录成功，正在进入..."
      });

      if (res.data.account.role === "admin") {
        wx.redirectTo({
          url: "/pages/admin/reviews/index",
          fail: err => {
            this.setData({ statusText: "管理员页面跳转失败：" + err.errMsg });
          }
        });
        return;
      }
      wx.switchTab({
        url: "/pages/index/index",
        fail: err => {
          this.setData({ statusText: "首页跳转失败：" + err.errMsg });
        }
      });
    }).catch(err => {
      const message = err.message || "登录失败";
      this.setData({
        submitting: false,
        statusText: message
      });
      wx.showToast({ title: message, icon: "none" });
    });
  },

  goRegister() {
    wx.navigateTo({ url: "/pages/auth/register/index" });
  }
});
