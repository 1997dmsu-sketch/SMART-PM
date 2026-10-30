// All records in this module are local design examples, never production identifiers.
const image = name => '/assets/design/' + name + '.jpg';
const houses = [
 {id:'demo-house-1',title:'幸福花园精装修三室两厅',price:4650,rooms:'3室2厅',area:126,cover:image('house-1')},
 {id:'demo-house-2',title:'满碧桂园银河城繁华里 精装修 三室两厅',price:1650,rooms:'3室2厅',area:126,cover:image('house-2')},
 {id:'demo-house-3',title:'近地铁 采光好 拎包入住',price:1750,rooms:'1室1厅',area:89,cover:image('house-3')},
 {id:'demo-house-4',title:'精装修 温暖两居',price:1500,rooms:'2室1厅',area:98,cover:image('house-4')}
].map(h => Object.assign({orientation:'南北',floor:'24层',rentType:'整租',community:'广州国际新城小区',address:'皇姑区苍山路28号',tags:['氛围小物','租房好物','免费安装'],payment:'月付',leaseTerm:'租期2年，提前预约可看房',availableFrom:'随时入住',deposit:7000,agencyFee:'需咨询',phone:'',facilities:['冰箱','洗衣机','热水器','空调','阳台'],nearby:'近嘉贝地铁站 · 相距200m',communityImages:[image('house-1')],images:[image('rental-cover'),h.cover]},h));
const feed = [
 ['39元日落灯，10㎡出租屋氛围感直接拉满','社区小管家',423],
 ['3块香薰灯 + 香片，回家推门就是高级酒店味','宝藏改造师',131],
 ['旧茶几0元爆改边几，全网最简教程，新手闭眼冲','出租屋研究所',545],
 ['出租屋门锁爆改智能锁，钥匙说拜拜，物业都来抄作业','社区小管家',91]
].map((r,i)=>({id:'demo-post-'+i,title:r[0],author:r[1],likes:r[2],cover:image('home-'+(i+1)),tags:['氛围小物','租房好物','免费安装']}));
const conversations = [
 ['物业管家·小宇','您报修的走廊灯已安排师傅上门',3,'property'],
 ['物业客服·小优','物业费账单已生成，可在「我的」中查看详情',0,'support'],
 ['维修班组·李师傅','已到达A栋2单元，稍后按门铃',0,'repair'],
 ['安保中心','访客「王先生」已登记进入小区',0,'security'],
 ['B1–203早早','[表情]',0,'resident'],['保洁阿姨','好的，我昨天才买了',0,'resident'],['B1–204王甜','谢谢啦',0,'resident']
].map((r,i)=>({id:'demo-chat-'+i,name:r[0],lastMessage:r[1],unread:r[2],role:r[3],time:i<4?'10:55':'8月27',avatar:i<4?'/assets/message-staff-'+i+'.png':''}));
const locks = ['608房智能锁','涂鸦智能门锁','涂鸦智能门锁'].map((name,i)=>({id:'demo-lock-'+i,deviceId:'demo-lock-'+i,name,address:'幸福花园A栋2单元608',provider:i?'tuya':'ttlock',status:'demo'}));
module.exports = { houses, feed, conversations, locks,
 records:locks.concat(locks.slice(0,1)).map((l,i)=>({id:'demo-record-'+i,name:l.name,time:'2026.10.10 10:21',status:'演示记录'})),
 family:['黄大明','李荣淑','黄小小','黄建国'].map((name,i)=>({id:'demo-member-'+i,name,relationship:['户主','配偶','女儿','户主'][i],phone:'138****8888',authorized:i!==2,avatar:''})),
 profile:{nickname:'业主用户',avatar:'/assets/profile-avatar.png',propertyId:'YZWL–1506',community:'幸福花园',house:'A栋2单元1506',points:176,coupons:5,orders:12,authenticated:true},
 property:{id:'demo-property',name:'大徐董事办公室',remark:'租客信息、押金、维修记录',rooms:[]},
 meter:{id:'demo-meter',name:'公摊电表',serial:'2637452673829',model:'电表345432',usage:19.63,unit:'kW·h',price:1.20,status:'离线',updatedAt:'2026-10-04 06:47:45'}
};
