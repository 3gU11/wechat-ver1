const api = require("../../utils/api");

const CART_KEY = "dealerOrderCart";

Page({
  data: {
    loading: true,
    modelKeyword: "",
    models: [],
    cartCount: 0,
    quantityModalVisible: false,
    pendingModel: "",
    selectedQuantity: 1
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
    this.refreshCartCount();
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

  getCart() {
    return wx.getStorageSync(CART_KEY) || [];
  },

  saveCart(cart) {
    wx.setStorageSync(CART_KEY, cart);
    this.setData({ cartCount: cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0) });
  },

  refreshCartCount() {
    const cart = this.getCart();
    this.setData({ cartCount: cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0) });
  },

  openQuantityModal(e) {
    this.setData({
      quantityModalVisible: true,
      pendingModel: e.currentTarget.dataset.model,
      selectedQuantity: 0
    });
  },

  closeQuantityModal() {
    this.setData({
      quantityModalVisible: false,
      pendingModel: "",
      selectedQuantity: 0
    });
  },

  stopModalTap() {},

  decreaseQuantity() {
    this.setData({ selectedQuantity: Math.max(0, Number(this.data.selectedQuantity || 0) - 1) });
  },

  increaseQuantity() {
    this.setData({ selectedQuantity: Number(this.data.selectedQuantity || 0) + 1 });
  },

  onQuantityInput(e) {
    let value = parseInt(e.detail.value, 10);
    if (isNaN(value)) value = 0;
    this.setData({ selectedQuantity: Math.max(0, value) });
  },

  addPendingToCart() {
    const model = this.data.pendingModel;
    const quantity = Number(this.data.selectedQuantity || 0);
    if (!model) return;
    if (quantity <= 0) {
      wx.showToast({ title: "请填写数量", icon: "none" });
      return;
    }
    const cart = wx.getStorageSync(CART_KEY) || [];
    const existing = cart.find(item => item.model === model);
    if (existing) {
      existing.quantity = Number(existing.quantity || 0) + quantity;
    } else {
      cart.push({ model, quantity });
    }
    this.saveCart(cart);
    this.closeQuantityModal();
    wx.showToast({ title: "已加入购物车", icon: "success" });
  },

  submitPendingOrder() {
    this.addPendingToCart();
    wx.navigateTo({ url: "/pages/order-create/index" });
  },

  goCart() {
    wx.navigateTo({ url: "/pages/order-create/index" });
  }
});
