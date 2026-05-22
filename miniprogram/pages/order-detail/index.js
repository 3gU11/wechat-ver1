const api = require("../../utils/api");
const orderUtil = require("../../utils/order");

Page({
  data: {
    orderNo: "",
    order: null,
    loading: true,
    notFound: false,
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
      completed: "已完成",
      complete: "已完成"
    }
  },

  onLoad(options) {
    this.setData({ orderNo: decodeURIComponent(options.orderNo || "") });
  },

  onShow() {
    this.loadOrder();
  },

  loadOrder() {
    this.setData({ loading: true, notFound: false });
    api.getOrders()
      .then(res => {
        const rows = Array.isArray(res.data) ? res.data : (res.data && res.data.data || []);
        const order = rows.find(item => item.id === this.data.orderNo);
        if (!order) {
          this.setData({ loading: false, order: null, notFound: true });
          return;
        }
        this.setData({ loading: false, order: orderUtil.prepareOrder(order), notFound: false });
      })
      .catch(err => {
        this.setData({ loading: false, notFound: true });
        wx.showToast({ title: err.message || "加载失败", icon: "none" });
      });
  }
});
