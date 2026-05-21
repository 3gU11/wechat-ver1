const api = require("../../utils/api");

const HIDDEN_ORDER_STATUSES = ["reject", "rejected", "regional_rejected", "complete", "completed"];
const COMPLETED_STATUSES = ["complete", "completed"];

function isHiddenOrderStatus(status) {
  const value = String(status || "").toLowerCase();
  return HIDDEN_ORDER_STATUSES.indexOf(value) !== -1 || value.endsWith("_rejected") || value.endsWith("_reject");
}

function isCompletedStatus(status) {
  return COMPLETED_STATUSES.indexOf(String(status || "").toLowerCase()) !== -1;
}

function prepareOrder(order) {
  const completed = isCompletedStatus(order.status);
  const factoryPending = !completed && Number(order.factoryPending || 0) === 1;
  return Object.assign({}, order, {
    displayStatus: factoryPending ? "factory_pending" : order.status,
    canEditExtraRemark: !completed,
    items: (order.items || []).map(line => Object.assign({}, line, {
      extraRemarkDraft: line.extraRemark || "",
      ERMQDraft: Number(line.ERMQ || 0)
    }))
  });
}

Page({
  data: {
    orders: [],
    loading: true,
    isRegionalManager: false,
    reviewingId: "",
    savingRemarkId: "",
    statusMap: {
      regional_pending: "待大区分配",
      regional_rejected: "大区驳回",
      pending: "待审核",
      approved: "已通过",
      partial_allocated: "部分配货",
      allocated: "已配货",
      factory_pending: "新备注审核中",
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
          return !isHiddenOrderStatus(order.status);
        }).map(prepareOrder);
        this.setData({ loading: false, orders });
      })
      .catch(err => {
        this.setData({ loading: false });
        wx.showToast({ title: err.message || "加载失败", icon: "none" });
      });
  },

  onExtraRemarkInput(e) {
    const orderIndex = Number(e.currentTarget.dataset.orderIndex);
    const lineIndex = Number(e.currentTarget.dataset.lineIndex);
    this.setData({
      ["orders[" + orderIndex + "].items[" + lineIndex + "].extraRemarkDraft"]: e.detail.value
    });
  },

  changeERMQ(e) {
    const orderIndex = Number(e.currentTarget.dataset.orderIndex);
    const lineIndex = Number(e.currentTarget.dataset.lineIndex);
    const delta = Number(e.currentTarget.dataset.delta);
    const line = this.data.orders[orderIndex] && this.data.orders[orderIndex].items[lineIndex];
    if (!line) return;
    const quantity = Number(line.quantity || 0);
    const next = Math.max(0, Math.min(quantity, Number(line.ERMQDraft || 0) + delta));
    this.setData({
      ["orders[" + orderIndex + "].items[" + lineIndex + "].ERMQDraft"]: next
    });
  },

  onERMQInput(e) {
    const orderIndex = Number(e.currentTarget.dataset.orderIndex);
    const lineIndex = Number(e.currentTarget.dataset.lineIndex);
    const line = this.data.orders[orderIndex] && this.data.orders[orderIndex].items[lineIndex];
    if (!line) return;
    const quantity = Number(line.quantity || 0);
    const value = Math.max(0, Math.min(quantity, Math.trunc(Number(e.detail.value || 0))));
    this.setData({
      ["orders[" + orderIndex + "].items[" + lineIndex + "].ERMQDraft"]: value
    });
  },

  saveExtraRemarks(e) {
    const orderIndex = Number(e.currentTarget.dataset.orderIndex);
    const order = this.data.orders[orderIndex];
    if (!order) return;
    const items = (order.items || []).map(line => ({
      lineNo: line.lineNo,
      extraRemark: line.extraRemarkDraft || "",
      ERMQ: Number(line.ERMQDraft || 0)
    }));
    this.setData({ savingRemarkId: order.id });
    api.updateOrderExtraRemarks(order.id, items)
      .then(() => {
        wx.showToast({ title: "附加备注已保存" });
        this.setData({ savingRemarkId: "" });
        this.loadOrders();
      })
      .catch(err => {
        this.setData({ savingRemarkId: "" });
        wx.showToast({ title: err.message || "保存失败", icon: "none" });
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
