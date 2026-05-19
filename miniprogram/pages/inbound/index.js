const api = require("../../utils/api");

const CART_KEY = "dealerOrderCart";

function cartKey(item) {
  return [item.inventoryType || "", item.batchNo || "", item.model || ""].join("|");
}

Page({
  data: {
    loading: true,
    isLoggedIn: false,
    canViewInbound: false,
    accountName: "",
    loadError: "",
    plans: [],
    filteredPlans: [],
    openedId: "",
    modelOptions: [],
    selectedModel: "",
    selectedModelIndex: 0,
    emptyDesc: "",
    cartCount: 0,
    quantityModalVisible: false,
    pendingItem: null,
    selectedQuantity: 1,
    selectedAvailable: 0
  },

  onShow() {
    this.refreshCartCount();
    getApp().getSession(account => {
      if (!account) {
        this.setData({ loading: false, isLoggedIn: false, canViewInbound: false, accountName: "", loadError: "", plans: [] });
        return;
      }
      if (account.role !== "regional_manager") {
        this.setData({
          loading: false,
          isLoggedIn: true,
          canViewInbound: false,
          accountName: account.name || account.phone || "经销商",
          loadError: "",
          plans: [],
          filteredPlans: [],
          emptyDesc: "普通经销商不可查看预计入库，请从首页选择机型提交需求单。"
        });
        return;
      }
      this.setData({ isLoggedIn: true, canViewInbound: true, accountName: account.name || account.phone || "经销商", loadError: "" });
      this.loadPageData();
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

  loadPageData() {
    this.setData({ loading: true, loadError: "" });
    Promise.all([api.getInboundPlans(), api.getModelOptions()])
      .then(([plansRes, modelsRes]) => {
        const plans = plansRes.data || [];
        const modelOptions = ["全部机型"].concat(modelsRes.data || []);
        this.setData({ loading: false, loadError: "", plans, modelOptions, selectedModelIndex: 0, selectedModel: "", openedId: plans.length ? plans[0].id : "" });
        this.applyModelFilter();
      })
      .catch(err => {
        this.setData({ loading: false, loadError: err.message || "加载失败", plans: [] });
      });
  },

  loadPlans() {
    this.loadPageData();
  },

  onModelChange(e) {
    const index = Number(e.detail.value || 0);
    const model = this.data.modelOptions[index] || "全部机型";
    this.setData({ selectedModelIndex: index, selectedModel: model === "全部机型" ? "" : model });
    this.applyModelFilter();
  },

  clearModelFilter() {
    this.setData({ selectedModelIndex: 0, selectedModel: "" });
    this.applyModelFilter();
  },

  applyModelFilter() {
    const selectedModel = this.data.selectedModel;
    let filteredPlans = this.data.plans || [];
    if (selectedModel) {
      filteredPlans = filteredPlans
        .map(plan => Object.assign({}, plan, { items: (plan.items || []).filter(item => item.model === selectedModel) }))
        .filter(plan => plan.items.length > 0);
    }
    this.setData({
      filteredPlans,
      openedId: filteredPlans.length ? filteredPlans[0].id : "",
      emptyDesc: "当前账号：" + this.data.accountName + (selectedModel ? "，筛选机型：" + selectedModel : "")
    });
  },

  goLogin() {
    wx.switchTab({ url: "/pages/index/index" });
  },

  goCart() {
    wx.navigateTo({ url: "/pages/order-create/index" });
  },

  togglePlan(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ openedId: this.data.openedId === id ? "" : id });
  },

  createOrder(e) {
    const dataset = e.currentTarget.dataset;
    const item = {
      model: dataset.model,
      batchNo: dataset.batchNo,
      eta: dataset.eta,
      inventoryType: dataset.inventoryType,
      available: Number(dataset.available || 0),
      quantity: 1
    };
    if (!item.model || item.available <= 0) {
      wx.showToast({ title: "当前机型暂无可用数量", icon: "none" });
      return;
    }
    const cart = this.getCart();
    const key = cartKey(item);
    const existing = cart.find(row => cartKey(row) === key);
    const remaining = item.available - Number(existing && existing.quantity || 0);
    if (remaining <= 0) {
      wx.showToast({ title: "已达到可用数量上限", icon: "none" });
      return;
    }

    this.setData({
      quantityModalVisible: true,
      pendingItem: item,
      selectedQuantity: 1,
      selectedAvailable: remaining
    });
  },

  closeQuantityModal() {
    this.setData({
      quantityModalVisible: false,
      pendingItem: null,
      selectedQuantity: 1,
      selectedAvailable: 0
    });
  },

  stopModalTap() {},

  decreaseQuantity() {
    const next = Math.max(1, Number(this.data.selectedQuantity || 1) - 1);
    this.setData({ selectedQuantity: next });
  },

  increaseQuantity() {
    const max = Number(this.data.selectedAvailable || 1);
    const next = Math.min(max, Number(this.data.selectedQuantity || 1) + 1);
    if (next >= max) {
      wx.showToast({ title: "不能超过可用数量", icon: "none" });
    }
    this.setData({ selectedQuantity: next });
  },

  onQuantityInput(e) {
    const max = Number(this.data.selectedAvailable || 1);
    let value = parseInt(e.detail.value, 10);
    if (isNaN(value)) {
      value = 1;
    }
    value = Math.max(1, Math.min(max, value));
    this.setData({ selectedQuantity: value });
  },

  confirmAddToCart() {
    const item = this.data.pendingItem;
    if (!item) {
      this.closeQuantityModal();
      return;
    }

    const quantity = Number(this.data.selectedQuantity || 1);
    const cart = this.getCart();
    const key = cartKey(item);
    const existing = cart.find(row => cartKey(row) === key);
    if (existing) {
      existing.quantity = Number(existing.quantity || 0) + quantity;
      existing.available = item.available;
    } else {
      cart.push(Object.assign({}, item, { quantity }));
    }

    this.saveCart(cart);
    this.closeQuantityModal();
    wx.showToast({ title: "已加入购物车", icon: "success" });
  }
});
