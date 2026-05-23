const api = require("../../../utils/api");

function handleWechatLoginResult(page, data) {
  if (data && data.token && data.account) {
    const app = getApp();
    app.setSession(data.token, data.account);
    page.setData({ submitting: false, statusText: "登录成功，正在进入..." });
    if (data.account.role === "admin") {
      wx.redirectTo({ url: "/pages/admin/reviews/index" });
      return;
    }
    wx.switchTab({ url: "/pages/index/index" });
    return;
  }

  if (data && data.needRegister && data.openidToken) {
    page.setData({ submitting: false, statusText: "请先填写注册信息" });
    wx.navigateTo({
      url: "/pages/auth/register/index?openidToken=" + encodeURIComponent(data.openidToken)
    });
    return;
  }

  const message = (data && data.message) || "账号还未审核通过";
  page.setData({ submitting: false, statusText: message });
  wx.showModal({ title: "暂不能登录", content: message, showCancel: false });
}

Page({
  data: {
    adminPhone: "",
    adminPassword: "",
    submitting: false,
    adminSubmitting: false,
    statusText: ""
  },

  onAdminPhoneInput(e) {
    this.setData({ adminPhone: e.detail.value });
  },

  onAdminPasswordInput(e) {
    this.setData({ adminPassword: e.detail.value });
  },

  openAgreement(e) {
    const type = e.currentTarget.dataset.type;
    wx.navigateTo({
      url: type === "privacy" ? "/pages/legal/privacy/index" : "/pages/legal/terms/index"
    });
  },

  wechatLogin() {
    if (this.data.submitting) return;
    this.setData({ submitting: true, statusText: "正在获取微信登录凭证..." });

    wx.login({
      success: loginRes => {
        if (!loginRes.code) {
          this.setData({ submitting: false, statusText: "微信登录失败，请重试" });
          wx.showToast({ title: "微信登录失败", icon: "none" });
          return;
        }

        this.setData({ statusText: "正在登录..." });
        api.wechatLogin({ code: loginRes.code })
          .then(res => handleWechatLoginResult(this, res.data))
          .catch(err => {
            const message = err.message || "微信登录失败";
            this.setData({ submitting: false, statusText: message });
            wx.showToast({ title: message, icon: "none" });
          });
      },
      fail: err => {
        const message = err.errMsg || "微信登录失败";
        this.setData({ submitting: false, statusText: message });
        wx.showToast({ title: message, icon: "none" });
      }
    });
  },

  adminLogin() {
    const phone = this.data.adminPhone.trim();
    const password = this.data.adminPassword.trim();
    if (!phone || !password) {
      wx.showToast({ title: "请输入管理员账号和密码", icon: "none" });
      return;
    }

    this.setData({ adminSubmitting: true, statusText: "正在登录管理员账号..." });
    api.login({ phone, password })
      .then(res => {
        if (!res.data.account || res.data.account.role !== "admin") {
          this.setData({ adminSubmitting: false, statusText: "该账号不是管理员账号" });
          wx.showToast({ title: "该账号不是管理员账号", icon: "none" });
          return;
        }
        const app = getApp();
        app.setSession(res.data.token, res.data.account);
        this.setData({ adminSubmitting: false, statusText: "登录成功，正在进入..." });
        wx.redirectTo({ url: "/pages/admin/reviews/index" });
      })
      .catch(err => {
        const message = err.message || "管理员登录失败";
        this.setData({ adminSubmitting: false, statusText: message });
        wx.showToast({ title: message, icon: "none" });
      });
  }
});
