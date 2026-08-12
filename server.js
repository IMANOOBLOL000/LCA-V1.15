const express=require('express');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const app=express();
const PORT=process.env.PORT||3000;
const FREE_BACKGROUNDS=['default','forest','ocean','mountain','sunset','aurora'];
const SHOP_ITEMS={desert:90,city:110,lake:120,space:140,neon:75,grid:65,volcano:180,canyon:200,rain:220,moon:240,clouds:260,crystal:300,arctic:340,galaxy:400,meadow:450,sakura:500,storm:550,deepsea:600,snowfall:650,ember:700};
const EMOJI_COSTS=['😀','😂','😍','😎','🤔','😭','🔥','💀','👑','🚀','🎉','💙','🦄','🌟','🍀','⚡','🧊','🎯','🛸','🐉','🏆'].reduce((o,e,i)=>(o['emoji:'+e]=25+i*5,o),{});
const POINT_UTILITY_ITEMS={
  boost125_30:{cost:450,name:'1.25× Points — 30 min'},
  boost150_30:{cost:900,name:'1.5× Points — 30 min'},
  afkGrace15:{cost:700,name:'AFK Grace — 15 min'},
  timeRush15:{cost:1200,name:'Time Machine Rush — 15 min'},
  timeInstant:{cost:2500,name:'Time Machine Instant Finish'}
};
const DATA=process.env.LCA_DATA||path.join(__dirname,'data.json');
const SUPABASE_URL=String(process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL||'').replace(/\/$/,'');
const SUPABASE_SERVICE_ROLE_KEY=String(process.env.SUPABASE_SERVICE_ROLE_KEY||'');
const SUPABASE_STATE_ID='main';
let DB={accounts:{},servers:{},dms:{},sessions:{}};
let persistenceReady=false;
let saveQueue=Promise.resolve();
let saveTimer=null;
const OWNER_USERNAME=String(process.env.OWNER_USERNAME||'CEOIMANOOB').trim().toLowerCase();
const OWNER_PASSWORD=String(process.env.OWNER_PASSWORD||'1031121');

app.use(express.json({limit:'25mb'}));
app.use(express.static(__dirname,{index:'index.html'}));
app.use(async (req,res,next)=>{if(req.path.startsWith('/api/')&&!persistenceReady)return res.status(503).json({error:'LCA is starting. Please try again in a moment.'});next()});

function localLoad(){try{return JSON.parse(fs.readFileSync(DATA,'utf8'))}catch{return {accounts:{},servers:{},dms:{},sessions:{}}}}
async function supabaseRequest(method,path,body){
  if(!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY)throw new Error('Supabase environment variables are missing.');
  const r=await fetch(SUPABASE_URL+'/rest/v1/'+path,{method,headers:{apikey:SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=representation'},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();
  if(!r.ok)throw new Error('Supabase '+r.status+': '+text.slice(0,500));
  return text?JSON.parse(text):null;
}
async function loadPersistent(){
  if(!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY){console.warn('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');DB=localLoad();ensureDb();persistenceReady=true;return;}
  try{
    const rows=await supabaseRequest('GET','lca_state?id=eq.'+encodeURIComponent(SUPABASE_STATE_ID)+'&select=id,data');
    if(Array.isArray(rows)&&rows[0]?.data){DB=rows[0].data;console.log('Loaded LCA data from Supabase.');}
    else{DB=localLoad();ensureDb();await supabaseRequest('POST','lca_state',{id:SUPABASE_STATE_ID,data:DB});console.log('Initialized Supabase from existing data.json (or a fresh database).');}
    ensureDb();await persistNow();persistenceReady=true;
  }catch(e){console.error('Supabase startup failed:',e.message);process.exit(1);}
}
function persistNow(){
  if(!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY)return Promise.resolve();
  return supabaseRequest('POST','lca_state',{id:SUPABASE_STATE_ID,data:DB,updated_at:new Date().toISOString()});
}
function save(db){
  DB=db;
  if(!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY){
    const out=JSON.stringify(db,null,2),tmp=DATA+'.tmp';fs.writeFileSync(tmp,out);fs.renameSync(tmp,DATA);return;
  }
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{const snapshot=JSON.parse(JSON.stringify(DB));saveQueue=saveQueue.then(()=>supabaseRequest('POST','lca_state',{id:SUPABASE_STATE_ID,data:snapshot,updated_at:new Date().toISOString()})).catch(e=>console.error('Supabase save failed:',e.message));},50);
}
function token(){return crypto.randomBytes(32).toString('hex')}
function hashPassword(p){return crypto.createHash('sha256').update(String(p)).digest('hex')}
function verifyPassword(a,p){return a.passwordHash===hashPassword(p)||a.password===p}
function effectiveRole(a){if(!a)return 'user';if(a.username===OWNER_USERNAME)return 'owner';if(a.role==='server-admin'&&Number(a.serverAdminExpiresAt||0)<=Date.now())return 'user';return a.role||'user'}
function isOwnerControl(a){return !!a&&(a.username===OWNER_USERNAME||a.role==='co-owner'||Number(a.ownerPanelTrialUntil||0)>Date.now())}
function isRealOwner(a){return !!a&&a.username===OWNER_USERNAME}
function clean(a){const x=JSON.parse(JSON.stringify(a));delete x.password;delete x.passwordHash;x.isOwner=a.username===OWNER_USERNAME;x.isCoOwner=a.role==='co-owner';x.role=effectiveRole(a);x.serverAdminRemainingMs=x.role==='server-admin'?Math.max(0,Number(a.serverAdminExpiresAt||0)-Date.now()):0;x.ownerPanelTrialRemainingMs=Math.max(0,Number(a.ownerPanelTrialUntil||0)-Date.now());return x}
function template(username,name,password,birthday,isOwner=false){return {username,name,passwordHash:hashPassword(password),birthday: birthday||'',points:0,diamonds:0,inventory:[],friends:[],requests:[],servers:['home'],messages:[],description:'',notes:'',avatar:'',linkedAccounts:[],background:'default',role:isOwner?'owner':'user',modAnnouncementDate:'',modAnnouncementCount:0,staffActionDate:'',staffActionCount:0,serverAdminServerId:'',serverAdminExpiresAt:0,ownerPanelTrialUntil:0,coOwnerPointGrantRemaining:5000,coOwnerDiamondGrantRemaining:300,isOwner:!!isOwner}}
function ensureDb(){const db=DB;db.accounts=db.accounts||{};db.servers=db.servers||{};/* Remove the user-created server named exactly 'A'. */for(const [sid,srv] of Object.entries(db.servers)){if(sid!=='home'&&sid!=='updateLog'&&String(srv?.name||'').trim().toLowerCase()==='a')delete db.servers[sid];}db.dms=db.dms||{};db.sessions=db.sessions||{};db.globalNotice=db.globalNotice||null;db.typing=db.typing||{};db.reports=Array.isArray(db.reports)?db.reports:[];for(const legacy of ['modimanoob','adminimanoob','serveradminimanoob']){if(db.accounts[legacy])delete db.accounts[legacy];for(const srv of Object.values(db.servers))if(srv&&Array.isArray(srv.members))srv.members=srv.members.filter(u=>u!==legacy);for(const t of Object.keys(db.sessions))if(db.sessions[t]?.username===legacy)delete db.sessions[t];}if(!db.servers.home)db.servers.home={id:'home',name:'Home',private:false,codeHash:'',owner:OWNER_USERNAME,members:[],announcement:null};db.servers.home.members=db.servers.home.members||[];db.servers.home.announcement=db.servers.home.announcement||null;if(!db.servers.updateLog)db.servers.updateLog={id:'updateLog',name:'UPDATE LOG',private:false,codeHash:'',owner:OWNER_USERNAME,members:[],announcement:null,isUpdateLog:true};db.servers.updateLog.members=db.servers.updateLog.members||[];db.servers.updateLog.isUpdateLog=true;if(!db.servers.rules)db.servers.rules={id:'rules',name:'Rules',private:false,codeHash:'',owner:OWNER_USERNAME,members:[],announcement:null,isRules:true};db.servers.rules.members=db.servers.rules.members||[];db.servers.rules.isRules=true;for(const srv of Object.values(db.servers)){srv.members=srv.members||[];if(!Array.isArray(srv.members))srv.members=[];srv.announcement=srv.announcement||null;}for(const a of Object.values(db.accounts)){a.role=a.username===OWNER_USERNAME?'owner':(a.role||'user');a.modAnnouncementDate=a.modAnnouncementDate||'';a.modAnnouncementCount=Number(a.modAnnouncementCount||0);a.staffActionDate=a.staffActionDate||'';a.staffActionCount=Number(a.staffActionCount||0);a.serverAdminServerId=a.serverAdminServerId||'';a.serverAdminExpiresAt=Number(a.serverAdminExpiresAt||0);a.background=a.background||'default';a.friends=a.friends||[];a.requests=a.requests||[];a.dmRequests=a.dmRequests||[];a.inventory=a.inventory||[];a.messages=a.messages||[];a.timeMachine=a.timeMachine||null;a.pointsMultiplier=Number(a.pointsMultiplier||1);a.pointsMultiplierUntil=Number(a.pointsMultiplierUntil||0);a.diamonds=Number(a.diamonds||0);a.afkGraceDate=a.afkGraceDate||'';a.afkGraceMinutesRemaining=Number(a.afkGraceMinutesRemaining||0);a.diamondDropUntil=Number(a.diamondDropUntil||0);a.diamondDropMultiplier=Number(a.diamondDropMultiplier||1);a.ownerShopPurchases=Number(a.ownerShopPurchases||0);a.ownerPanelTrialUntil=Number(a.ownerPanelTrialUntil||0);a.coOwnerPointGrantRemaining=Math.max(0,Math.min(5000,Number(a.coOwnerPointGrantRemaining??5000)));a.coOwnerDiamondGrantRemaining=Math.max(0,Math.min(300,Number(a.coOwnerDiamondGrantRemaining??300)));if(a.role==='server-admin'&&a.serverAdminExpiresAt&&a.serverAdminExpiresAt<=Date.now()){a.role='user';a.serverAdminServerId='';a.serverAdminExpiresAt=0;}a.servers=a.servers||[];if(!a.servers.includes('home'))a.servers.push('home');if(!a.servers.includes('updateLog'))a.servers.push('updateLog');if(!a.servers.includes('rules'))a.servers.push('rules');if(!db.servers.rules.members.includes(a.username))db.servers.rules.members.push(a.username);if(!db.servers.updateLog.members.includes(a.username))db.servers.updateLog.members.push(a.username)}if(!db.accounts[OWNER_USERNAME]){db.accounts[OWNER_USERNAME]=template(OWNER_USERNAME,'CEOIMANOOB',OWNER_PASSWORD,'',true);if(!db.servers.home.members.includes(OWNER_USERNAME))db.servers.home.members.push(OWNER_USERNAME);if(!db.accounts[OWNER_USERNAME].servers.includes('updateLog'))db.accounts[OWNER_USERNAME].servers.push('updateLog');if(!db.servers.updateLog.members.includes(OWNER_USERNAME))db.servers.updateLog.members.push(OWNER_USERNAME)}const rulesText=`# Rules\n\n1. Be respectful.\nTreat everyone fairly. No bullying, harassment, or targeted insults.\n\n2. No threats.\nDo not threaten to hurt, attack, or harm another person.\n\n3. No hate speech.\nDo not attack or use slurs against people based on race, ethnicity, religion, disability, gender, sexual orientation, or other protected characteristics.\n\n4. No sexual harassment.\nDo not make unwanted sexual comments, requests, or advances toward another player.\n\n5. No sexual content involving minors.\nAny sexual content involving minors is strictly prohibited.\n\n6. No inappropriate sexual or graphic content.\nDo not post pornography, graphic sexual material, or excessively disturbing content.\n\n7. No bullying or stalking.\nDo not repeatedly target, follow, intimidate, or harass another player.\n\n8. No doxxing.\nNever share someone's private information, such as their home address, phone number, passwords, or private documents.\n\n9. Protect your own privacy.\nDo not share sensitive personal information with other players.\n\n10. No scams or fraud.\nDo not trick players into giving you money, accounts, passwords, items, or other property.\n\n11. No impersonation.\nDo not pretend to be another player, moderator, administrator, or real person in order to deceive others.\n\n12. No cheating or exploiting.\nDo not use hacks, exploits, bugs, bots, or unauthorized software to gain an unfair advantage.\n\n13. No malicious links or files.\nDo not send viruses, malware, phishing links, or files designed to harm another person's device or account.\n\n14. No spam.\nDo not flood chats with repeated messages, advertisements, or unwanted content.\n\n15. No ban evasion.\nDo not use another account to avoid a ban, mute, suspension, or other moderation action.\n\n16. Respect moderators.\nFollow reasonable moderator instructions. If you disagree with a decision, use the proper appeal or report process.\n\n17. Do not encourage dangerous or illegal behavior.\nDo not encourage people to hurt themselves or others or participate in dangerous or criminal activity.\n\n18. Do not abuse the reporting system.\nOnly submit reports about genuine concerns. Do not make fake reports to get someone punished.\n\n19. Report rule breakers.\nIf you see someone breaking these rules, use the Report button. Explain what happened and provide evidence when possible. Do not retaliate against the person yourself.\n\n20. Help keep the community safe.\nIf something feels unsafe, threatening, or seriously inappropriate, report it to the moderators. Moderators may remove content, warn, mute, suspend, or ban accounts depending on the situation.`;const owner=db.accounts[OWNER_USERNAME];owner.passwordHash=hashPassword(OWNER_PASSWORD);owner.name='CEOIMANOOB';owner.role='owner';owner.inventory=owner.inventory||[];for(const id of Object.keys(SHOP_ITEMS).concat(Object.keys(EMOJI_COSTS)))if(!owner.inventory.includes(id))owner.inventory.push(id);owner.background=owner.background||'default';if(!owner.messages.some(m=>m.server==='rules'&&m.rulesSeed)){owner.messages.push({id:crypto.randomBytes(8).toString('hex'),server:'rules',name:owner.name,username:owner.username,text:rulesText,originalText:'',attachments:[],time:new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),createdAt:new Date().toISOString(),rulesSeed:true});}const updateLogText=`I made this website for people in or out of school so they can enjoy messaging their friends and total strangers. Expect weekly updates.`;const reportText=`If you see anyone violating the rules, take a screenshot and report them in my discord: https://discord.com/channels/1532286082325151856/1532286082799112275 they get reviewed faster`;if(!owner.messages.some(m=>m.server==='updateLog'&&m.updateLogSeed)){owner.messages.push({id:crypto.randomBytes(8).toString('hex'),server:'updateLog',name:owner.name,username:owner.username,text:updateLogText,originalText:'',attachments:[],time:new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),createdAt:new Date().toISOString(),updateLogSeed:true});}if(!owner.messages.some(m=>m.server==='rules'&&m.reportSeed)){owner.messages.push({id:crypto.randomBytes(8).toString('hex'),server:'rules',name:owner.name,username:owner.username,text:reportText,originalText:'',attachments:[],time:new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),createdAt:new Date().toISOString(),reportSeed:true});}save(db);return db}
function createSession(db,username){const t=token();db.sessions[t]={username,createdAt:Date.now(),lastUsed:Date.now()};save(db);return t}
function auth(req,res,next){const t=(req.headers.authorization||'').replace(/^Bearer\s+/,'');const db=ensureDb();const s=db.sessions[t];if(!s||!db.accounts[s.username])return res.status(401).json({error:'Please log in again.'});const a=db.accounts[s.username];if(a.permanentBan|| (a.banUntil&&Number(a.banUntil)>Date.now())){return res.status(403).json({error:'You are banned from LCA.',banned:true,username:s.username,banUntil:Number(a.banUntil),banReason:a.banReason||''})}if(!a.permanentBan&&a.banUntil&&Number(a.banUntil)<=Date.now()){a.banUntil=0;a.banReason='';save(db)}s.lastUsed=Date.now();req.token=t;req.username=s.username;req.db=db;req.account=a;next()}
function linkedUsernames(db,username){const set=new Set([username]);const a=db.accounts[username];for(const u of (a?.linkedAccounts||[]))set.add(u);for(const [u,x] of Object.entries(db.accounts))if((x.linkedAccounts||[]).includes(username))set.add(u);return [...set]}
function effectiveServers(db,username){if(username===OWNER_USERNAME)return Object.values(db.servers).filter(Boolean);const ids=new Set();for(const u of linkedUsernames(db,username))for(const id of (db.accounts[u]?.servers||[]))ids.add(id);return [...ids].map(id=>db.servers[id]).filter(Boolean)}
function effectiveMessages(db,username){
  const serverIds=new Set(effectiveServers(db,username).map(s=>s.id));
  const out=[];
  for(const a of Object.values(db.accounts)){
    for(const m of (a.messages||[])){
      if(serverIds.has(m.server))out.push(m);
    }
  }
  return out.sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
}
function contacts(db,a){return (a.friends||[]).map(u=>db.accounts[u]).filter(Boolean).map(clean)}
function onlineUsers(db){const now=Date.now(),set=new Set();for(const s of Object.values(db.sessions))if(now-s.lastUsed<70000)set.add(s.username);return set}
function memberProfiles(db,username,serverId){const s=db.servers[serverId];if(!s)return [];const online=onlineUsers(db);return s.members.map(u=>db.accounts[u]).filter(Boolean).map(a=>{const x=clean(a);x.online=online.has(a.username);return x})}
function ageFrom(b){if(!b)return 99;const d=new Date(b),n=new Date();let a=n.getFullYear()-d.getFullYear();if(n.getMonth()<d.getMonth()||(n.getMonth()===d.getMonth()&&n.getDate()<d.getDate()))a--;return a}
function ownerOnly(req,res,next){auth(req,res,()=>{if(req.username!==OWNER_USERNAME)return res.status(403).json({error:'Owner access only.'});next()})}
function ownerControl(req,res,next){auth(req,res,()=>{if(!isOwnerControl(req.account))return res.status(403).json({error:'Owner or active Owner Panel access required.'});next()})}
function announcementAuth(req,res,next){auth(req,res,()=>{const a=req.account,r=effectiveRole(a);if(isOwnerControl(a)||['mod','admin','server-admin'].includes(r))return next();return res.status(403).json({error:'Staff access only.'})})}

app.get('/api/health',(req,res)=>res.json({ok:true,app:'LCA',version:'1.1.1',time:Date.now()}));

app.post('/api/register',(req,res)=>{const db=ensureDb(),name=String(req.body?.name||'').trim(),password=String(req.body?.password||''),birthday=String(req.body?.birthday||'');const username=name.toLowerCase();if(name.length<2)return res.status(400).json({error:'Please enter a name.'});if(password.length<8)return res.status(400).json({error:'Password must be at least 8 characters.'});if(!birthday)return res.status(400).json({error:'Please enter your birthday.'});if(ageFrom(birthday)<0||ageFrom(birthday)>120)return res.status(400).json({error:'Please enter a real birthday.'});if(username===OWNER_USERNAME)return res.status(403).json({error:'That name is reserved.'});if(db.accounts[username])return res.status(409).json({error:'That account already exists.'});db.accounts[username]=template(username,name,password,birthday,false);db.accounts[username].servers.push('updateLog');db.accounts[username].servers.push('rules');db.servers.home.members.push(username);db.servers.updateLog.members.push(username);db.servers.rules.members.push(username);const t=createSession(db,username);res.json({token:t,account:clean(db.accounts[username])})});

app.post('/api/login',(req,res)=>{const db=ensureDb(),name=String(req.body?.name||'').trim(),password=String(req.body?.password||''),username=name.toLowerCase();if(username===OWNER_USERNAME&&!db.accounts[username]){db.accounts[username]=template(OWNER_USERNAME,'CEOIMANOOB',OWNER_PASSWORD,'',true);if(!db.servers.home.members.includes(username))db.servers.home.members.push(username);save(db)}const a=db.accounts[username];if(!a||!verifyPassword(a,password))return res.status(401).json({error:'Incorrect name or password.'});if(a.permanentBan|| (a.banUntil&&Number(a.banUntil)>Date.now()))return res.status(403).json({error:'You are banned from LCA.',banned:true,username:a.username,banUntil:Number(a.banUntil),banReason:a.banReason||''});if(!a.permanentBan&&a.banUntil&&Number(a.banUntil)<=Date.now()){a.banUntil=0;a.banReason='';save(db)}a.role=a.username===OWNER_USERNAME?'owner':(a.role||'user');a.servers=a.servers||[];if(!a.servers.includes('updateLog'))a.servers.push('updateLog');if(!db.servers.updateLog.members.includes(a.username))db.servers.updateLog.members.push(a.username);if(a.password){a.passwordHash=hashPassword(a.password);delete a.password;save(db)}const t=createSession(db,username);res.json({token:t,account:clean(a)})});
app.post('/api/logout',auth,(req,res)=>{delete req.db.sessions[req.token];save(req.db);res.json({ok:true})});

app.post('/api/session/refresh',auth,(req,res)=>{const db=req.db,a=req.account;res.json({account:clean(a)})});

app.get('/api/snapshot',auth,(req,res)=>{const db=req.db,a=db.accounts[req.username],x=clean(a);x.servers=effectiveServers(db,req.username);x.messages=effectiveMessages(db,req.username);x.contacts=contacts(db,a);x.linkedProfiles=linkedUsernames(db,req.username).map(u=>clean(db.accounts[u]));x.membersByServer={};x.announcements={};for(const srv of x.servers){x.membersByServer[srv.id]=memberProfiles(db,req.username,srv.id);x.announcements[srv.id]=srv.announcement||null}x.age=ageFrom(a.birthday);x.globalNotice=(db.globalNotice&&Number(db.globalNotice.expiresAt)>Date.now())?db.globalNotice:null;res.json({account:x})});
app.post('/api/profile',auth,(req,res)=>{const db=req.db,a=req.account,b=req.body||{};if(typeof b.name==='string'&&b.name.trim())a.name=b.name.trim().slice(0,40);if(typeof b.description==='string')a.description=b.description.slice(0,600);if(typeof b.notes==='string')a.notes=b.notes.slice(0,2000);if(typeof b.avatar==='string')a.avatar=b.avatar.slice(0,10000000);save(db);res.json({account:clean(a)})});

app.post('/api/background',auth,(req,res)=>{const db=req.db,a=req.account,id=String(req.body?.id||'default');const valid=[...FREE_BACKGROUNDS,...Object.keys(SHOP_ITEMS)];if(!valid.includes(id))return res.status(400).json({error:'Unknown background.'});if(a.username===OWNER_USERNAME){a.background=id;save(db);return res.json({ok:true,background:id})}if(id!=='default'&&!(a.inventory||[]).includes(id))return res.status(403).json({error:'Buy that background first.'});a.background=id;save(db);res.json({ok:true,background:id})});

app.post('/api/message',auth,(req,res)=>{const db=req.db,a=req.account,{server,text,attachments}=req.body||{};if(!db.servers[server]||!effectiveServers(db,req.username).some(s=>s.id===server))return res.status(403).json({error:'You are not in that server.'});if((db.servers[server].isUpdateLog||db.servers[server].isRules)&&req.username!==OWNER_USERNAME)return res.status(403).json({error:db.servers[server].isRules?'Only the owner can post in RULES.':'Only the owner can post in UPDATE LOG.'});const cleanText=String(text||'').slice(0,4000),atts=Array.isArray(attachments)?attachments.slice(0,5):[];
  if(!cleanText&&!atts.length)return res.status(400).json({error:'Empty message.'});
  const catalog=Object.keys(EMOJI_COSTS).map(k=>k.slice(6));
  const owned=new Set((a.inventory||[]).filter(x=>x.startsWith('emoji:')).map(x=>x.slice(6)));
  const pasted=catalog.filter(e=>cleanText.includes(e)&&!owned.has(e));
  if(pasted.length)return res.status(400).json({error:`You have to own ${pasted[0]} before you can send it.`});
  const unsupported=/[\p{Extended_Pictographic}]/u.test(cleanText) && !catalog.some(e=>cleanText.includes(e));
  if(unsupported)return res.status(400).json({error:'That emoji is not in your collection. Buy it first in the Points Shop.'});const m={id:crypto.randomBytes(8).toString('hex'),server,name:a.name,username:a.username,text:cleanText,originalText:'',attachments:atts,time:new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),createdAt:new Date().toISOString()};a.messages.push(m);save(db);res.json({ok:true,message:m})});


app.post('/api/message/react',auth,(req,res)=>{const db=req.db,a=req.account,id=String(req.body?.id||''),emoji=String(req.body?.emoji||'');const allowed=['👍','❤️','😂','😮','😡','🎉'];if(!allowed.includes(emoji))return res.status(400).json({error:'Reaction not allowed.'});for(const owner of Object.values(db.accounts)){const m=(owner.messages||[]).find(x=>x.id===id);if(m){m.reactions=m.reactions||{};m.reactions[emoji]=Array.isArray(m.reactions[emoji])?m.reactions[emoji]:[];const i=m.reactions[emoji].indexOf(a.username);if(i>=0)m.reactions[emoji].splice(i,1);else m.reactions[emoji].push(a.username);save(db);return res.json({ok:true,reactions:m.reactions})}}res.status(404).json({error:'Message not found.'})});
app.post('/api/message/reply',auth,(req,res)=>{const db=req.db,a=req.account,server=String(req.body?.server||''),text=String(req.body?.text||'').slice(0,4000),replyTo=String(req.body?.replyTo||'');if(!text||!replyTo)return res.status(400).json({error:'Reply needs text and original message.'});if(!db.servers[server]||!effectiveServers(db,a.username).some(s=>s.id===server))return res.status(403).json({error:'You are not in that server.'});if(db.servers[server].isRules&&a.username!==OWNER_USERNAME)return res.status(403).json({error:'Only the owner can post in RULES.'});let original=null;for(const owner of Object.values(db.accounts)){original=(owner.messages||[]).find(m=>m.id===replyTo);if(original)break}if(!original)return res.status(404).json({error:'Original message not found.'});const m={id:crypto.randomBytes(8).toString('hex'),server,name:a.name,username:a.username,text,originalText:'',attachments:[],time:new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),createdAt:new Date().toISOString(),replyTo:original.id,replyPreview:String(original.text||'[attachment]').slice(0,180)};a.messages.push(m);save(db);res.json({ok:true,message:m})});
app.post('/api/bookmark',auth,(req,res)=>{const db=req.db,a=req.account,id=String(req.body?.id||'');let found=false;for(const owner of Object.values(db.accounts))if((owner.messages||[]).some(m=>m.id===id)){found=true;break}if(!found)return res.status(404).json({error:'Message not found.'});a.bookmarks=Array.isArray(a.bookmarks)?a.bookmarks:[];const i=a.bookmarks.indexOf(id);if(i>=0)a.bookmarks.splice(i,1);else a.bookmarks.push(id);save(db);res.json({ok:true,bookmarks:a.bookmarks})});
app.get('/api/search',auth,(req,res)=>{const db=req.db,q=String(req.query?.q||'').trim().toLowerCase();if(q.length<2)return res.json({messages:[]});const ids=new Set(effectiveServers(db,req.username).map(s=>s.id)),out=[];for(const owner of Object.values(db.accounts))for(const m of(owner.messages||[]))if(ids.has(m.server)&&((m.text||'').toLowerCase().includes(q)||(m.name||'').toLowerCase().includes(q)))out.push(m);res.json({messages:out.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,100)})});
app.post('/api/typing',auth,(req,res)=>{const db=req.db,a=req.account,server=String(req.body?.server||''),isTyping=!!req.body?.typing;if(!db.servers[server]||!effectiveServers(db,a.username).some(s=>s.id===server))return res.status(403).json({error:'Not in server.'});const friends=new Set(a.friends||[]);if(isTyping&&!friends.size)return res.json({ok:true});db.typing[`${server}:${a.username}`]=isTyping?Date.now():0;save(db);res.json({ok:true})});
app.get('/api/typing',auth,(req,res)=>{const db=req.db,a=req.account,server=String(req.query?.server||''),now=Date.now(),friends=new Set(a.friends||[]),users=[];for(const [key,ts] of Object.entries(db.typing||{})){const [sid,u]=key.split(':');if(sid===server&&ts&&now-ts<4000&&friends.has(u))users.push(db.accounts[u]?.name||u)}res.json({users})});
app.post('/api/server',auth,(req,res)=>{const db=req.db,a=req.account,name=String(req.body?.name||'').trim(),privateServer=!!req.body?.private,code=String(req.body?.code||'');if(!name)return res.status(400).json({error:'Enter a server name.'});if(Object.values(db.servers).some(s=>String(s.name||'').toLowerCase()===name.toLowerCase()))return res.status(409).json({error:'A server with that name already exists.'});if(privateServer&&code.length<4)return res.status(400).json({error:'Private server codes must be at least 4 characters.'});const id='s_'+crypto.randomBytes(7).toString('hex');db.servers[id]={id,name:name.slice(0,60),private:privateServer,codeHash:privateServer?hashPassword(code):'',owner:a.username,members:[a.username],announcement:null};a.servers.push(id);save(db);res.json({ok:true,server:db.servers[id]})});
app.post('/api/join',auth,(req,res)=>{const db=req.db,a=req.account,name=String(req.body?.name||'').trim().toLowerCase(),code=String(req.body?.code||'');const s=Object.values(db.servers).find(x=>x.name.toLowerCase()===name);if(!s)return res.status(404).json({error:'Server not found.'});if(s.private&&s.codeHash!==hashPassword(code))return res.status(403).json({error:'That server needs the correct code.'});if(!s.members.includes(a.username))s.members.push(a.username);if(!a.servers.includes(s.id))a.servers.push(s.id);save(db);res.json({message:'Joined '+s.name,server:s})});

app.post('/api/friend/request',auth,(req,res)=>{const db=req.db,a=req.account,u=String(req.body?.username||'').trim().toLowerCase();if(!db.accounts[u])return res.status(404).json({error:'User not found.'});if(u===a.username)return res.status(400).json({error:'You cannot friend yourself.'});a.friends=a.friends||[];const target=db.accounts[u];target.requests=target.requests||[];if(a.friends.includes(u))return res.json({message:'Already friends.'});if(!target.requests.includes(a.username))target.requests.push(a.username);save(db);res.json({message:'Friend request sent.'})});
app.get('/api/friends',auth,(req,res)=>{const db=req.db,a=req.account;res.json({friends:contacts(db,a),requests:(a.requests||[]).map(u=>db.accounts[u]).filter(Boolean).map(clean)})});
app.post('/api/friend/accept',auth,(req,res)=>{const db=req.db,a=req.account,u=String(req.body?.username||'').toLowerCase();if(!(a.requests||[]).includes(u))return res.status(404).json({error:'Request not found.'});a.requests=a.requests.filter(x=>x!==u);a.friends=a.friends||[];db.accounts[u].friends=db.accounts[u].friends||[];if(!a.friends.includes(u))a.friends.push(u);if(!db.accounts[u].friends.includes(a.username))db.accounts[u].friends.push(a.username);save(db);res.json({ok:true})});

app.post('/api/link',auth,(req,res)=>{const db=req.db,a=req.account,target=String(req.body?.username||'').trim().toLowerCase(),password=String(req.body?.password||'');if(target===a.username)return res.status(400).json({error:'That is already this account.'});const other=db.accounts[target];if(!other||!verifyPassword(other,password))return res.status(401).json({error:'Could not verify that account.'});a.linkedAccounts=a.linkedAccounts||[];other.linkedAccounts=other.linkedAccounts||[];if(!a.linkedAccounts.includes(target))a.linkedAccounts.push(target);if(!other.linkedAccounts.includes(a.username))other.linkedAccounts.push(a.username);save(db);res.json({message:'Accounts linked! Shared servers and live messages are now visible on both accounts.'})});

app.post('/api/dm/request',auth,(req,res)=>{const db=req.db,a=req.account,to=String(req.body?.to||'').toLowerCase();if(!db.accounts[to])return res.status(404).json({error:'User not found.'});if(to===a.username)return res.status(400).json({error:'You cannot DM yourself.'});if((a.friends||[]).includes(to))return res.json({ok:true,accepted:true});const target=db.accounts[to];target.dmRequests=target.dmRequests||[];if(!target.dmRequests.includes(a.username))target.dmRequests.push(a.username);save(db);res.json({ok:true,requested:true,message:'DM request sent.'})});
app.get('/api/dm/requests',auth,(req,res)=>{const db=req.db,a=req.account;res.json({requests:(a.dmRequests||[]).map(u=>db.accounts[u]).filter(Boolean).map(clean)})});
app.post('/api/dm/accept',auth,(req,res)=>{const db=req.db,a=req.account,u=String(req.body?.username||'').toLowerCase();if(!(a.dmRequests||[]).includes(u))return res.status(404).json({error:'DM request not found.'});a.dmRequests=a.dmRequests.filter(x=>x!==u);a.friends=a.friends||[];db.accounts[u].friends=db.accounts[u].friends||[];if(!a.friends.includes(u))a.friends.push(u);if(!db.accounts[u].friends.includes(a.username))db.accounts[u].friends.push(a.username);save(db);res.json({ok:true})});
app.post('/api/dm/send',auth,(req,res)=>{const db=req.db,a=req.account,to=String(req.body?.to||'').toLowerCase(),text=String(req.body?.text||'').slice(0,4000);if(!db.accounts[to])return res.status(404).json({error:'User not found.'});if(!(a.friends||[]).includes(to))return res.status(403).json({error:'You must be friends first. Send a DM request instead.'});if(!text)return res.status(400).json({error:'Empty message.'});const id=[a.username,to].sort().join('__');db.dms[id]=db.dms[id]||[];db.dms[id].push({id:crypto.randomBytes(8).toString('hex'),from:a.username,to,text,time:new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),createdAt:new Date().toISOString()});save(db);res.json({ok:true})});
app.get('/api/dm/:username',auth,(req,res)=>{const to=String(req.params.username||'').toLowerCase();if(!(req.account.friends||[]).includes(to))return res.status(403).json({error:'You must be friends first.'});const id=[req.username,to].sort().join('__');res.json({messages:req.db.dms[id]||[]})});

app.post('/api/activity',auth,(req,res)=>{req.account.lastActivityAt=Date.now();save(req.db);res.json({ok:true})});
app.post('/api/points/reward',auth,(req,res)=>{const db=req.db,a=req.account,now=Date.now(),lastReward=Number(a.lastRewardAt||0),lastActivity=Number(a.lastActivityAt||now);const today=new Date().toISOString().slice(0,10);if(a.afkGraceDate!==today){a.afkGraceDate=today;a.afkGraceMinutesRemaining=0;}let afk=now-lastActivity>300000;if(afk){const last=Number(a.lastAfkCheckAt||now);const elapsed=Math.max(0,now-last);if(Number(a.afkGraceMinutesRemaining||0)>0){const consume=Math.min(Number(a.afkGraceMinutesRemaining||0),Math.max(1,Math.ceil(elapsed/60000)));a.afkGraceMinutesRemaining-=consume;afk=false;}a.lastAfkCheckAt=now;}if(afk){a.lastRewardAt=now;save(db);return res.json({points:a.points||0,awarded:0,afk:true,afkGraceMinutesRemaining:a.afkGraceMinutesRemaining||0})}if(lastReward&&now-lastReward<55000)return res.json({points:a.points||0,awarded:0});const baseMult=Number(a.pointsMultiplierUntil||0)>now?Number(a.pointsMultiplier||1):1;const dropMult=Number(a.diamondDropUntil||0)>now?Number(a.diamondDropMultiplier||1):1;const awarded=Math.floor(3*baseMult*dropMult);a.points=(a.points||0)+awarded;a.lastRewardAt=now;save(db);res.json({points:a.points,awarded,afk:false,afkGraceMinutesRemaining:a.afkGraceMinutesRemaining||0,dropMultiplier:dropMult})});
app.post('/api/shop/buy',auth,(req,res)=>{
  const db=req.db,a=req.account,item=String(req.body?.item||'');
  const cost=SHOP_ITEMS[item]??EMOJI_COSTS[item]??POINT_UTILITY_ITEMS[item]?.cost;
  if(cost===undefined)return res.status(400).json({error:'Unknown shop item.'});
  a.inventory=a.inventory||[];
  if(a.inventory.includes(item) && !POINT_UTILITY_ITEMS[item])return res.json({message:'Already owned.',points:a.points});
  if(a.username===OWNER_USERNAME && !POINT_UTILITY_ITEMS[item]){a.inventory.push(item);save(db);return res.json({message:'Owner unlock: '+item,points:a.points});}
  if((a.points||0)<cost)return res.status(400).json({error:'Not enough points.'});
  const now=Date.now();
  if(item==='timeRush15'&&(!a.timeMachine||Number(a.timeMachine.readyAt||0)<=now))return res.status(400).json({error:'You need an active Time Machine that is still charging.'});
  if(item==='timeInstant'&&(!a.timeMachine||Number(a.timeMachine.readyAt||0)<=now))return res.status(400).json({error:'You need an active Time Machine that is still charging.'});
  a.points-=cost;
  if(POINT_UTILITY_ITEMS[item]){
    if(item==='boost125_30'){a.pointsMultiplier=Math.max(1,Number(a.pointsMultiplier||1),1.25);a.pointsMultiplierUntil=Math.max(Number(a.pointsMultiplierUntil||0),now+30*60000);}
    if(item==='boost150_30'){a.pointsMultiplier=Math.max(1,Number(a.pointsMultiplier||1),1.5);a.pointsMultiplierUntil=Math.max(Number(a.pointsMultiplierUntil||0),now+30*60000);}
    if(item==='afkGrace15'){const today=new Date().toISOString().slice(0,10);if(a.afkGraceDate!==today){a.afkGraceDate=today;a.afkGraceMinutesRemaining=0;}a.afkGraceMinutesRemaining=Number(a.afkGraceMinutesRemaining||0)+15;}
    if(item==='timeRush15'){a.timeMachine.readyAt=Math.max(now,Number(a.timeMachine.readyAt)-15*60000);}
    if(item==='timeInstant'){a.timeMachine.readyAt=now;}
  } else a.inventory.push(item);
  save(db);res.json({message:'Purchased '+(POINT_UTILITY_ITEMS[item]?.name||item),points:a.points});
});


const TIME_MACHINE_TIERS=[
  {id:'tm1',cost:500,multiplier:1.15,label:'Time Machine I',reward:'1.15× points'},
  {id:'tm2',cost:900,multiplier:1.25,label:'Time Machine II',reward:'1.25× points'},
  {id:'tm3',cost:1500,multiplier:1.35,label:'Time Machine III',reward:'1.35× points'},
  {id:'tm4',cost:2400,multiplier:1.5,label:'Time Machine IV',reward:'1.5× points'},
  {id:'tm5',cost:3700,multiplier:1.7,label:'Time Machine V',reward:'1.7× points'},
  {id:'tm6',cost:5600,multiplier:1.9,label:'Time Machine VI',reward:'1.9× points'},
  {id:'tm7',cost:8200,multiplier:2.1,label:'Time Machine VII',reward:'2.1× points'},
  {id:'tm8',cost:12000,multiplier:2.4,label:'Time Machine VIII',reward:'2.4× points'},
  {id:'tm9',cost:17500,multiplier:2.8,label:'Time Machine IX',reward:'2.8× points'},
  {id:'tm10',cost:25000,multiplier:3.25,label:'Time Machine X',reward:'3.25× points'}
];
app.post('/api/diamonds/exchange',auth,(req,res)=>{const db=req.db,a=req.account,direction=String(req.body?.direction||'pointsToDiamonds');const amount=Math.floor(Number(req.body?.amount||0));if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:'Enter a positive amount.'});if(direction==='pointsToDiamonds'){if(amount%100!==0)return res.status(400).json({error:'Points-to-diamond exchanges must use multiples of 100 points.'});if((a.points||0)<amount)return res.status(400).json({error:'Not enough points.'});const dia=amount/100;a.points-=amount;a.diamonds=(a.diamonds||0)+dia;save(db);return res.json({ok:true,direction,points:a.points,diamonds:a.diamonds,changedPoints:-amount,changedDiamonds:dia})}if(direction==='diamondsToPoints'){const dia=amount;if((a.diamonds||0)<dia)return res.status(400).json({error:`You need ${dia} diamonds.`});const pts=dia*100;a.diamonds-=dia;a.points=(a.points||0)+pts;save(db);return res.json({ok:true,direction,points:a.points,diamonds:a.diamonds,changedPoints:pts,changedDiamonds:-dia})}return res.status(400).json({error:'Unknown exchange direction.'})});
app.post('/api/owner/diamonds',ownerControl,(req,res)=>{const db=req.db,grantor=req.account,target=String(req.body?.target||grantor.username).toLowerCase(),amount=Math.floor(Number(req.body?.amount||0));if(!db.accounts[target])return res.status(404).json({error:'Player not found.'});if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:'Enter a positive diamond amount.'});if(grantor.username!==OWNER_USERNAME){if(grantor.role!=='co-owner')return res.status(403).json({error:'Only the owner can grant diamonds.'});if(amount>Number(grantor.coOwnerDiamondGrantRemaining||0))return res.status(400).json({error:`Co-Owner diamond grant limit remaining: ${grantor.coOwnerDiamondGrantRemaining||0}.`});grantor.coOwnerDiamondGrantRemaining-=amount;}db.accounts[target].diamonds=(db.accounts[target].diamonds||0)+amount;save(db);res.json({ok:true,target,amount,diamonds:db.accounts[target].diamonds})});
app.get('/api/time-machine/status',auth,(req,res)=>{const a=req.account;res.json({pending:a.timeMachine||null,multiplier:Number(a.pointsMultiplierUntil||0)>Date.now()?Number(a.pointsMultiplier||1):1,multiplierUntil:Number(a.pointsMultiplierUntil||0)})});
app.get('/api/time-machine/tiers',auth,(req,res)=>res.json({tiers:TIME_MACHINE_TIERS}));
app.post('/api/time-machine/start',auth,(req,res)=>{const a=req.account,t=TIME_MACHINE_TIERS.find(x=>x.id===String(req.body?.tier||''));if(!t)return res.status(400).json({error:'Unknown Time Machine tier.'});if(a.timeMachine&&Number(a.timeMachine.readyAt)>Date.now())return res.status(400).json({error:'A Time Machine is already running.'});if((a.points||0)<t.cost)return res.status(400).json({error:'Not enough points.'});const now=Date.now(),role=effectiveRole(a),staffBypass=['owner','mod','admin','server-admin'].includes(role);a.points-=t.cost;a.timeMachine={tier:t.id,label:t.label,multiplier:t.multiplier,startedAt:now,readyAt:staffBypass?now:now+1800000,skipWait:staffBypass};save(req.db);res.json({ok:true,points:a.points,timeMachine:a.timeMachine})});
app.post('/api/time-machine/claim',auth,(req,res)=>{const a=req.account,tm=a.timeMachine;if(!tm)return res.status(400).json({error:'No Time Machine is ready.'});if(Number(tm.readyAt)>Date.now())return res.status(400).json({error:'The Time Machine is still charging.'});a.pointsMultiplier=Number(tm.multiplier||1);a.pointsMultiplierUntil=Date.now()+3600000;a.timeMachine=null;const flip=Math.random()<0.5?'HEADS':'TAILS';save(req.db);res.json({ok:true,points:a.points,multiplier:a.pointsMultiplier,multiplierUntil:a.pointsMultiplierUntil,flip})});
app.post('/api/owner-shop/buy',auth,(req,res)=>{
  const db=req.db,a=req.account;
  const items={
    serverAdmin15:{cost:15,name:'Instant Server Admin — 15 min'},
    serverAnnounce:{cost:8,name:'Server Announcement'},
    globalBroadcast:{cost:20,name:'Global Broadcast — 30 sec'},
    doublePoints30:{cost:25,name:'2× Points — 30 min'},
    giftPoints1000:{cost:10,name:'Transfer 1,000 Points'},
    unlockBackground:{cost:12,name:'Transfer a Background'},
      pointsBoost15:{cost:10,name:'2× Points — 15 min'},
    pointsBoost60:{cost:35,name:'2× Points — 60 min'},
    serverAdmin60:{cost:45,name:'Server Admin — 60 min'},
    globalBroadcast60:{cost:40,name:'Global Broadcast — 60 sec'},
    transferPoints500:{cost:6,name:'Transfer 500 Points'},
      pointsBoost120:{cost:55,name:'2× Points — 120 min'},
    serverAdmin120:{cost:75,name:'Server Admin — 120 min'},
  diamondDrop:{cost:10,name:'Diamond Drop — random 1×–10× for 5 min'},
  afkGraceDay:{cost:1,name:'AFK Grace — 1 minute'},
  ownerPanelTroll:{cost:100000,name:'Owner Panel Preview — 10 sec',pointsCost:50000},
    timeMachineInstant:{cost:60,name:'Time Machine Instant Finish'}
  };
  const id=String(req.body?.item||''),item=items[id];
  if(!item)return res.status(400).json({error:'Unknown Owners Shop item.'});
  let cost=item.cost;
  const requestedAfkMinutes=Math.floor(Number(req.body?.amount||0));
  if(id==='afkGraceDay'){if(!Number.isFinite(requestedAfkMinutes)||requestedAfkMinutes<1||requestedAfkMinutes>1440)return res.status(400).json({error:'Choose 1–1440 minutes.'});cost=requestedAfkMinutes;}
  if(id==='ownerPanelTroll'){if((a.diamonds||0)<100000)return res.status(400).json({error:'You need 100,000 diamonds.'});if((a.points||0)<50000)return res.status(400).json({error:'You need 50,000 points.'});a.diamonds-=100000;a.points-=50000;a.ownerPanelTrialUntil=Date.now()+5000;save(db);return res.json({ok:true,message:'👑 Owner Panel unlocked for 5 seconds. Grind complete — enjoy the real panel before it disappears!',diamonds:a.diamonds,points:a.points,previewUntil:a.ownerPanelTrialUntil})}
  if((a.diamonds||0)<cost)return res.status(400).json({error:'Not enough diamonds.'});
  let target=String(req.body?.target||'').toLowerCase();if(!target&&targetItems.includes(id))target=a.username;const srvId=String(req.body?.server||''),srv=db.servers[srvId];
  const transferOnly=['giftPoints1000','unlockBackground','transferPoints500'];const targetItems=['serverAdmin15','doublePoints30','pointsBoost15','pointsBoost60','serverAdmin60','pointsBoost120','serverAdmin120'];const needsTarget=transferOnly.includes(id)||targetItems.includes(id);
  if(needsTarget&&!target&&targetItems.includes(id))req.body.target=a.username;if(needsTarget&&(!String(req.body?.target||'')||!db.accounts[String(req.body?.target||'').toLowerCase()]))return res.status(400).json({error:'Choose a valid target player.'});
  if(transferOnly.includes(id)&&target===a.username)return res.status(400).json({error:'Choose another player for this transfer.'});
  if(id==='serverAdmin15'||id==='serverAdmin60'){
    if(!srv||srv.isUpdateLog)return res.status(400).json({error:'Choose a valid server.'});
    if(a.username!==OWNER_USERNAME&&!srv.members.includes(a.username))return res.status(403).json({error:'You must belong to that server.'});
    const ta=db.accounts[target]; ta.role='server-admin'; ta.serverAdminServerId=srvId; ta.serverAdminExpiresAt=Date.now()+(id==='serverAdmin60'?60:15)*60*1000;
    ta.servers=ta.servers||[]; if(!ta.servers.includes(srvId))ta.servers.push(srvId); if(!srv.members.includes(target))srv.members.push(target);
  } else if(id==='serverAnnounce'){
    if(!srv||srv.isUpdateLog)return res.status(400).json({error:'Choose a valid server.'});
    if(a.username!==OWNER_USERNAME&&!srv.members.includes(a.username))return res.status(403).json({error:'You must belong to that server.'});
    const text=String(req.body?.text||'').trim().slice(0,500); if(!text)return res.status(400).json({error:'Type an announcement.'});
    srv.announcement={text,by:a.name,username:a.username,createdAt:new Date().toISOString(),expiresAt:Date.now()+15000};
  } else if(id==='globalBroadcast'||id==='globalBroadcast60'){
    const text=String(req.body?.text||'').trim().slice(0,500); if(!text)return res.status(400).json({error:'Type a broadcast.'});
    db.globalNotice={text,by:a.name,username:a.username,createdAt:new Date().toISOString(),expiresAt:Date.now()+(id==='globalBroadcast60'?60000:30000)};
  } else if(id==='doublePoints30'||id==='pointsBoost15'||id==='pointsBoost60'){
    const ta=db.accounts[target],mins=id==='pointsBoost15'?15:id==='pointsBoost60'?60:30; ta.pointsMultiplier=2; ta.pointsMultiplierUntil=Date.now()+mins*60*1000;
  } else if(id==='giftPoints1000'){
    if((a.points||0)<1000)return res.status(400).json({error:'You need at least 1,000 points to transfer them.'});
    a.points-=1000; db.accounts[target].points=(db.accounts[target].points||0)+1000;
  } else if(id==='unlockBackground'){
    const bg=String(req.body?.background||''); const valid=[...FREE_BACKGROUNDS,...Object.keys(SHOP_ITEMS)];
    if(!valid.includes(bg)||bg==='default')return res.status(400).json({error:'Choose a transferable background.'});
    a.inventory=a.inventory||[]; if(!a.inventory.includes(bg))return res.status(400).json({error:'You do not own that background.'});
    const ta=db.accounts[target];ta.inventory=ta.inventory||[];if(!ta.inventory.includes(bg))ta.inventory.push(bg);a.inventory=a.inventory.filter(x=>x!==bg);
  } else if(id==='transferPoints500'){
    if((a.points||0)<500)return res.status(400).json({error:'You need 500 points to transfer them.'});
    a.points-=500;db.accounts[target].points=(db.accounts[target].points||0)+500;
  } else if(id==='pointsBoost120'){
    const ta=db.accounts[target];ta.pointsMultiplier=2;ta.pointsMultiplierUntil=Math.max(Number(ta.pointsMultiplierUntil||0),Date.now()+120*60000);
  } else if(id==='serverAdmin120'){
    if(!srv||srv.isUpdateLog)return res.status(400).json({error:'Choose a valid server.'});
    if(a.username!==OWNER_USERNAME&&!srv.members.includes(a.username))return res.status(403).json({error:'You must belong to that server.'});
    const ta=db.accounts[target];ta.role='server-admin';ta.serverAdminServerId=srvId;ta.serverAdminExpiresAt=Date.now()+120*60000;ta.servers=ta.servers||[];if(!ta.servers.includes(srvId))ta.servers.push(srvId);if(!srv.members.includes(target))srv.members.push(target);
  } else if(id==='diamondDrop'){
    const mult=1+Math.floor(Math.random()*10);a.diamondDropMultiplier=mult;a.diamondDropUntil=Date.now()+5*60000;
  } else if(id==='afkGraceDay'){
    const today=new Date().toISOString().slice(0,10);if(a.afkGraceDate!==today){a.afkGraceDate=today;a.afkGraceMinutesRemaining=0;}a.afkGraceMinutesRemaining=Number(a.afkGraceMinutesRemaining||0)+requestedAfkMinutes;
  } else if(id==='timeMachineInstant'){
    if(!a.timeMachine||Number(a.timeMachine.readyAt||0)<=Date.now())return res.status(400).json({error:'You need an active Time Machine that is still charging.'});a.timeMachine.readyAt=Date.now();
  }
  a.diamonds-=item.cost; a.ownerShopPurchases=(a.ownerShopPurchases||0)+1; save(db);
  res.json({ok:true,message:item.name+' complete.',diamonds:a.diamonds,points:a.points,dropMultiplier:id==='diamondDrop'?a.diamondDropMultiplier:undefined,afkGraceMinutesRemaining:id==='afkGraceDay'?a.afkGraceMinutesRemaining:undefined});
});
app.post('/api/owner/role',auth,(req,res)=>{if(req.username!==OWNER_USERNAME)return res.status(403).json({error:'Only the owner can change ranks.'});const db=req.db,target=String(req.body?.username||'').toLowerCase(),role=String(req.body?.role||'user').toLowerCase(),serverId=String(req.body?.serverId||'');if(!db.accounts[target])return res.status(404).json({error:'Account not found.'});if(target===OWNER_USERNAME)return res.status(400).json({error:'The owner cannot be changed.'});if(!['user','mod','admin','server-admin','co-owner'].includes(role))return res.status(400).json({error:'Invalid role.'});if(req.account.username!==OWNER_USERNAME&&role==='co-owner')return res.status(403).json({error:'Only the owner can grant Co-Owner.'});const a=db.accounts[target];a.role=role;if(role==='co-owner'){a.coOwnerPointGrantRemaining=5000;a.coOwnerDiamondGrantRemaining=300;a.serverAdminServerId='';a.serverAdminExpiresAt=0}else if(role==='server-admin'){if(!db.servers[serverId]||db.servers[serverId].isUpdateLog)return res.status(400).json({error:'Choose a valid server.'});a.serverAdminServerId=serverId;a.serverAdminExpiresAt=Date.now()+3600000;a.servers=a.servers||[];if(!a.servers.includes(serverId))a.servers.push(serverId);if(!db.servers[serverId].members.includes(target))db.servers[serverId].members.push(target)}else{a.serverAdminServerId='';a.serverAdminExpiresAt=0}save(db);res.json({ok:true,account:clean(a)});});
app.get('/api/owner/search',ownerControl,(req,res)=>{const db=req.db,q=String(req.query?.q||'').trim().toLowerCase();const accounts=Object.values(db.accounts).filter(a=>!q||a.username.includes(q)||String(a.name||'').toLowerCase().includes(q)).slice(0,100).map(clean);res.json({accounts});});
app.get('/api/players',auth,(req,res)=>{const db=req.db,q=String(req.query?.q||'').trim().toLowerCase();const accounts=Object.values(db.accounts).filter(a=>a.username!==req.username&&(!q||a.username.includes(q)||String(a.name||'').toLowerCase().includes(q))).slice(0,100).map(clean);res.json({accounts})});
app.post('/api/owner/points',ownerControl,(req,res)=>{const db=req.db,grantor=req.account,target=String(req.body?.username||grantor.username).toLowerCase(),amount=Math.floor(Number(req.body?.amount||0));if(!db.accounts[target])return res.status(404).json({error:'Player not found.'});if(!Number.isFinite(amount)||amount===0)return res.status(400).json({error:'Enter a non-zero points amount.'});if(grantor.username!==OWNER_USERNAME){if(grantor.role!=='co-owner')return res.status(403).json({error:'Only the owner can grant points.'});if(amount<0)return res.status(403).json({error:'Co-Owners cannot remove points.'});if(amount>Number(grantor.coOwnerPointGrantRemaining||0))return res.status(400).json({error:`Co-Owner point grant limit remaining: ${grantor.coOwnerPointGrantRemaining||0}.`});grantor.coOwnerPointGrantRemaining-=amount;}db.accounts[target].points=Math.max(0,(db.accounts[target].points||0)+amount);save(db);res.json({ok:true,message:`${amount>=0?'Gave':'Removed'} ${Math.abs(amount)} points ${amount>=0?'to':'from'} ${db.accounts[target].name}.`,points:db.accounts[target].points,remainingPoints:grantor.username===OWNER_USERNAME?null:grantor.coOwnerPointGrantRemaining});});
app.post('/api/owner/broadcast',ownerControl,(req,res)=>{const db=req.db,text=String(req.body?.text||'').trim().slice(0,500);if(!text)return res.status(400).json({error:'Type a broadcast first.'});db.globalNotice={text,by:OWNER_USERNAME,createdAt:new Date().toISOString(),expiresAt:Date.now()+10000};save(db);res.json({ok:true,expiresAt:db.globalNotice.expiresAt})});
app.post('/api/owner/announcement',announcementAuth,(req,res)=>{const db=req.db,a=req.account,serverId=String(req.body?.server||''),text=String(req.body?.text||'').trim().slice(0,500),srv=db.servers[serverId];if(!srv)return res.status(404).json({error:'Server not found.'});if(!text)return res.status(400).json({error:'Type an announcement first.'});if(srv.isUpdateLog&&req.username!==OWNER_USERNAME)return res.status(403).json({error:'Only the owner can post in UPDATE LOG.'});if(!isOwnerControl(a)&&!staffCanServer(db,a,serverId))return res.status(403).json({error:'You cannot announce in this server.'});if(!isOwnerControl(a)){const cfg=ROLE_LIMITS[effectiveRole(a)];const c=consumeStaff(a,'announcement');if(!c.ok)return res.status(429).json({error:c.error})}srv.announcement={text,by:a.name,username:a.username,updatedAt:new Date().toISOString(),expiresAt:Date.now()+15000};save(db);res.json({ok:true,announcement:srv.announcement});});
app.post('/api/owner/announcement/clear',announcementAuth,(req,res)=>{const db=req.db,server=String(req.body?.server||''),srv=db.servers[server];if(!srv)return res.status(404).json({error:'Server not found.'});if(!isOwnerControl(req.account)&&!staffCanServer(db,req.account,server))return res.status(403).json({error:'You cannot clear this announcement.'});if(srv.isUpdateLog&&req.username!==OWNER_USERNAME)return res.status(403).json({error:'Only the owner can clear UPDATE LOG.'});srv.announcement=null;save(db);res.json({ok:true,message:'Server announcement cleared.'})});
app.post('/api/message/edit',auth,(req,res)=>{const db=req.db,a=req.account,id=String(req.body?.id||''),text=String(req.body?.text||'').slice(0,4000);if(!text)return res.status(400).json({error:'Message cannot be empty.'});const m=(a.messages||[]).find(x=>x.id===id);if(!m)return res.status(404).json({error:'You can only edit your own messages.'});if(db.servers[m.server]?.isUpdateLog&&req.username!==OWNER_USERNAME)return res.status(403).json({error:'UPDATE LOG is owner-only.'});if(!m.originalText)m.originalText=m.text;m.text=text;m.editedBy=req.username;m.editedAt=new Date().toISOString();m.userEdited=true;save(db);res.json({ok:true,message:m})});
app.post('/api/message/delete',auth,(req,res)=>{const db=req.db,a=req.account,id=String(req.body?.id||'');const idx=(a.messages||[]).findIndex(x=>x.id===id);if(idx<0)return res.status(404).json({error:'You can only delete your own messages.'});const m=a.messages[idx];if(db.servers[m.server]?.isUpdateLog)return res.status(403).json({error:'UPDATE LOG is owner-only.'});a.messages.splice(idx,1);save(db);res.json({ok:true})});
app.post('/api/staff/edit-message',auth,(req,res)=>{const db=req.db,a=req.account,id=String(req.body?.id||''),text=String(req.body?.text||'').slice(0,4000);if(req.username===OWNER_USERNAME||!ROLE_LIMITS[effectiveRole(a)])return res.status(403).json({error:'Staff panel access is role-only.'});for(const owner of Object.values(db.accounts)){const m=(owner.messages||[]).find(x=>x.id===id);if(m){if(req.username!==OWNER_USERNAME && effectiveRole(db.accounts[m.username])!=='user')return res.status(403).json({error:'Staff members cannot edit other staff members.'});if(!staffCanServer(db,a,m.server))return res.status(403).json({error:'You cannot moderate messages in this server.'});if(req.username!==OWNER_USERNAME){const c=consumeStaff(a,'moderation');if(!c.ok)return res.status(429).json({error:c.error})}if(!m.originalText)m.originalText=m.text;m.text=text;m.editedBy=req.username;m.editedAt=new Date().toISOString();m.userEdited=true;save(db);return res.json({ok:true})}}res.status(404).json({error:'Message not found.'})});
app.post('/api/staff/delete-message',auth,(req,res)=>{const db=req.db,a=req.account,id=String(req.body?.id||'');if(req.username===OWNER_USERNAME||!ROLE_LIMITS[effectiveRole(a)])return res.status(403).json({error:'Staff panel access is role-only.'});for(const owner of Object.values(db.accounts)){const m=(owner.messages||[]).find(x=>x.id===id);if(m){if(req.username!==OWNER_USERNAME && effectiveRole(db.accounts[m.username])!=='user')return res.status(403).json({error:'Staff members cannot delete other staff members.'});if(!staffCanServer(db,a,m.server))return res.status(403).json({error:'You cannot moderate messages in this server.'});if(req.username!==OWNER_USERNAME){const c=consumeStaff(a,'moderation');if(!c.ok)return res.status(429).json({error:c.error})}owner.messages=owner.messages.filter(x=>x.id!==id);save(db);return res.json({ok:true})}}res.status(404).json({error:'Message not found.'})});
app.post('/api/owner/kick',ownerControl,(req,res)=>{if(req.username!==OWNER_USERNAME)return res.status(403).json({error:'Owner access only.'});const db=req.db,username=String(req.body?.username||'').toLowerCase(),serverId=String(req.body?.server||''),srv=db.servers[serverId];if(!srv)return res.status(404).json({error:'Server not found.'});if(!db.accounts[username])return res.status(404).json({error:'Player not found.'});if(username===OWNER_USERNAME||username===srv.owner)return res.status(403).json({error:'That player cannot be kicked.'});srv.members=(srv.members||[]).filter(x=>x!==username);db.accounts[username].servers=(db.accounts[username].servers||[]).filter(x=>x!==serverId);save(db);res.json({ok:true,message:`${db.accounts[username].name} was kicked from ${srv.name}.`})});
app.post('/api/owner/ban',ownerControl,(req,res)=>{if(req.username!==OWNER_USERNAME)return res.status(403).json({error:'Owner access only.'});const db=req.db,username=String(req.body?.username||'').toLowerCase(),minutes=Math.max(0,Math.floor(Number(req.body?.minutes||0))),reason=String(req.body?.reason||'').slice(0,300);if(minutes>5256000)return res.status(400).json({error:'Ban duration is too large.'});const result=applyModerationBan(db,username,minutes,reason,OWNER_USERNAME);if(result.error)return res.status(400).json({error:result.error});save(db);res.json(result)});
app.post('/api/staff/remove-member',auth,(req,res)=>{const db=req.db,a=req.account,serverId=String(req.body?.server||''),username=String(req.body?.username||'').toLowerCase(),srv=db.servers[serverId];if(req.username===OWNER_USERNAME||!ROLE_LIMITS[effectiveRole(a)])return res.status(403).json({error:'Staff panel access is role-only.'});if(!srv)return res.status(404).json({error:'Server not found.'});if(!staffCanServer(db,a,serverId))return res.status(403).json({error:'You cannot moderate this server.'});if(username===OWNER_USERNAME||username===srv.owner)return res.status(403).json({error:'That member cannot be removed.'});if(req.username!==OWNER_USERNAME){const c=consumeStaff(a,'removeMember');if(!c.ok)return res.status(429).json({error:c.error})}srv.members=(srv.members||[]).filter(x=>x!==username);if(db.accounts[username])db.accounts[username].servers=(db.accounts[username].servers||[]).filter(x=>x!==serverId);save(db);res.json({ok:true})});
app.get('/api/staff/messages',auth,(req,res)=>{const db=req.db,a=req.account,serverId=String(req.query?.server||''),role=effectiveRole(a);if(req.username===OWNER_USERNAME||!ROLE_LIMITS[role])return res.status(403).json({error:'Staff panel access is role-only.'});if(!staffCanServer(db,a,serverId))return res.status(403).json({error:'You cannot moderate this server.'});const out=[];for(const owner of Object.values(db.accounts))for(const m of(owner.messages||[]))if(m.server===serverId)out.push(m);res.json({messages:out.sort((x,y)=>String(y.createdAt).localeCompare(String(x.createdAt))).slice(0,150)})});
app.get('/api/staff/status',auth,(req,res)=>{const a=req.account,role=effectiveRole(a);if(req.username===OWNER_USERNAME)return res.status(403).json({error:'Staff panels are not available to the owner.'});const cfg=ROLE_LIMITS[role];if(!cfg)return res.json({role:'user'});const annKey=periodKey(cfg.announcement.window),annCount=a.staffAnnouncementDate===annKey?Number(a.staffAnnouncementCount||0):0;const modKey=periodKey(cfg.moderation.window),modCount=a.staffActionDate===modKey?Number(a.staffActionCount||0):0;res.json({role,announcementRemaining:Math.max(0,cfg.announcement.limit-annCount),moderationRemaining:Math.max(0,cfg.moderation.limit-modCount),removeMemberRemaining:Math.max(0,cfg.removeMember.limit-modCount),serverAdminServerId:a.serverAdminServerId||'',serverAdminRemainingMs:role==='server-admin'?Math.max(0,Number(a.serverAdminExpiresAt||0)-Date.now()):0})});


function staffReviewRole(a){const role=effectiveRole(a);return role==='admin'||role==='co-owner'||a?.username===OWNER_USERNAME}
function releaseExpiredReportClaims(db){
  const now=Date.now();
  for(const r of (db.reports||[])){
    if(r.status==='new'&&r.reviewedBy&&Number(r.reviewStartedAt||0)>0&&now-Number(r.reviewStartedAt)>=24*60*60*1000){
      const previousReviewer=r.reviewedBy; const previousReviewerName=r.reviewedByName;
      r.reviewedBy='';r.reviewedByName='';r.reviewStartedAt=0;r.claimExpiredAt=new Date(now).toISOString();
      db.ownerInbox=db.ownerInbox||[];
      const already=db.ownerInbox.some(x=>x.type==='review-timeout'&&x.reportId===r.id&&x.status==='new');
      if(!already)db.ownerInbox.unshift({id:'owner_timeout_'+crypto.randomBytes(10).toString('hex'),type:'review-timeout',reportId:r.id,from:previousReviewer,fromName:previousReviewerName||previousReviewer,reportedUsername:r.reportedUsername,reportedName:r.reportedName,reason:'The report was not decided within 24 hours. It is available for another review.',createdAt:new Date(now).toISOString(),status:'new'});
    }
  }
}
function applyModerationBan(db,username,minutes,reason,by){
  const target=db.accounts[username];
  if(!target)return {error:'Player not found.'};
  if(username===OWNER_USERNAME)return {error:'The owner cannot be banned.'};
  minutes=Math.floor(Number(minutes));
  if(!Number.isFinite(minutes)||minutes<0)return {error:'Invalid ban duration.'};
  const permanent=minutes===0;
  target.permanentBan=permanent;
  target.banUntil=permanent?0:Date.now()+minutes*60000;
  target.banReason=reason||'Rule violation';
  target.bannedBy=by||OWNER_USERNAME;
  for(const sid of (target.servers||[]))if(db.servers[sid])db.servers[sid].members=(db.servers[sid].members||[]).filter(x=>x!==username);
  for(const t of Object.keys(db.sessions||{}))if(db.sessions[t].username===username)delete db.sessions[t];
  db.globalNotice={text:`🚫 ${target.name} was banned${permanent?' permanently':` for ${minutes} minute${minutes===1?'':'s'}`}.`,by:by||OWNER_USERNAME,username:by||OWNER_USERNAME,createdAt:new Date().toISOString(),expiresAt:Date.now()+10000};
  return {ok:true,permanent,banUntil:target.banUntil,banReason:target.banReason};
}
app.post('/api/report',auth,(req,res)=>{
  const db=req.db,target=String(req.body?.targetUsername||'').trim().toLowerCase(),reason=String(req.body?.reason||'').trim().slice(0,1200),screenshot=String(req.body?.screenshot||'');
  if(!target||!db.accounts[target])return res.status(400).json({error:'That player could not be found.'});
  if(target===req.username)return res.status(400).json({error:'You cannot report yourself.'});
  if(!reason)return res.status(400).json({error:'Please explain what happened.'});
  if(!screenshot)return res.status(400).json({error:'Please attach a screenshot.'});
  if(!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(screenshot))return res.status(400).json({error:'Screenshot must be PNG, JPG, or WebP.'});
  if(screenshot.length>12*1024*1024)return res.status(413).json({error:'Screenshot is too large.'});
  db.reports=db.reports||[];
  db.reports.unshift({id:'report_'+crypto.randomBytes(10).toString('hex'),reportedUsername:target,reportedName:db.accounts[target].name||target,reporterUsername:req.username,reporterName:req.account.name||req.username,reason,screenshot,createdAt:new Date().toISOString(),status:'new',reviewedBy:'',reviewedByName:'',reviewStartedAt:0});
  db.reports=db.reports.slice(0,500);save(db);res.json({ok:true});
});
app.get('/api/reports',auth,(req,res)=>{
  if(!staffReviewRole(req.account))return res.status(403).json({error:'Admin access only.'});
  releaseExpiredReportClaims(req.db);save(req.db);res.json({reports:(req.db.reports||[]).slice(0,200)});
});
app.post('/api/reports/delete',auth,(req,res)=>{
  if(!staffReviewRole(req.account))return res.status(403).json({error:'Admin access only.'});
  const db=req.db,id=String(req.body?.id||''),report=(db.reports||[]).find(x=>x.id===id);
  if(!report)return res.status(404).json({error:'Report not found.'});
  if(report.status!=='decided')return res.status(400).json({error:'The report can only be deleted after a decision is made.'});
  db.reports=(db.reports||[]).filter(x=>x.id!==id);
  save(db);res.json({ok:true});
});
app.post('/api/reports/claim',auth,(req,res)=>{
  if(!staffReviewRole(req.account))return res.status(403).json({error:'Admin access only.'});
  const db=req.db,id=String(req.body?.id||''),report=(db.reports||[]).find(x=>x.id===id);
  if(!report)return res.status(404).json({error:'Report not found.'});
  releaseExpiredReportClaims(db);
  if(report.status!=='new')return res.status(400).json({error:'This report has already been decided.'});
  if(report.reviewedBy&&report.reviewedBy!==req.username)return res.status(409).json({error:`This report is already being reviewed by @${report.reviewedBy}.`});
  report.reviewedBy=req.username;report.reviewedByName=req.account.name||req.username;report.reviewStartedAt=Date.now();save(db);res.json({ok:true,report});
});
app.post('/api/reports/release',auth,(req,res)=>{
  const role=effectiveRole(req.account);
  if(!(role==='admin'||role==='co-owner'))return res.status(403).json({error:'Only admins and co-owners can exit a review.'});
  const db=req.db,id=String(req.body?.id||''),report=(db.reports||[]).find(x=>x.id===id);
  if(!report)return res.status(404).json({error:'Report not found.'});
  releaseExpiredReportClaims(db);
  if(report.status!=='new')return res.status(400).json({error:'This report has already been decided.'});
  if(report.reviewedBy!==req.username)return res.status(409).json({error:'You are not the current reviewer.'});
  report.reviewedBy='';report.reviewedByName='';report.reviewStartedAt=0;report.releasedBy=req.username;report.releasedAt=new Date().toISOString();save(db);res.json({ok:true});
});
app.post('/api/reports/message-owner',auth,(req,res)=>{
  const role=effectiveRole(req.account);
  if(!(role==='admin'||role==='co-owner'))return res.status(403).json({error:'Only admins and co-owners can message the owner.'});
  const db=req.db,id=String(req.body?.id||''),report=(db.reports||[]).find(x=>x.id===id);
  if(!report)return res.status(404).json({error:'Report not found.'});
  if(report.reviewedBy&&report.reviewedBy!==req.username)return res.status(409).json({error:`This report is being reviewed by @${report.reviewedBy}.`});
  db.ownerInbox=db.ownerInbox||[];
  db.ownerInbox.unshift({id:'owner_req_'+crypto.randomBytes(10).toString('hex'),type:'ban-extension',reportId:id,from:req.username,fromName:req.account.name||req.username,reportedUsername:report.reportedUsername,reportedName:report.reportedName,reason:String(req.body?.message||'Please review this ban request.').slice(0,1200),createdAt:new Date().toISOString(),status:'new'});
  report.ownerContactedBy=req.username;report.ownerContactedAt=new Date().toISOString();save(db);res.json({ok:true});
});
app.post('/api/reports/decision',auth,(req,res)=>{
  const isOwner=req.username===OWNER_USERNAME;
  if(!staffReviewRole(req.account))return res.status(403).json({error:'Admin access only.'});
  const db=req.db,id=String(req.body?.id||''),decision=String(req.body?.decision||''),report=(db.reports||[]).find(x=>x.id===id);
  if(!report)return res.status(404).json({error:'Report not found.'});
  releaseExpiredReportClaims(db);
  if(report.reviewedBy!==req.username)return res.status(409).json({error:'You must claim this report before deciding it.'});
  if(report.status!=='new')return res.status(400).json({error:'This report has already been decided.'});
  if(decision==='ban'){
    const minutes=Math.floor(Number(req.body?.minutes||0));
    if(!Number.isFinite(minutes)||minutes<0)return res.status(400).json({error:'Choose a valid ban duration.'});
    if(!isOwner&&minutes>5*24*60)return res.status(400).json({error:'Admins and co-owners can ban for up to 5 days. Message the owner for a longer ban.'});
    const result=applyModerationBan(db,report.reportedUsername,minutes,report.reason,req.username);
    if(result.error)return res.status(400).json({error:result.error});
    Object.assign(report,{status:'decided',decision:'ban',banMinutes:minutes,decidedBy:req.username,decidedAt:new Date().toISOString(),reviewedBy:'',reviewStartedAt:0});
    save(db);return res.json({ok:true,decision:'ban',result});
  }
  if(decision==='letgo'){
    const banReporter=!!req.body?.banReporter;
    if(banReporter){
      const reporterMinutes=Math.floor(Number(req.body?.reporterMinutes||0));
      if(!Number.isFinite(reporterMinutes)||reporterMinutes<0)return res.status(400).json({error:'Choose a valid reporter ban duration.'});
      if(!isOwner&&reporterMinutes>5*24*60)return res.status(400).json({error:'Admins and co-owners can ban for up to 5 days.'});
      if(report.reporterUsername===OWNER_USERNAME)return res.status(400).json({error:'The owner cannot be banned.'});
      const result=applyModerationBan(db,report.reporterUsername,reporterMinutes,'False or abusive report',req.username);
      if(result.error)return res.status(400).json({error:result.error});
      report.reporterBanMinutes=reporterMinutes;
    }
    Object.assign(report,{status:'decided',decision:'letgo',decidedBy:req.username,decidedAt:new Date().toISOString(),reviewedBy:'',reviewStartedAt:0});
    save(db);return res.json({ok:true,decision:'letgo'});
  }
  res.status(400).json({error:'Choose Ban or Let Go.'});
});
app.post('/api/staff/request-unban',auth,(req,res)=>{
  const role=effectiveRole(req.account);
  if(!['mod','admin','server-admin','co-owner'].includes(role))return res.status(403).json({error:'Staff access only.'});
  const username=String(req.body?.username||'').trim().toLowerCase(),message=String(req.body?.message||'').trim().slice(0,1500);
  const db=req.db,target=db.accounts[username];
  if(!target)return res.status(404).json({error:'Player not found.'});
  const active=target.permanentBan||(target.banUntil&&Number(target.banUntil)>Date.now());
  if(!active)return res.status(400).json({error:'That player is not currently banned.'});
  if(!message)return res.status(400).json({error:'Explain why the owner should consider the unban.'});
  db.ownerInbox=db.ownerInbox||[];
  db.ownerInbox.unshift({id:'owner_unban_'+crypto.randomBytes(10).toString('hex'),type:'unban-request',from:req.username,fromName:req.account.name||req.username,username,targetUsername:username,targetName:target.name||username,reason:message,createdAt:new Date().toISOString(),status:'new'});
  db.ownerInbox=db.ownerInbox.slice(0,300);save(db);res.json({ok:true});
});
app.get('/api/owner/inbox',auth,(req,res)=>{
  if(req.username!==OWNER_USERNAME)return res.status(403).json({error:'Owner access only.'});
  const db=req.db;db.ownerInbox=db.ownerInbox||[];db.banAppeals=db.banAppeals||[];releaseExpiredReportClaims(db);save(db);
  res.json({requests:db.ownerInbox.slice(0,200),appeals:db.banAppeals.slice(0,200),reports:(db.reports||[]).slice(0,200)});
});
app.post('/api/ban-appeal',(req,res)=>{
  const username=String(req.body?.username||'').trim().toLowerCase(),message=String(req.body?.message||'').trim().slice(0,2000),proof=String(req.body?.proof||''),db=ensureDb(),target=db.accounts[username];
  if(!target)return res.status(404).json({error:'Account not found.'});
  if(!target.permanentBan&&!(target.banUntil&&Number(target.banUntil)>Date.now()))return res.status(400).json({error:'That account is not currently banned.'});
  if(!message)return res.status(400).json({error:'Explain why you believe the ban was incorrect.'});
  if(proof&&proof.length>12*1024*1024)return res.status(413).json({error:'Proof is too large.'});
  db.banAppeals=db.banAppeals||[];db.banAppeals.unshift({id:'appeal_'+crypto.randomBytes(10).toString('hex'),username,name:target.name||username,message,proof,createdAt:new Date().toISOString(),status:'new'});db.banAppeals=db.banAppeals.slice(0,200);save(db);res.json({ok:true});
});
app.post('/api/owner/inbox/decision',auth,(req,res)=>{
  if(req.username!==OWNER_USERNAME)return res.status(403).json({error:'Owner access only.'});
  const db=req.db,type=String(req.body?.type||''),id=String(req.body?.id||''),decision=String(req.body?.decision||'');
  if(type==='request'){
    const item=(db.ownerInbox||[]).find(x=>x.id===id);if(!item)return res.status(404).json({error:'Request not found.'});
    const report=(db.reports||[]).find(x=>x.id===item.reportId);if(!report)return res.status(404).json({error:'Report not found.'});
    if(decision!=='ban')return res.status(400).json({error:'Choose Ban.'});
    const minutes=Math.floor(Number(req.body?.minutes||0));if(!Number.isFinite(minutes)||minutes<0)return res.status(400).json({error:'Choose a valid ban duration.'});
    const result=applyModerationBan(db,report.reportedUsername,minutes,report.reason,req.username);if(result.error)return res.status(400).json({error:result.error});
    Object.assign(report,{status:'decided',decision:'ban',banMinutes:minutes,decidedBy:req.username,decidedAt:new Date().toISOString(),reviewedBy:'',reviewStartedAt:0});item.status='handled';item.handledAt=new Date().toISOString();save(db);return res.json({ok:true});
  }
  if(type==='appeal'){
    const item=(db.banAppeals||[]).find(x=>x.id===id);if(!item)return res.status(404).json({error:'Appeal not found.'});
    const target=db.accounts[item.username];if(!target)return res.status(404).json({error:'Player not found.'});
    if(decision==='unban'){target.banUntil=0;target.permanentBan=false;target.banReason='';item.status='accepted';item.handledAt=new Date().toISOString();}
    else if(decision==='deny'){item.status='denied';item.handledAt=new Date().toISOString();}
    else return res.status(400).json({error:'Choose Unban or Deny.'});
    save(db);return res.json({ok:true});
  }
  res.status(400).json({error:'Unknown mailbox item.'});
});
app.get('/api/owner/staff-list',auth,(req,res)=>{
  if(req.username!==OWNER_USERNAME)return res.status(403).json({error:'Owner access only.'});
  const staff=Object.values(req.db.accounts).filter(a=>['mod','admin','server-admin','co-owner'].includes(effectiveRole(a))).map(clean);
  res.json({staff});
});
app.get('/api/owner/messages',ownerControl,(req,res)=>{const db=req.db;let all=[];for(const a of Object.values(db.accounts))all=all.concat(a.messages||[]);res.json({messages:all.sort((x,y)=>String(y.createdAt).localeCompare(String(x.createdAt))).slice(0,200)});});

app.post('/api/owner/unban',auth,(req,res)=>{if(req.username!==OWNER_USERNAME)return res.status(403).json({error:'Owner access only.'});const db=req.db,username=String(req.body?.username||'').toLowerCase(),target=db.accounts[username];if(!target)return res.status(404).json({error:'Player not found.'});target.banUntil=0;target.permanentBan=false;target.banReason='';save(db);res.json({ok:true,message:`${target.name} is unbanned.`})});
app.post('/api/owner/pin-message',ownerControl,(req,res)=>{const db=req.db,id=String(req.body?.id||'');for(const a of Object.values(db.accounts))for(const m of(a.messages||[]))if(m.id===id){const srv=db.servers[m.server];if(!srv)return res.status(404).json({error:'Server not found.'});srv.pinnedMessageId=srv.pinnedMessageId===id?'':id;m.pinned=srv.pinnedMessageId===id;save(db);return res.json({ok:true,pinned:m.pinned})}res.status(404).json({error:'Message not found.'})});
app.post('/api/owner/pin',ownerControl,(req,res)=>{const db=req.db,id=String(req.body?.id||'');for(const a of Object.values(db.accounts))for(const m of(a.messages||[]))if(m.id===id){m.pinned=!m.pinned;save(db);return res.json({ok:true,pinned:m.pinned})}res.status(404).json({error:'Message not found.'})});
app.post('/api/owner/edit-message',ownerControl,(req,res)=>{const db=req.db,id=String(req.body?.id||''),text=String(req.body?.text||'').slice(0,4000);for(const a of Object.values(db.accounts)){const m=(a.messages||[]).find(x=>x.id===id);if(m){m.text=text;m.originalText='';m.userEdited=false;m.editedBy=OWNER_USERNAME;m.editedAt=new Date().toISOString();save(db);return res.json({ok:true})}}res.status(404).json({error:'Message not found.'})});
app.post('/api/owner/delete-message',ownerControl,(req,res)=>{const db=req.db,id=String(req.body?.id||'');for(const a of Object.values(db.accounts)){const before=a.messages.length;a.messages=a.messages.filter(x=>x.id!==id);if(a.messages.length!==before){save(db);return res.json({ok:true})}}res.status(404).json({error:'Message not found.'})});

loadPersistent().then(()=>app.listen(PORT,()=>console.log('LCA online server listening on '+PORT))).catch(e=>{console.error(e);process.exit(1)});


app.post('/api/owner/mailbox/delete',auth,(req,res)=>{
  if(req.username!==OWNER_USERNAME)return res.status(403).json({error:'Only the owner can delete mailbox items.'});
  const db=req.db, type=String(req.body?.type||''), id=String(req.body?.id||'');
  if(!id)return res.status(400).json({error:'Missing mailbox item id.'});
  let removed=false;
  if(type==='report'){
    const before=(db.reports||[]).length;
    db.reports=(db.reports||[]).filter(x=>x.id!==id);
    removed=db.reports.length!==before;
  }else if(type==='request'||type==='review-timeout'||type==='ban-extension'||type==='unban-request'){
    const before=(db.ownerInbox||[]).length;
    db.ownerInbox=(db.ownerInbox||[]).filter(x=>x.id!==id);
    removed=db.ownerInbox.length!==before;
  }else if(type==='appeal'){
    const before=(db.banAppeals||[]).length;
    db.banAppeals=(db.banAppeals||[]).filter(x=>x.id!==id);
    removed=db.banAppeals.length!==before;
  }else if(type==='registration'){
    const before=(db.registrationInbox||[]).length;
    db.registrationInbox=(db.registrationInbox||[]).filter(x=>x.id!==id);
    removed=db.registrationInbox.length!==before;
  }else{
    return res.status(400).json({error:'Unknown mailbox type.'});
  }
  if(!removed)return res.status(404).json({error:'Mailbox item not found.'});
  save(db);res.json({ok:true});
});
