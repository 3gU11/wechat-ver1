const api = require("../../utils/api");
const orderUtil = require("../../utils/order");

Page({
  data: {
    rawOrders: [],
    orders: [],
    loading: true,
    isRegionalManager: false,
    reviewingId: "",
    savingRemarkId: "",
    keyword: "",
    statusFilter: "all",
    statusOptions: [
      { label: "全部", value: "all" },
      { label: "待大区分配", value: "regional_pending" },
      { label: "待审核", value: "pending" },
      { label: "已通过", value: "approved" },
      { label: "部分配货", value: "partial_allocated" },
      { label: "已配货", value: "allocated" },
      { label: "新备注审核中", value: "factory_pending" }
    ],
    statusIndex: 0,
    refreshedAt: "",
    statusMap: {
      regional_pending: "待大区分配",
      regional_rejected: "大区驳回",
      pending: "待审核",
      approved: "已通过",
      contracted: "已签合同",
      partial_allocated: "部分配货",
      allocated: "已配货",
      factory_pending: "新备注审核中",
      rejected: "已驳回",
      cancelled: "已取消",
      completed: "已完成",
      complete: "已完成"
    }
  },

  onShow() {
    getApp().getSession(account => {
      api.refreshRegionalPendingBadge();
      if (!account) {
        this.setData({ loading: false, rawOrders: [], orders: [], isRegionalManager: false });
        return;
      }
      this.setData({ isRegionalManager: account.role === "regional_manager" });
      this.loadOrders();
    });
  },

  onPullDownRefresh() {
    this.loadOrders({ pullDown: true });
  },

  loadOrders(options = {}) {
    if (!options.pullDown) this.setData({ loading: true });
    api.getOrders()
      .then(res => {
        const rows = Array.isArray(res.data) ? res.data : (res.data && res.data.data || []);
        const rawOrders = rows
          .filter(order => !orderUtil.isRejectedStatus(order.status) && !orderUtil.isCompletedStatus(order.status))
          .map(orderUtil.prepareOrder);
        this.setData({
          loading: false,
          rawOrders,
          refreshedAt: new Date().toTimeString().slice(0, 5)
        }, () => this.applyFilters());
        api.refreshRegionalPendingBadge();
        if (options.pullDown) {
          wx.showToast({ title: "已刷新", icon: "none" });
        }
      })
      .catch(err => {
        this.setData({ loading: false });
        wx.showToast({ title: err.message || "加载失败", icon: "none" });
      })
      .finally(() => {
        if (options.pullDown) wx.stopPullDownRefresh();
      });
  },

  applyFilters() {
    const orders = (this.data.rawOrders || []).filter(order => {
      return orderUtil.orderMatchesKeyword(order, this.data.keyword) &&
        orderUtil.orderMatchesStatus(order, this.data.statusFilter);
    });
    this.setData({ orders });
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value }, () => this.applyFilters());
  },

  clearKeyword() {
    this.setData({ keyword: "" }, () => this.applyFilters());
  },

  onStatusChange(e) {
    const statusIndex = Number(e.detail.value || 0);
    const status = this.data.statusOptions[statusIndex] || this.data.statusOptions[0];
    this.setData({ statusIndex, statusFilter: status.value }, () => this.applyFilters());
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
    wx.showModal({
      title: "确认保存",
      content: "保存后该订单将提交附加备注更新，请确认是否继续。",
      confirmText: "保存",
      confirmColor: "#1f4f9a",
      success: modal => {
        if (!modal.confirm) return;
        this.setData({ savingRemarkId: order.id });
        api.updateOrderExtraRemarks(order.id, items)
          .then(() => {
            wx.showToast({ title: "附加备注已保存" });
            this.setData({ savingRemarkId: "" });
            api.refreshRegionalPendingBadge();
            this.loadOrders();
          })
          .catch(err => {
            this.setData({ savingRemarkId: "" });
            wx.showToast({ title: err.message || "保存失败", icon: "none" });
          });
      }
    });
  },

  goCreate() {
    wx.navigateTo({ url: "/pages/order-create/index" });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: "/pages/order-detail/index?orderNo=" + encodeURIComponent(id) });
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
            api.refreshRegionalPendingBadge();
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
