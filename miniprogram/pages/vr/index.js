const api = require('../../services/api');
Page({
  data: {url:'',error:''},
  async onLoad(options) {
    try {
      const posts = await api.listContent('share');
      const post = posts.find(p=>String(p._id || p.id)===options.id);
      const url = post && post.vrUrl;
      if (typeof url !== 'string' || !/^https:\/\/[^\s/@]+(?:[/?#][^\s]*)?$/.test(url)) throw Error('该内容暂无可用的 VR 在线链接');
      this.setData({url});
    } catch (error) {this.setData({error:error.message || 'VR 加载失败'});}
  },
  onError() {this.setData({url:'',error:'VR 页面暂时无法打开，请稍后重试或联系物业。'});}
});
