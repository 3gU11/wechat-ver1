const api = require("../../../utils/api");

Page({
  data: {
    applications: [],
    loading: true
  },

  onShow() {
    if (!api.isAdmin()) {
      wx.redirectTo({ url: "/pages/auth/login/index" });
      return;
    }
    this.loadApplications();
  },

  loadApplications() {
    this.setData({ loading: true });
    api.getDealerApplications()
      .then(res => {
        this.setData({
          loading: false,
          applications: res.data || []
        });
      })
      .catch(err => {
        this.setData({ loading: false });
        wx.showToast({ title: err.message || "加载失败", icon: "none" });
      });
  },

  review(e) {
    const id = e.currentTarget.dataset.id;
    const status = e.currentTarget.dataset.status;
    api.reviewDealerApplication(id, status)
      .then(() => {
        wx.showToast({ title: status === "approved" ? "已通过" : "已拒绝" });
        this.loadApplications();
      })
      .catch(err => {
        wx.showToast({ title: err.message || "操作失败", icon: "none" });
      });
  },

  logout() {
    getApp().clearSession();
    wx.redirectTo({ url: "/pages/auth/login/index" });
  }
});
