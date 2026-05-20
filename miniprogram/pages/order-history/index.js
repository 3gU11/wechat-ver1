const api = require("../../utils/api");

const COMPLETED_STATUSES = ["complete", "completed"];

function isCompletedStatus(status) {
  return COMPLETED_STATUSES.indexOf(String(status || "").toLowerCase()) !== -1;
}

Page({
  data: {
    orders: [],
    loading: true,
    statusMap: {
      complete: "已完成",
      completed: "已完成"
    }
  },

  onShow() {
    getApp().getSession(account => {
      if (!account) {
        this.setData({ loading: false, orders: [] });
        wx.redirectTo({ url: "/pages/auth/login/index" });
        return;
      }
      this.loadOrders();
    });
  },

  loadOrders() {
    this.setData({ loading: true });
    api.getOrders()
      .then(res => {
        const orders = (res.data || []).filter(order => isCompletedStatus(order.status));
        this.setData({ loading: false, orders });
      })
      .catch(err => {
        this.setData({ loading: false });
        wx.showToast({ title: err.message || "加载失败", icon: "none" });
      });
  }
});
