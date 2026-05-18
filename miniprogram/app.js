// app.js
App({
  globalData: {
    apiBaseUrl: "https://api.wechat-ver1.com/api/dealer",
    token: "",
    account: null,
    sessionLoaded: false
  },
  sessionCallbacks: [],

  onLaunch() {
    wx.getStorage({
      key: "portalSession",
      success: res => {
        const session = res.data || {};
        this.globalData.token = session.token || "";
        this.globalData.account = session.account || null;
      },
      fail: () => {
        this.globalData.token = "";
        this.globalData.account = null;
      },
      complete: () => {
        this.globalData.sessionLoaded = true;
        this.flushSessionCallbacks();
      }
    });
  },

  setSession(token, account) {
    this.globalData.token = token;
    this.globalData.account = account;
    this.globalData.sessionLoaded = true;
    wx.setStorage({
      key: "portalSession",
      data: { token, account }
    });
  },

  clearSession() {
    this.globalData.token = "";
    this.globalData.account = null;
    this.globalData.sessionLoaded = true;
    wx.removeStorage({ key: "portalSession" });
  },

  getSession(callback) {
    if (this.globalData.sessionLoaded) {
      callback(this.globalData.account, this.globalData.token);
      return;
    }
    this.sessionCallbacks.push(callback);
  },

  flushSessionCallbacks() {
    const callbacks = this.sessionCallbacks.splice(0);
    callbacks.forEach(callback => {
      callback(this.globalData.account, this.globalData.token);
    });
  },

  onError(err) {
    console.error("App error:", err);
  }
});

