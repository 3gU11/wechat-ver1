Page({
  data: {
    account: {}
  },

  onShow() {
    getApp().getSession(account => {
      this.setData({
        account: account || null
      });
    });
  },

  goAdminReviews() {
    wx.navigateTo({ url: "/pages/admin/reviews/index" });
  },

  logout() {
    getApp().clearSession();
    wx.redirectTo({ url: "/pages/auth/login/index" });
  }
});
