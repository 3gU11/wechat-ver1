const api = require("../../utils/api");
const orderUtil = require("../../utils/order");

Page({
  data: {
    rawOrders: [],
    orders: [],
    keyword: "",
    loading: true,
    statusMap: {
      complete: "已完成",
      completed: "已完成"
    }
  },

  onShow() {
    getApp().getSession(account => {
      if (!account) {
        this.setData({ loading: false, rawOrders: [], orders: [] });
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
        const rows = Array.isArray(res.data) ? res.data : (res.data && res.data.data || []);
        const rawOrders = rows.filter(order => orderUtil.isCompletedStatus(order.status)).map(orderUtil.prepareOrder);
        this.setData({ loading: false, rawOrders }, () => this.applyFilters());
      })
      .catch(err => {
        this.setData({ loading: false });
        wx.showToast({ title: err.message || "加载失败", icon: "none" });
      });
  },

  applyFilters() {
    const orders = (this.data.rawOrders || []).filter(order => orderUtil.orderMatchesKeyword(order, this.data.keyword));
    this.setData({ orders });
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value }, () => this.applyFilters());
  },

  clearKeyword() {
    this.setData({ keyword: "" }, () => this.applyFilters());
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: "/pages/order-detail/index?orderNo=" + encodeURIComponent(id) });
  }
});
