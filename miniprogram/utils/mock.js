const dashboard = {
  finishedAvailable: 18,
  wipAvailable: 27,
  boundMachines: 42,
  pendingOrders: 5,
  updatedAt: "2026-05-16 14:30",
  categories: [
    { model: "DK7735", finished: 6, wip: 9 },
    { model: "DK7745", finished: 8, wip: 11 },
    { model: "DK7755", finished: 4, wip: 7 }
  ],
  batches: [
    { batchNo: "B2026051601", line: "装配一线", model: "DK7745", total: 12, available: 8, progress: 68, eta: "2026-05-22" },
    { batchNo: "B2026051502", line: "装配二线", model: "DK7735", total: 10, available: 6, progress: 45, eta: "2026-05-25" },
    { batchNo: "B2026051403", line: "调试线", model: "DK7755", total: 8, available: 5, progress: 82, eta: "2026-05-19" }
  ]
};

const machines = [
  { id: "M001", serialNo: "RJ-7745-260516-001", model: "DK7745", status: "finished", batchNo: "B2026051201", location: "成品库 A-03", available: true, bound: false, eta: "现货" },
  { id: "M002", serialNo: "RJ-7745-260516-002", model: "DK7745", status: "wip", batchNo: "B2026051601", location: "装配一线", available: true, bound: false, eta: "2026-05-22" },
  { id: "M003", serialNo: "RJ-7735-260515-007", model: "DK7735", status: "finished", batchNo: "B2026051102", location: "成品库 B-01", available: true, bound: false, eta: "现货" },
  { id: "M004", serialNo: "RJ-7755-260514-003", model: "DK7755", status: "wip", batchNo: "B2026051403", location: "调试线", available: true, bound: false, eta: "2026-05-19" }
];

const inboundPlans = [
  {
    id: "finished-stock",
    inventoryType: "finished",
    title: "成品现货",
    batchNo: "FINISHED-STOCK",
    eta: "现货",
    items: [
      { model: "DK7735", available: 6 },
      { model: "DK7745", available: 8 },
      { model: "DK7755", available: 4 }
    ]
  },
  {
    id: "B2026051403",
    inventoryType: "wip",
    title: "预计入库 2026-05-19",
    batchNo: "B2026051403",
    eta: "2026-05-19",
    items: [
      { model: "DK7755", available: 5 },
      { model: "DK7745", available: 2 }
    ]
  },
  {
    id: "B2026051601",
    inventoryType: "wip",
    title: "预计入库 2026-05-22",
    batchNo: "B2026051601",
    eta: "2026-05-22",
    items: [
      { model: "DK7745", available: 8 },
      { model: "DK7735", available: 3 }
    ]
  },
  {
    id: "B2026051502",
    inventoryType: "wip",
    title: "预计入库 2026-05-25",
    batchNo: "B2026051502",
    eta: "2026-05-25",
    items: [
      { model: "DK7735", available: 6 }
    ]
  }
];

const orders = [
  { id: "O20260516001", customerName: "苏州某精密制造", model: "DK7745", quantity: 2, status: "pending", createdAt: "2026-05-16 10:20" },
  { id: "O20260515003", customerName: "宁波某模具厂", model: "DK7735", quantity: 1, status: "approved", createdAt: "2026-05-15 16:05" }
];

module.exports = {
  dashboard,
  machines,
  inboundPlans,
  orders
};
