const api = require("../../utils/api");

function allocationKey(item) {
  return [item.inventoryType || "", item.batchNo || "", item.eta || "", item.model || ""].join("|");
}

function inventoryTypeText(type) {
  if (type === "finished") return "成品现货";
  if (type === "heightened") return "加高";
  return "在制";
}

function baseModelName(model) {
  return String(model || "").replace(/\(加高\)|（加高）/g, "");
}

function isHeightenedLine(line) {
  const model = String(line && line.model || "");
  return !!line && (line.inventoryType === "heightened" || model.indexOf("(加高)") !== -1 || model.indexOf("（加高）") !== -1);
}

Page({
  data: {
    orderNo: "",
    order: null,
    lines: [],
    loading: true,
    submitting: false,
    note: "",
    canSubmit: false
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
        this.setData({ loading: false, order, lines }, () => this.updateSubmitState());
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
    const demandType = isHeightenedLine(line) ? "heightened" : "standard";
    const lineModel = baseModelName(line.model);
    const candidates = batches
      .filter(item => {
        if (baseModelName(item.model) !== lineModel || Number(item.available || 0) <= 0) return false;
        if (demandType === "heightened") return item.inventoryType === "heightened";
        return item.inventoryType !== "heightened";
      })
      .map(item => Object.assign({}, item, {
        key: allocationKey(item),
        recommended: Number(item.available || 0) >= demand,
        selected: false,
        quantity: 0
      }))
      .sort((a, b) => {
        if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
        if (a.recommended) return String(a.eta).localeCompare(String(b.eta), "zh-CN", { numeric: true });
        if (Number(a.available) !== Number(b.available)) return Number(b.available) - Number(a.available);
        return String(a.eta).localeCompare(String(b.eta), "zh-CN", { numeric: true });
      });

    return {
      lineNo: line.lineNo,
      model: lineModel,
      displayModel: demandType === "heightened" ? lineModel + "（加高）" : lineModel,
      inventoryType: line.inventoryType,
      demand,
      opened: false,
      assigned: 0,
      remaining: demand,
      candidates
    };
  },

  toggleLine(e) {
    const index = Number(e.currentTarget.dataset.lineIndex);
    const lines = (this.data.lines || []).slice();
    const line = lines[index];
    if (!line) return;
    lines[index] = Object.assign({}, line, { opened: !line.opened });
    this.setData({ lines });
  },

  changeQty(e) {
    const lineIndex = Number(e.currentTarget.dataset.lineIndex);
    const batchIndex = Number(e.currentTarget.dataset.batchIndex);
    const delta = Number(e.currentTarget.dataset.delta);
    const lines = (this.data.lines || []).slice();
    const line = lines[lineIndex] ? this.cloneLine(lines[lineIndex]) : null;
    const batch = line && line.candidates && line.candidates[batchIndex];
    if (!line || !batch) return;

    const current = Number(batch.quantity || 0);
    const otherAssigned = this.getOtherAssigned(line, batchIndex);
    const maxByDemand = Math.max(0, Number(line.demand || 0) - otherAssigned);
    const max = Math.min(Number(batch.available || 0), maxByDemand);
    const next = Math.max(0, Math.min(max, current + delta));
    if (current + delta > max) {
      wx.showToast({ title: "不能超过该机型剩余需求", icon: "none" });
    }
    batch.quantity = next;
    batch.selected = next > 0;
    this.recalculateLine(lineIndex, line, lines);
  },

  onQtyInput(e) {
    const lineIndex = Number(e.currentTarget.dataset.lineIndex);
    const batchIndex = Number(e.currentTarget.dataset.batchIndex);
    const lines = (this.data.lines || []).slice();
    const line = lines[lineIndex] ? this.cloneLine(lines[lineIndex]) : null;
    const batch = line && line.candidates && line.candidates[batchIndex];
    if (!line || !batch) return;

    let value = parseInt(e.detail.value, 10);
    if (isNaN(value)) value = 0;
    const otherAssigned = this.getOtherAssigned(line, batchIndex);
    const maxByDemand = Math.max(0, Number(line.demand || 0) - otherAssigned);
    const max = Math.min(Number(batch.available || 0), maxByDemand);
    batch.quantity = Math.max(0, Math.min(max, value));
    batch.selected = batch.quantity > 0;
    this.recalculateLine(lineIndex, line, lines);
  },

  getOtherAssigned(line, batchIndex) {
    return (line.candidates || []).reduce((sum, item, index) => {
      return index === batchIndex ? sum : sum + Number(item.quantity || 0);
    }, 0);
  },

  cloneLine(line) {
    return Object.assign({}, line, {
      candidates: (line.candidates || []).map(item => Object.assign({}, item))
    });
  },

  recalculateLine(lineIndex, line, lines) {
    line.assigned = (line.candidates || []).reduce((sum, item) => {
      item.selected = Number(item.quantity || 0) > 0;
      return sum + Number(item.quantity || 0);
    }, 0);
    line.remaining = Math.max(0, Number(line.demand || 0) - Number(line.assigned || 0));
    const nextLines = lines || (this.data.lines || []).slice();
    nextLines[lineIndex] = line;
    this.setData({ lines: nextLines }, () => this.updateSubmitState());
  },

  updateSubmitState() {
    const lines = this.data.lines || [];
    const canSubmit = !!lines.length && lines.every(line => {
      return Number(line.assigned || 0) === Number(line.demand || 0);
    });
    this.setData({ canSubmit });
  },

  onNoteInput(e) {
    this.setData({ note: e.detail.value });
  },

  submit() {
    if (this.data.submitting || this.data.loading) return;

    const invalid = this.data.lines.find(line => Number(line.assigned || 0) !== Number(line.demand || 0));
    if (invalid) {
      const diff = Number(invalid.demand || 0) - Number(invalid.assigned || 0);
      wx.showToast({
        title: diff > 0 ? invalid.model + " 还差 " + diff + " 台" : invalid.model + " 超出 " + Math.abs(diff) + " 台",
        icon: "none"
      });
      return;
    }

    const items = this.data.lines.map(line => ({
      lineNo: line.lineNo,
      model: line.model,
      allocations: line.candidates
        .filter(batch => Number(batch.quantity || 0) > 0)
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
        api.refreshRegionalPendingBadge();
        wx.navigateBack();
      })
      .catch(err => {
        this.setData({ submitting: false });
        wx.showToast({ title: err.message || "提交失败", icon: "none" });
      });
  }
});
