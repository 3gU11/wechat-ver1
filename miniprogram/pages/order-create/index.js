const api = require("../../utils/api");

const CART_KEY = "dealerOrderCart";

function cartKey(item) {
  return [item.inventoryType || "", item.batchNo || "", item.model || ""].join("|");
}

function isHeightenedItem(item) {
  const model = item && item.model ? String(item.model) : "";
  return !!item && (item.inventoryType === "heightened" || model.indexOf("(加高)") !== -1 || model.indexOf("（加高）") !== -1);
}

function baseModelName(model) {
  return String(model || "").replace(/\(加高\)|（加高）/g, "");
}

function appendRemarkPart(parts, value) {
  const text = String(value || "").trim();
  if (text && parts.indexOf(text) === -1) {
    parts.push(text);
  }
}

function buildLineRemark(item, totalRemark) {
  const parts = [];
  const itemRemark = String(item && item.remark || "").trim();
  const orderRemark = String(totalRemark || "").trim();
  appendRemarkPart(parts, itemRemark);
  if (isHeightenedItem(item)) appendRemarkPart(parts, "加高");
  appendRemarkPart(parts, orderRemark);
  return parts.join("；");
}

function accountRegionalManagerName(account) {
  if (!account) return "";
  if (account.role === "regional_manager") {
    return account.contactName || account.name || "";
  }
  return account.regionalManagerName || "";
}

Page({
  data: {
    cart: [],
    totalQty: 0,
    regionalManagerName: "",
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
      this.setData({
        regionalManagerName: accountRegionalManagerName(account)
      });
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
      quantity: 1
    };
    const cart = this.getCart();
    const key = cartKey(item);
    const existing = cart.find(row => cartKey(row) === key);
    if (existing) {
      existing.quantity = Number(existing.quantity || 0) + 1;
    } else {
      cart.push(item);
    }
    wx.setStorageSync(CART_KEY, cart);
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ["form." + field]: e.detail.value });
  },

  onDeliveryDateChange(e) {
    this.setData({ "form.deliveryDate": e.detail.value });
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
    item.quantity = nextQty;
    this.saveCart(cart);
  },

  removeItem(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cart = this.data.cart.slice();
    cart.splice(index, 1);
    this.saveCart(cart);
  },

  onItemRemarkInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cart = this.data.cart.slice();
    if (!cart[index]) return;
    cart[index].remark = e.detail.value;
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
    if (!this.data.regionalManagerName) {
      wx.showToast({ title: "当前账号未绑定所属大区经理", icon: "none" });
      return;
    }
    this.setData({ submitting: true });
    api.createOrder({
      regionalManagerName: this.data.regionalManagerName,
      customerName: form.customerName,
      contactName: form.contactName,
      contactPhone: form.contactPhone,
      deliveryDate: form.deliveryDate,
      remark: form.remark,
      items: cart.map(item => ({
        model: baseModelName(item.model),
        batchNo: item.batchNo || "",
        eta: item.eta || "",
        inventoryType: item.inventoryType || "",
        quantity: Number(item.quantity || 1),
        demandType: isHeightenedItem(item) ? "heightened" : "",
        remark: buildLineRemark(item, form.remark)
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
      const message = err.message || "提交失败";
      if (message.indexOf("重新登录") !== -1 || message.indexOf("账号不存在") !== -1 || message.indexOf("已停用") !== -1) {
        getApp().clearSession();
        wx.showModal({
          title: "账号已失效",
          content: message,
          showCancel: false,
          success() {
            wx.switchTab({ url: "/pages/index/index" });
          }
        });
        return;
      }
      wx.showToast({ title: message, icon: "none" });
    });
  }
});
