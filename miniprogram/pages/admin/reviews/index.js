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

  changePassword(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: "修改密码",
      editable: true,
      placeholderText: "请输入新密码",
      confirmText: "保存",
      success: modal => {
        if (!modal.confirm) return;
        const password = (modal.content || "").trim();
        if (!password) {
          wx.showToast({ title: "请输入新密码", icon: "none" });
          return;
        }
        api.updateDealerPassword(id, password)
          .then(() => {
            wx.showToast({ title: "密码已修改" });
          })
          .catch(err => {
            wx.showToast({ title: err.message || "修改失败", icon: "none" });
          });
      }
    });
  },

  deleteAccount(e) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name || "该账号";
    wx.showModal({
      title: "删除账号",
      content: "确认删除 " + name + "？删除后不可恢复。",
      confirmText: "删除",
      confirmColor: "#b42318",
      success: modal => {
        if (!modal.confirm) return;
        api.deleteDealerApplication(id)
          .then(() => {
            wx.showToast({ title: "已删除" });
            this.loadApplications();
          })
          .catch(err => {
            wx.showToast({ title: err.message || "删除失败", icon: "none" });
          });
      }
    });
  },

  logout() {
    getApp().clearSession();
    wx.redirectTo({ url: "/pages/auth/login/index" });
  }
});
