const api = require("../../utils/api");

Page({
  data: {
    orders: [],
    loading: true,
    statusMap: {
      pending: "待审核",
      approved: "已通过",
      partial_allocated: "部分配货",
      allocated: "已配货",
      rejected: "已驳回",
      cancelled: "已取消"
    }
  },

  onShow() {
    getApp().getSession(account => {
      if (!account) {
        this.setData({ loading: false, orders: [] });
        return;
      }
      this.loadOrders();
    });
  },

  loadOrders() {
    this.setData({ loading: true });
    api.getOrders()
      .then(res => {
        this.setData({ loading: false, orders: res.data || [] });
      })
      .catch(err => {
        this.setData({ loading: false });
        wx.showToast({ title: err.message || "加载失败", icon: "none" });
      });
  },

  goCreate() {
    wx.navigateTo({ url: "/pages/order-create/index" });
  }
});
