const api = require("../../../utils/api");

Page({
  data: {
    openidToken: "",
    roles: [
      { label: "普通经销商", value: "dealer" },
      { label: "大区经理", value: "regional_manager" }
    ],
    roleIndex: 0,
    regionalManagers: [],
    regionalManagerNames: [],
    regionalManagerIndex: -1,
    form: {
      companyName: "",
      phone: "",
      contactName: "",
      region: "",
      role: "dealer",
      regionalManagerName: "",
      remark: ""
    },
    submitting: false
  },

  onLoad(options) {
    const openidToken = options && options.openidToken ? decodeURIComponent(options.openidToken) : "";
    this.setData({ openidToken });
    if (!openidToken) {
      wx.showModal({
        title: "请先微信登录",
        content: "注册需要先绑定当前微信账号。",
        showCancel: false,
        success() {
          wx.navigateBack();
        }
      });
      return;
    }
    this.loadRegionalManagers();
  },

  loadRegionalManagers() {
    api.getRegionalManagers()
      .then(res => {
        const rows = res.data || [];
        this.setData({
          regionalManagers: rows,
          regionalManagerNames: rows.map(item => item.name)
        });
      })
      .catch(() => {
        this.setData({ regionalManagers: [], regionalManagerNames: [] });
      });
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ["form." + field]: e.detail.value });
  },

  onRoleChange(e) {
    const roleIndex = Number(e.detail.value || 0);
    const role = this.data.roles[roleIndex].value;
    this.setData({
      roleIndex,
      "form.role": role,
      regionalManagerIndex: role === "dealer" ? this.data.regionalManagerIndex : -1,
      "form.regionalManagerName": role === "dealer" ? this.data.form.regionalManagerName : ""
    });
  },

  onRegionalManagerChange(e) {
    const regionalManagerIndex = Number(e.detail.value);
    const manager = this.data.regionalManagers[regionalManagerIndex];
    this.setData({
      regionalManagerIndex,
      "form.regionalManagerName": manager ? manager.name : ""
    });
  },

  submit() {
    const form = this.data.form;
    if (!form.companyName || !form.phone || !form.contactName || !form.region) {
      wx.showToast({ title: "请填写公司、姓名、手机号和地区", icon: "none" });
      return;
    }
    if (form.role === "dealer" && !form.regionalManagerName) {
      wx.showToast({ title: "请选择所属大区经理", icon: "none" });
      return;
    }
    if (!this.data.openidToken) {
      wx.showToast({ title: "微信注册凭证缺失，请重新登录", icon: "none" });
      return;
    }

    this.setData({ submitting: true });
    api.registerDealer(Object.assign({}, form, { openidToken: this.data.openidToken }))
      .then(res => {
        this.setData({ submitting: false });
        wx.showModal({
          title: "申请已提交",
          content: res.data.message || "请等待管理员审核",
          showCancel: false,
          success() {
            wx.navigateBack();
          }
        });
      })
      .catch(err => {
        this.setData({ submitting: false });
        wx.showToast({ title: err.message || "提交失败", icon: "none" });
      });
  }
});
