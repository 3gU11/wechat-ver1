const api = require("../../utils/api");

Page({
  data: {
    loading: true,
    modelKeyword: "",
    models: []
  },

  onShow() {
    if (!api.requireLogin()) {
      wx.redirectTo({ url: "/pages/auth/login/index" });
      return;
    }
    if (api.isAdmin()) {
      wx.redirectTo({ url: "/pages/admin/reviews/index" });
      return;
    }
    this.loadModels();
  },

  onModelInput(e) {
    this.setData({ modelKeyword: e.detail.value });
  },

  search() {
    this.loadModels();
  },

  loadModels() {
    this.setData({ loading: true });
    api.getDealerInventory({
      model: this.data.modelKeyword
    }).then(res => {
      this.setData({
        loading: false,
        models: res.data || []
      });
    }).catch(err => {
      this.setData({ loading: false });
      wx.showToast({ title: err.message || "加载失败", icon: "none" });
    });
  },

  createOrder(e) {
    const model = e.currentTarget.dataset.model;
    wx.navigateTo({ url: "/pages/order-create/index?model=" + model });
  }
});
