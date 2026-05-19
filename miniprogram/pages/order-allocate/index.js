const api = require("../../utils/api");

function allocationKey(item) {
  return [item.inventoryType || "", item.batchNo || "", item.eta || "", item.model || ""].join("|");
}

function inventoryTypeText(type) {
  if (type === "finished") return "成品现货";
  if (type === "heightened") return "加高";
  return "在制";
}

Page({
  data: {
    orderNo: "",
    order: null,
    lines: [],
    loading: true,
    submitting: false,
    note: ""
  },

  onLoad(options) {
    this.setData({ orderNo: decodeURIComponent(options.orderNo || "") });
  },

  onShow() {
    getApp().getSession(account => {
      if (!account || account.role !== "regional_manager") {
        wx.redirectTo({ url: "/pages/auth/login/index" });
        return;
      }
      this.loadData();
    });
  },

  loadData() {
    this.setData({ loading: true });
    Promise.all([api.getOrders(), api.getInboundPlans()])
      .then(([ordersRes, plansRes]) => {
        const order = (ordersRes.data || []).find(item => item.id === this.data.orderNo);
        if (!order) {
          throw new Error("订单不存在或不属于当前大区经理");
        }
        const batches = this.flattenBatches(plansRes.data || []);
        const lines = (order.items || []).map(line => this.buildLine(line, batches));
        this.setData({ loading: false, order, lines });
      })
      .catch(err => {
        this.setData({ loading: false });
        wx.showToast({ title: err.message || "加载失败", icon: "none" });
      });
  },

  flattenBatches(plans) {
    const rows = [];
    (plans || []).forEach(plan => {
      (plan.items || []).forEach(item => {
        rows.push({
          model: item.model,
          batchNo: item.batchNo || plan.batchNo,
          eta: item.eta || plan.eta,
          inventoryType: item.heightened ? "heightened" : plan.inventoryType,
          inventoryTypeText: inventoryTypeText(item.heightened ? "heightened" : plan.inventoryType),
          available: Number(item.available || 0)
        });
      });
    });
    return rows;
  },

  buildLine(line, batches) {
    const demand = Number(line.quantity || 0);
    const candidates = batches
      .filter(item => item.model === line.model && item.available > 0)
      .map(item => Object.assign({}, item, {
        key: allocationKey(item),
        recommended: Number(item.available || 0) >= demand,
        selected: false,
        quantity: Math.min(demand, Number(item.available || 0))
      }))
      .sort((a, b) => {
        if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
        if (a.recommended) return String(a.eta).localeCompare(String(b.eta), "zh-CN", { numeric: true });
        if (Number(a.available) !== Number(b.available)) return Number(b.available) - Number(a.available);
        return String(a.eta).localeCompare(String(b.eta), "zh-CN", { numeric: true });
      });

    return {
      lineNo: line.lineNo,
      model: line.model,
      demand,
      opened: true,
      assigned: 0,
      candidates
    };
  },

  toggleLine(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ ["lines." + index + ".opened"]: !this.data.lines[index].opened });
  },

  toggleBatch(e) {
    const lineIndex = Number(e.currentTarget.dataset.lineIndex);
    const batchIndex = Number(e.currentTarget.dataset.batchIndex);
    const line = this.data.lines[lineIndex];
    const batch = line.candidates[batchIndex];
    batch.selected = !batch.selected;
    if (batch.selected) {
      const remaining = Math.max(0, Number(line.demand || 0) - Number(line.assigned || 0));
      batch.quantity = Math.min(remaining || line.demand, Number(batch.available || 0));
    }
    this.recalculateLine(lineIndex, line);
  },

  changeQty(e) {
    const lineIndex = Number(e.currentTarget.dataset.lineIndex);
    const batchIndex = Number(e.currentTarget.dataset.batchIndex);
    const delta = Number(e.currentTarget.dataset.delta);
    const line = this.data.lines[lineIndex];
    const batch = line.candidates[batchIndex];
    const next = Math.max(1, Math.min(Number(batch.available || 1), Number(batch.quantity || 1) + delta));
    batch.quantity = next;
    batch.selected = true;
    this.recalculateLine(lineIndex, line);
  },

  onQtyInput(e) {
    const lineIndex = Number(e.currentTarget.dataset.lineIndex);
    const batchIndex = Number(e.currentTarget.dataset.batchIndex);
    const line = this.data.lines[lineIndex];
    const batch = line.candidates[batchIndex];
    let value = parseInt(e.detail.value, 10);
    if (isNaN(value)) value = 1;
    batch.quantity = Math.max(1, Math.min(Number(batch.available || 1), value));
    batch.selected = true;
    this.recalculateLine(lineIndex, line);
  },

  recalculateLine(lineIndex, line) {
    line.assigned = (line.candidates || []).reduce((sum, item) => {
      return item.selected ? sum + Number(item.quantity || 0) : sum;
    }, 0);
    this.setData({ ["lines." + lineIndex]: line });
  },

  onNoteInput(e) {
    this.setData({ note: e.detail.value });
  },

  submit() {
    const invalid = this.data.lines.find(line => Number(line.assigned || 0) !== Number(line.demand || 0));
    if (invalid) {
      wx.showToast({ title: invalid.model + " 未分配满", icon: "none" });
      return;
    }

    const items = this.data.lines.map(line => ({
      lineNo: line.lineNo,
      model: line.model,
      allocations: line.candidates
        .filter(batch => batch.selected)
        .map(batch => ({
          model: line.model,
          batchNo: batch.batchNo,
          eta: batch.eta,
          inventoryType: batch.inventoryType,
          quantity: Number(batch.quantity || 0)
        }))
    }));

    this.setData({ submitting: true });
    api.allocateDealerOrder(this.data.orderNo, items, this.data.note)
      .then(() => {
        this.setData({ submitting: false });
        wx.showToast({ title: "已提交工厂审核" });
        wx.navigateBack();
      })
      .catch(err => {
        this.setData({ submitting: false });
        wx.showToast({ title: err.message || "提交失败", icon: "none" });
      });
  }
});
