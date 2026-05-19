Page({
  data: {
    account: {},
    avatarText: "经"
  },

  onShow() {
    getApp().getSession(account => {
      const displayName = account && (account.name || account.contact_name || account.contactName || account.phone);
      const avatarText = displayName ? Array.from(String(displayName).trim())[0] || "经" : "经";

      this.setData({
        account: account || null,
        avatarText
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
