const api = require("../../utils/api");

Page({
  data: {
    batches: [],
    loading: true
  },

  onLoad() {
    this.loadBatches();
  },

  loadBatches() {
    this.setData({ loading: true });
    api.getBatches()
      .then(res => {
        this.setData({
          loading: false,
          batches: res.data || []
        });
      })
      .catch(err => {
        this.setData({ loading: false });
        wx.showToast({ title: err.message || "加载失败", icon: "none" });
      });
  }
});
