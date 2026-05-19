const api = require("../../utils/api");

const HIDDEN_ORDER_STATUSES = ["rejected", "regional_rejected", "complete", "completed"];

Page({
  data: {
    orders: [],
    loading: true,
    isRegionalManager: false,
    reviewingId: "",
    statusMap: {
      regional_pending: "待大区分配",
      regional_rejected: "大区驳回",
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
        this.setData({ loading: false, orders: [], isRegionalManager: false });
        return;
      }
      this.setData({ isRegionalManager: account.role === "regional_manager" });
      this.loadOrders();
    });
  },

  loadOrders() {
    this.setData({ loading: true });
    api.getOrders()
      .then(res => {
        const orders = (res.data || []).filter(order => {
          return HIDDEN_ORDER_STATUSES.indexOf(order.status) === -1;
        });
        this.setData({ loading: false, orders });
      })
      .catch(err => {
        this.setData({ loading: false });
        wx.showToast({ title: err.message || "加载失败", icon: "none" });
      });
  },

  goCreate() {
    wx.navigateTo({ url: "/pages/order-create/index" });
  },

  goAllocate(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: "/pages/order-allocate/index?orderNo=" + encodeURIComponent(id) });
  },

  reviewOrder(e) {
    const id = e.currentTarget.dataset.id;
    const status = e.currentTarget.dataset.status;
    const title = status === "approved" ? "通过初审" : "驳回订单";
    const placeholderText = status === "approved" ? "填写初审备注（可选）" : "填写驳回原因（可选）";
    wx.showModal({
      title,
      editable: true,
      placeholderText,
      confirmText: status === "approved" ? "通过" : "驳回",
      confirmColor: status === "approved" ? "#1f4f9a" : "#b42318",
      success: modal => {
        if (!modal.confirm) return;
        this.setData({ reviewingId: id });
        api.reviewDealerOrder(id, status, modal.content || "")
          .then(() => {
            this.setData({ reviewingId: "" });
            wx.showToast({ title: status === "approved" ? "已通过" : "已驳回" });
            this.loadOrders();
          })
          .catch(err => {
            this.setData({ reviewingId: "" });
            wx.showToast({ title: err.message || "审核失败", icon: "none" });
          });
      }
    });
  }
});
