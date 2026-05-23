const COMPLETED_STATUSES = ["complete", "completed", "done", "finish", "finished"];
const STATUS_ALIASES = {
  complete: "completed",
  done: "completed",
  finish: "completed",
  finished: "completed",
  reject: "rejected",
  regional_reject: "regional_rejected"
};

function text(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function isCompletedStatus(status) {
  return COMPLETED_STATUSES.indexOf(text(status).toLowerCase()) !== -1;
}

function normalizeStatus(status) {
  const value = text(status).toLowerCase();
  return STATUS_ALIASES[value] || value;
}

function isRejectedStatus(status) {
  const value = normalizeStatus(status);
  return value === "reject" || value === "rejected" || value.endsWith("_reject") || value.endsWith("_rejected");
}

function getDisplayStatus(order) {
  if (isCompletedStatus(order && order.status)) return "completed";
  if (order && Number(order.factoryPending || 0) === 1) return "factory_pending";
  return normalizeStatus(order && order.status);
}

function canEditExtraRemark(order) {
  return !isCompletedStatus(order && order.status);
}

function formatInventoryType(type) {
  if (type === "finished") return "成品现货";
  if (type === "heightened") return "加高";
  if (type === "wip") return "在制";
  return text(type) || "未记录";
}

function normalizeOrderItems(order) {
  return (order && order.items || []).map(line => Object.assign({}, line, {
    inventoryTypeText: formatInventoryType(line.inventoryType),
    extraRemarkDraft: line.extraRemark || "",
    ERMQDraft: Number(line.ERMQ || 0)
  }));
}

function prepareOrder(order) {
  const displayStatus = getDisplayStatus(order);
  return Object.assign({}, order, {
    displayStatus,
    canEditExtraRemark: canEditExtraRemark(order),
    items: normalizeOrderItems(order)
  });
}

function orderSearchText(order) {
  const items = order && order.items || [];
  return [
    order.id,
    order.customerName,
    order.contactName,
    order.contactPhone,
    order.dealerName,
    order.regionalManagerName,
    order.remark,
    order.regionalReviewNote,
    order.model,
    order.batchNo
  ].concat(items.reduce((all, item) => {
    return all.concat([
      item.model,
      item.batchNo,
      item.eta,
      item.inventoryType,
      item.remark,
      item.extraRemark
    ]);
  }, [])).map(text).join(" ").toLowerCase();
}

function orderMatchesKeyword(order, keyword) {
  const value = text(keyword).toLowerCase();
  if (!value) return true;
  return orderSearchText(order).indexOf(value) !== -1;
}

function orderMatchesStatus(order, status) {
  const value = text(status);
  if (!value || value === "all") return true;
  return getDisplayStatus(order) === value;
}

module.exports = {
  isCompletedStatus,
  isRejectedStatus,
  normalizeStatus,
  getDisplayStatus,
  canEditExtraRemark,
  formatInventoryType,
  normalizeOrderItems,
  prepareOrder,
  orderMatchesKeyword,
  orderMatchesStatus
};
