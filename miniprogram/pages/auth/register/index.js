const api = require("../../../utils/api");

Page({
  data: {
    form: {
      companyName: "",
      phone: "",
      contactName: "",
      region: "",
      remark: ""
    },
    submitting: false
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      ["form." + field]: e.detail.value
    });
  },

  submit() {
    const form = this.data.form;
    if (!form.companyName || !form.phone || !form.contactName || !form.region) {
      wx.showToast({ title: "请填写公司、姓名、手机号和地区", icon: "none" });
      return;
    }

    this.setData({ submitting: true });
    api.registerDealer(form)
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
