const api = require("../../utils/api");

const CART_KEY = "dealerOrderCart";

function cartKey(item) {
  return [item.inventoryType || "", item.batchNo || "", item.model || ""].join("|");
}

Page({
  data: {
    cart: [],
    totalQty: 0,
    form: {
      customerName: "",
      contactName: "",
      contactPhone: "",
      deliveryDate: "",
      remark: ""
    },
    submitting: false
  },

  onLoad(options) {
    getApp().getSession(account => {
      if (!account) {
        wx.showToast({ title: "请先登录", icon: "none" });
        wx.switchTab({ url: "/pages/index/index" });
        return;
      }
      if (options.model) {
        this.addInitialItem(options);
      }
      this.loadCart();
    });
  },

  getCart() {
    return wx.getStorageSync(CART_KEY) || [];
  },

  saveCart(cart) {
    wx.setStorageSync(CART_KEY, cart);
    this.setData({ cart, totalQty: cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0) });
  },

  loadCart() {
    this.saveCart(this.getCart());
  },

  addInitialItem(options) {
    const item = {
      model: options.model,
      batchNo: options.batchNo || "",
      eta: options.eta || "",
      inventoryType: options.inventoryType || "",
      available: Number(options.available || 1),
      quantity: 1
    };
    const cart = this.getCart();
    const key = cartKey(item);
    const existing = cart.find(row => cartKey(row) === key);
    if (existing) {
      existing.quantity = Math.min(Number(existing.available || item.available || 1), Number(existing.quantity || 0) + 1);
    } else {
      cart.push(item);
    }
    wx.setStorageSync(CART_KEY, cart);
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ["form." + field]: e.detail.value });
  },

  changeQty(e) {
    const index = Number(e.currentTarget.dataset.index);
    const delta = Number(e.currentTarget.dataset.delta);
    const cart = this.data.cart.slice();
    const item = cart[index];
    if (!item) return;
    const nextQty = Number(item.quantity || 0) + delta;
    if (nextQty < 1) {
      cart.splice(index, 1);
      this.saveCart(cart);
      return;
    }
    if (nextQty > Number(item.available || 0)) {
      wx.showToast({ title: "不能超过可用数量", icon: "none" });
      return;
    }
    item.quantity = nextQty;
    this.saveCart(cart);
  },

  removeItem(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cart = this.data.cart.slice();
    cart.splice(index, 1);
    this.saveCart(cart);
  },

  submit() {
    const form = this.data.form;
    const cart = this.data.cart;
    if (!cart.length) {
      wx.showToast({ title: "购物车为空", icon: "none" });
      return;
    }
    if (!form.customerName || !form.contactName || !form.contactPhone) {
      wx.showToast({ title: "请填写客户、联系人和电话", icon: "none" });
      return;
    }
    for (const item of cart) {
      if (Number(item.quantity || 0) > Number(item.available || 0)) {
        wx.showToast({ title: item.model + " 超过可用数量", icon: "none" });
        return;
      }
    }

    this.setData({ submitting: true });
    api.createOrder({
      customerName: form.customerName,
      contactName: form.contactName,
      contactPhone: form.contactPhone,
      deliveryDate: form.deliveryDate,
      remark: form.remark,
      items: cart.map(item => ({
        model: item.model,
        batchNo: item.batchNo,
        eta: item.eta,
        inventoryType: item.inventoryType,
        quantity: Number(item.quantity || 1)
      }))
    }).then(res => {
      this.setData({ submitting: false });
      wx.removeStorageSync(CART_KEY);
      this.saveCart([]);
      wx.showModal({
        title: "提交成功",
        content: res.data.message || "订单已提交",
        showCancel: false,
        success() {
          wx.switchTab({ url: "/pages/orders/index" });
        }
      });
    }).catch(err => {
      this.setData({ submitting: false });
      wx.showToast({ title: err.message || "提交失败", icon: "none" });
    });
  }
});
