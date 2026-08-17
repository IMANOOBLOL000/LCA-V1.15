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
function effectiveRole(a){if(!a)return 'user';if(String(a.username||'').trim().toLowerCase()===OWNER_USERNAME||a.role==='owner')return 'owner';if(a.role==='server-admin'&&Number(a.serverAdminExpiresAt||0)<=Date.now())return 'user';return a.role||'user'}
function serverRole(db,a,serverId){if(!a||!serverId)return 'user';const srv=db.servers?.[serverId];if(!srv)return 'user';if(String(srv.owner||'').toLowerCase()===String(a.username||'').toLowerCase())return 'server-owner';return String(srv.roles?.[a.username]||'user').toLowerCase()}
function isServerOwner(db,a,serverId){return serverRole(db,a,serverId)==='server-owner'}
function isOwnerControl(a){return !!a&&((String(a.username||'').trim().toLowerCase()===OWNER_USERNAME)||a.role==='owner'||a.role==='co-owner'||Number(a.ownerPanelTrialUntil||0)>Date.now())}
function isRealOwner(a){return !!a&&((String(a.username||'').trim().toLowerCase()===OWNER_USERNAME)||a.role==='owner')}
function clean(a){const x=JSON.parse(JSON.stringify(a));delete x.password;delete x.passwordHash;x.isOwner=(String(a.username||'').trim().toLowerCase()===OWNER_USERNAME)||a.role==='owner';x.isCoOwner=a.role==='co-owner';x.role=effectiveRole(a);x.serverAdminRemainingMs=x.role==='server-admin'?Math.max(0,Number(a.serverAdminExpiresAt||0)-Date.now()):0;x.ownerPanelTrialRemainingMs=Math.max(0,Number(a.ownerPanelTrialUntil||0)-Date.now());return x}
function template(username,name,password,birthday,isOwner=false){return {username,name,passwordHash:hashPassword(password),birthday: birthday||'',points:0,diamonds:0,inventory:[],friends:[],requests:[],servers:['home'],messages:[],description:'',notes:'',avatar:'',linkedAccounts:[],background:'default',role:isOwner?'owner':'user',modAnnouncementDate:'',modAnnouncementCount:0,staffActionDate:'',staffActionCount:0,serverAdminServerId:'',serverAdminExpiresAt:0,ownerPanelTrialUntil:0,coOwnerPointGrantRemaining:5000,coOwnerDiamondGrantRemaining:300,ownerTokens:0,timeBalance:0,timeLastAt:Date.now(),ownerRankLicenses:{mod:0,admin:0},isOwner:!!isOwner}}
function ensureDb(){const db=DB;db.accounts=db.accounts||{};db.servers=db.servers||{};/* Remove the user-created server named exactly 'A'. */for(const [sid,srv] of Object.entries(db.servers)){if(sid!=='home'&&sid!=='updateLog'&&String(srv?.name||'').trim().toLowerCase()==='a')delete db.servers[sid];}db.dms=db.dms||{};db.sessions=db.sessions||{};db.globalNotice=db.globalNotice||null;db.typing=db.typing||{};db.reports=Array.isArray(db.reports)?db.reports:[];for(const legacy of ['modimanoob','adminimanoob','serveradminimanoob']){if(db.accounts[legacy])delete db.accounts[legacy];for(const srv of Object.values(db.servers))if(srv&&Array.isArray(srv.members))srv.members=srv.members.filter(u=>u!==legacy);for(const t of Object.keys(db.sessions))if(db.sessions[t]?.username===legacy)delete db.sessions[t];}if(!db.servers.home)db.servers.home={id:'home',name:'Home',private:false,codeHash:'',owner:OWNER_USERNAME,members:[],announcement:null};db.servers.home.members=db.servers.home.members||[];db.servers.home.announcement=db.servers.home.announcement||null;if(!db.servers.updateLog)db.servers.updateLog={id:'updateLog',name:'UPDATE LOG',private:false,codeHash:'',owner:OWNER_USERNAME,members:[],announcement:null,isUpdateLog:true};db.servers.updateLog.members=db.servers.updateLog.members||[];db.servers.updateLog.isUpdateLog=true;if(!db.servers.rules)db.servers.rules={id:'rules',name:'Rules',private:false,codeHash:'',owner:OWNER_USERNAME,members:[],announcement:null,isRules:true};db.servers.rules.members=db.servers.rules.members||[];db.servers.rules.isRules=true;for(const srv of Object.values(db.servers)){srv.members=srv.members||[];if(!Array.isArray(srv.members))srv.members=[];srv.announcement=srv.announcement||null;srv.voiceOnly=!!srv.voiceOnly;srv.icon=String(srv.icon||'');srv.welcomeMessage=String(srv.welcomeMessage||'');srv.slowModeSeconds=Math.max(0,Number(srv.slowModeSeconds||0));srv.roles=srv.roles||{};}for(const a of Object.values(db.accounts)){a.role=a.username===OWNER_USERNAME?'owner':(a.role||'user');a.modAnnouncementDate=a.modAnnouncementDate||'';a.modAnnouncementCount=Number(a.modAnnouncementCount||0);a.staffActionDate=a.staffActionDate||'';a.staffActionCount=Number(a.staffActionCount||0);a.serverAdminServerId=a.serverAdminServerId||'';a.serverAdminExpiresAt=Number(a.serverAdminExpiresAt||0);a.background=a.background||'default';a.friends=a.friends||[];a.requests=a.requests||[];a.dmRequests=a.dmRequests||[];a.inventory=a.inventory||[];a.messages=a.messages||[];a.timeMachine=a.timeMachine||null;a.pointsMultiplier=Number(a.pointsMultiplier||1);a.pointsMultiplierUntil=Number(a.pointsMultiplierUntil||0);a.diamonds=Number(a.diamonds||0);a.afkGraceDate=a.afkGraceDate||'';a.afkGraceMinutesRemaining=Number(a.afkGraceMinutesRemaining||0);a.diamondDropUntil=Number(a.diamondDropUntil||0);a.diamondDropMultiplier=Number(a.diamondDropMultiplier||1);a.ownerShopPurchases=Number(a.ownerShopPurchases||0);a.ownerPanelTrialUntil=Number(a.ownerPanelTrialUntil||0);a.coOwnerPointGrantRemaining=Math.max(0,Math.min(5000,Number(a.coOwnerPointGrantRemaining??5000)));a.coOwnerDiamondGrantRemaining=Math.max(0,Math.min(300,Number(a.coOwnerDiamondGrantRemaining??300)));a.ownerTokens=Math.max(0,Number(a.ownerTokens||0));a.timeBalance=Math.max(0,Number(a.timeBalance||0));a.timeLastAt=Number(a.timeLastAt||Date.now());a.lastActivityAt=Number(a.lastActivityAt||Date.now());a.ownerRankLicenses=a.ownerRankLicenses||{mod:0,admin:0,serverAdmin:0,serverOwner:0};featureInitAccount(a);a.ownerRankLicenses.serverAdmin=Math.max(0,Number(a.ownerRankLicenses.serverAdmin||0));a.ownerRankLicenses.serverOwner=Math.max(0,Number(a.ownerRankLicenses.serverOwner||0));a.ownerRankLicenses.mod=Math.max(0,Number(a.ownerRankLicenses.mod||0));a.ownerRankLicenses.admin=Math.max(0,Number(a.ownerRankLicenses.admin||0));if(a.role==='server-admin'&&a.serverAdminExpiresAt&&a.serverAdminExpiresAt<=Date.now()){a.role='user';a.serverAdminServerId='';a.serverAdminExpiresAt=0;}a.servers=a.servers||[];if(!a.servers.includes('home'))a.servers.push('home');if(!a.servers.includes('updateLog'))a.servers.push('updateLog');if(!a.servers.includes('rules'))a.servers.push('rules');if(!db.servers.rules.members.includes(a.username))db.servers.rules.members.push(a.username);if(!db.servers.updateLog.members.includes(a.username))db.servers.updateLog.members.push(a.username)}if(!db.accounts[OWNER_USERNAME]){db.accounts[OWNER_USERNAME]=template(OWNER_USERNAME,'CEOIMANOOB',OWNER_PASSWORD,'',true);if(!db.servers.home.members.includes(OWNER_USERNAME))db.servers.home.members.push(OWNER_USERNAME);if(!db.accounts[OWNER_USERNAME].servers.includes('updateLog'))db.accounts[OWNER_USERNAME].servers.push('updateLog');if(!db.servers.updateLog.members.includes(OWNER_USERNAME))db.servers.updateLog.members.push(OWNER_USERNAME)}const rulesText=`# Rules\n\n1. Be respectful.\nTreat everyone fairly. No bullying, harassment, or targeted insults.\n\n2. No threats.\nDo not threaten to hurt, attack, or harm another person.\n\n3. No hate speech.\nDo not attack or use slurs against people based on race, ethnicity, religion, disability, gender, sexual orientation, or other protected characteristics.\n\n4. No sexual harassment.\nDo not make unwanted sexual comments, requests, or advances toward another player.\n\n5. No sexual content involving minors.\nAny sexual content involving minors is strictly prohibited.\n\n6. No inappropriate sexual or graphic content.\nDo not post pornography, graphic sexual material, or excessively disturbing content.\n\n7. No bullying or stalking.\nDo not repeatedly target, follow, intimidate, or harass another player.\n\n8. No doxxing.\nNever share someone's private information, such as their home address, phone number, passwords, or private documents.\n\n9. Protect your own privacy.\nDo not share sensitive personal information with other players.\n\n10. No scams or fraud.\nDo not trick players into giving you money, accounts, passwords, items, or other property.\n\n11. No impersonation.\nDo not pretend to be another player, moderator, administrator, or real person in order to deceive others.\n\n12. No cheating or exploiting.\nDo not use hacks, exploits, bugs, bots, or unauthorized software to gain an unfair advantage.\n\n13. No malicious links or files.\nDo not send viruses, malware, phishing links, or files designed to harm another person's device or account.\n\n14. No spam.\nDo not flood chats with repeated messages, advertisements, or unwanted content.\n\n15. No ban evasion.\nDo not use another account to avoid a ban, mute, suspension, or other moderation action.\n\n16. Respect moderators.\nFollow reasonable moderator instructions. If you disagree with a decision, use the proper appeal or report process.\n\n17. Do not encourage dangerous or illegal behavior.\nDo not encourage people to hurt themselves or others or participate in dangerous or criminal activity.\n\n18. Do not abuse the reporting system.\nOnly submit reports about genuine concerns. Do not make fake reports to get someone punished.\n\n19. Report rule breakers.\nIf you see someone breaking these rules, use the Report button. Explain what happened and provide evidence when possible. Do not retaliate against the person yourself.\n\n20. Help keep the community safe.\nIf something feels unsafe, threatening, or seriously inappropriate, report it to the moderators. Moderators may remove content, warn, mute, suspend, or ban accounts depending on the situation.`;const owner=db.accounts[OWNER_USERNAME];owner.passwordHash=hashPassword(OWNER_PASSWORD);owner.name='CEOIMANOOB';owner.role='owner';owner.inventory=owner.inventory||[];for(const id of Object.keys(SHOP_ITEMS).concat(Object.keys(EMOJI_COSTS)))if(!owner.inventory.includes(id))owner.inventory.push(id);owner.background=owner.background||'default';if(!owner.messages.some(m=>m.server==='rules'&&m.rulesSeed)){owner.messages.push({id:crypto.randomBytes(8).toString('hex'),server:'rules',name:owner.name,username:owner.username,text:rulesText,originalText:'',attachments:[],time:new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),createdAt:new Date().toISOString(),rulesSeed:true});}const updateLogText=`I made this website for people in or out of school so they can enjoy messaging their friends and total strangers. Expect weekly updates.`;const reportText=`If you see anyone violating the rules, take a screenshot and report them in my discord: https://discord.com/channels/1532286082325151856/1532286082799112275 they get reviewed faster`;if(!owner.messages.some(m=>m.server==='updateLog'&&m.updateLogSeed)){owner.messages.push({id:crypto.randomBytes(8).toString('hex'),server:'updateLog',name:owner.name,username:owner.username,text:updateLogText,originalText:'',attachments:[],time:new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),createdAt:new Date().toISOString(),updateLogSeed:true});}if(!owner.messages.some(m=>m.server==='rules'&&m.reportSeed)){owner.messages.push({id:crypto.randomBytes(8).toString('hex'),server:'rules',name:owner.name,username:owner.username,text:reportText,originalText:'',attachments:[],time:new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),createdAt:new Date().toISOString(),reportSeed:true});}save(db);return db}
function createSession(db,username){const t=token();db.sessions[t]={username,createdAt:Date.now(),lastUsed:Date.now()};save(db);return t}
function auth(req,res,next){const t=(req.headers.authorization||'').replace(/^Bearer\s+/,'');const db=ensureDb();const s=db.sessions[t];if(!s||!db.accounts[s.username])return res.status(401).json({error:'Please log in again.'});const a=db.accounts[s.username];if(a.permanentBan|| (a.banUntil&&Number(a.banUntil)>Date.now())){return res.status(403).json({error:'You are banned from LCA.',banned:true,username:s.username,banUntil:Number(a.banUntil),banReason:a.banReason||''})}if(!a.permanentBan&&a.banUntil&&Number(a.banUntil)<=Date.now()){a.banUntil=0;a.banReason='';save(db)}req.previousSessionLastUsed=Number(s.lastUsed||0);s.lastUsed=Date.now();req.token=t;req.username=s.username;req.db=db;req.account=a;req.session=s;next()}
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

app.get('/api/snapshot',auth,(req,res)=>{const db=req.db,a=db.accounts[req.username],x=clean(a);x.servers=effectiveServers(db,req.username);x.messages=effectiveMessages(db,req.username);x.contacts=contacts(db,a);x.linkedProfiles=linkedUsernames(db,req.username).map(u=>clean(db.accounts[u]));x.membersByServer={};x.announcements={};for(const srv of x.servers){x.membersByServer[srv.id]=memberProfiles(db,req.username,srv.id);x.announcements[srv.id]=srv.announcement||null}x.age=ageFrom(a.birthday);featureInitAccount(a);x.globalNotice=(db.globalNotice&&Number(db.globalNotice.expiresAt)>Date.now())?db.globalNotice:null;x.following=a.following||[];x.followers=a.followers||[];x.achievements=a.achievements||[];x.badges=a.badges||[];x.level=Number(a.level||1);x.xp=Number(a.xp||0);x.status=a.status||'';x.pets=a.pets||[];res.json({account:x})});
app.post('/api/profile',auth,(req,res)=>{const db=req.db,a=req.account,b=req.body||{};if(typeof b.name==='string'&&b.name.trim())a.name=b.name.trim().slice(0,40);if(typeof b.description==='string')a.description=b.description.slice(0,600);if(typeof b.notes==='string')a.notes=b.notes.slice(0,2000);if(typeof b.avatar==='string')a.avatar=b.avatar.slice(0,10000000);save(db);res.json({account:clean(a)})});

app.post('/api/background',auth,(req,res)=>{const db=req.db,a=req.account,id=String(req.body?.id||'default');const valid=[...FREE_BACKGROUNDS,...Object.keys(SHOP_ITEMS)];if(!valid.includes(id))return res.status(400).json({error:'Unknown background.'});if(a.username===OWNER_USERNAME){a.background=id;save(db);return res.json({ok:true,background:id})}if(id!=='default'&&!(a.inventory||[]).includes(id))return res.status(403).json({error:'Buy that background first.'});a.background=id;save(db);res.json({ok:true,background:id})});

app.post('/api/message',auth,(req,res)=>{const db=req.db,a=req.account,{server,text,attachments}=req.body||{};if(!db.servers[server]||!effectiveServers(db,req.username).some(s=>s.id===server))return res.status(403).json({error:'You are not in that server.'});if(db.servers[server].frozen&&!isRealOwner(a)&&!isServerOwner(db,a,server))return res.status(403).json({error:'This server is currently frozen by the Owner.'});if((db.servers[server].isUpdateLog||db.servers[server].isRules)&&req.username!==OWNER_USERNAME)return res.status(403).json({error:db.servers[server].isRules?'Only the owner can post in RULES.':'Only the owner can post in UPDATE LOG.'});const cleanText=String(text||'').slice(0,4000),atts=Array.isArray(attachments)?attachments.slice(0,5):[];
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
app.post('/api/server',auth,(req,res)=>{const db=req.db,a=req.account,name=String(req.body?.name||'').trim(),privateServer=!!req.body?.private,code=String(req.body?.code||''),voiceOnly=!!req.body?.voiceOnly;if(!name)return res.status(400).json({error:'Enter a server name.'});if(Object.values(db.servers).some(s=>String(s.name||'').toLowerCase()===name.toLowerCase()))return res.status(409).json({error:'A server with that name already exists.'});if(privateServer&&code.length<4)return res.status(400).json({error:'Private server codes must be at least 4 characters.'});const id='s_'+crypto.randomBytes(7).toString('hex');db.servers[id]={id,name:name.slice(0,60),private:privateServer,codeHash:privateServer?hashPassword(code):'',owner:a.username,members:[a.username],roles:{[a.username]:'server-owner'},announcement:null,voiceOnly:voiceOnly,icon:'',welcomeMessage:'',slowModeSeconds:0};a.servers.push(id);save(db);res.json({ok:true,server:db.servers[id]})});
app.get('/api/servers/public',auth,(req,res)=>{const db=req.db,q=String(req.query?.q||'').trim().toLowerCase();const servers=Object.values(db.servers).filter(x=>x&&!x.isUpdateLog&&!x.isRules&&!x.private&&(!q||String(x.name||'').toLowerCase().includes(q))).slice(0,100).map(x=>({id:x.id,name:x.name,voiceOnly:!!x.voiceOnly,members:(x.members||[]).length}));res.json({servers})});
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
app.post('/api/points/reward',auth,(req,res)=>{const db=req.db,a=req.account,now=Date.now(),lastReward=Number(a.lastRewardAt||0),lastActivity=Number(a.lastActivityAt||now);const today=new Date().toISOString().slice(0,10);if(a.afkGraceDate!==today){a.afkGraceDate=today;a.afkGraceMinutesRemaining=0;}let afk=now-lastActivity>300000;if(afk){const last=Number(a.lastAfkCheckAt||now);const elapsed=Math.max(0,now-last);if(Number(a.afkGraceMinutesRemaining||0)>0){const consume=Math.min(Number(a.afkGraceMinutesRemaining||0),Math.max(1,Math.ceil(elapsed/60000)));a.afkGraceMinutesRemaining-=consume;afk=false;}a.lastAfkCheckAt=now;}if(afk){a.lastRewardAt=now;save(db);return res.json({points:a.points||0,awarded:0,afk:true,afkGraceMinutesRemaining:a.afkGraceMinutesRemaining||0})}if(lastReward&&now-lastReward<55000)return res.json({points:a.points||0,awarded:0});const baseMult=Number(a.pointsMultiplierUntil||0)>now?Number(a.pointsMultiplier||1):1;const dropMult=Number(a.diamondDropUntil||0)>now?Number(a.diamondDropMultiplier||1):1;const petMult=typeof petStats==='function'?petStats(a).point:1;const awarded=Math.floor(3*baseMult*dropMult*petMult);a.points=(a.points||0)+awarded;a.lastRewardAt=now;save(db);res.json({points:a.points,awarded,afk:false,afkGraceMinutesRemaining:a.afkGraceMinutesRemaining||0,dropMultiplier:dropMult})});
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
app.post('/api/owner/give-time',ownerOnly,(req,res)=>{const db=req.db,target=String(req.body?.username||req.username||'').trim().toLowerCase(),amount=Math.floor(Number(req.body?.amount||0));if(!db.accounts[target])return res.status(404).json({error:'Player not found.'});if(!Number.isInteger(amount)||amount<1)return res.status(400).json({error:'Time amount must be a positive whole number.'});db.accounts[target].timeBalance=(db.accounts[target].timeBalance||0)+amount;db.accounts[target].timeLastAt=Date.now();save(db);res.json({ok:true,timeBalance:db.accounts[target].timeBalance})});
app.post('/api/owner/give-diamonds',ownerOnly,(req,res)=>{const db=req.db,target=String(req.body?.username||req.username||'').trim().toLowerCase(),amount=Math.floor(Number(req.body?.amount||0));if(!db.accounts[target])return res.status(404).json({error:'Player not found.'});if(!Number.isInteger(amount)||amount<1)return res.status(400).json({error:'Diamond amount must be a positive whole number.'});db.accounts[target].diamonds=(db.accounts[target].diamonds||0)+amount;save(db);res.json({ok:true,diamonds:db.accounts[target].diamonds})});
app.post('/api/owner/give-points',ownerOnly,(req,res)=>{const db=req.db,target=String(req.body?.username||req.username||'').trim().toLowerCase(),amount=Math.floor(Number(req.body?.amount||0));if(!db.accounts[target])return res.status(404).json({error:'Player not found.'});if(!Number.isInteger(amount)||amount<1)return res.status(400).json({error:'Point amount must be a positive whole number.'});db.accounts[target].points=(db.accounts[target].points||0)+amount;save(db);res.json({ok:true,points:db.accounts[target].points})});
app.post('/api/owner/diamonds',ownerControl,(req,res)=>{const db=req.db,grantor=req.account,target=String(req.body?.target||grantor.username).toLowerCase(),amount=Math.floor(Number(req.body?.amount||0));if(!db.accounts[target])return res.status(404).json({error:'Player not found.'});if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:'Enter a positive diamond amount.'});if(grantor.username!==OWNER_USERNAME){if(grantor.role!=='co-owner')return res.status(403).json({error:'Only the owner can grant diamonds.'});if(amount>Number(grantor.coOwnerDiamondGrantRemaining||0))return res.status(400).json({error:`Co-Owner diamond grant limit remaining: ${grantor.coOwnerDiamondGrantRemaining||0}.`});grantor.coOwnerDiamondGrantRemaining-=amount;}db.accounts[target].diamonds=(db.accounts[target].diamonds||0)+amount;save(db);res.json({ok:true,target,amount,diamonds:db.accounts[target].diamonds})});
app.get('/api/time-machine/status',auth,(req,res)=>{const a=req.account;res.json({pending:a.timeMachine||null,multiplier:Number(a.pointsMultiplierUntil||0)>Date.now()?Number(a.pointsMultiplier||1):1,multiplierUntil:Number(a.pointsMultiplierUntil||0)})});
app.get('/api/time-machine/tiers',auth,(req,res)=>res.json({tiers:TIME_MACHINE_TIERS}));
app.post('/api/time-machine/start',auth,(req,res)=>{const a=req.account,t=TIME_MACHINE_TIERS.find(x=>x.id===String(req.body?.tier||''));if(!t)return res.status(400).json({error:'Unknown Time Machine tier.'});if(a.timeMachine&&Number(a.timeMachine.readyAt)>Date.now())return res.status(400).json({error:'A Time Machine is already running.'});if((a.points||0)<t.cost)return res.status(400).json({error:'Not enough points.'});const now=Date.now(),role=effectiveRole(a),staffBypass=['owner','mod','admin','server-admin'].includes(role);a.points-=t.cost;a.timeMachine={tier:t.id,label:t.label,multiplier:t.multiplier,startedAt:now,readyAt:staffBypass?now:now+1800000,skipWait:staffBypass};save(req.db);res.json({ok:true,points:a.points,timeMachine:a.timeMachine})});
app.post('/api/time-machine/claim',auth,(req,res)=>{const a=req.account,tm=a.timeMachine;if(!tm)return res.status(400).json({error:'No Time Machine is ready.'});if(Number(tm.readyAt)>Date.now())return res.status(400).json({error:'The Time Machine is still charging.'});a.pointsMultiplier=Number(tm.multiplier||1);a.pointsMultiplierUntil=Date.now()+3600000;a.timeMachine=null;const flip=Math.random()<0.5?'HEADS':'TAILS';save(req.db);res.json({ok:true,points:a.points,multiplier:a.pointsMultiplier,multiplierUntil:a.pointsMultiplierUntil,flip})});

app.get('/api/time/status',auth,(req,res)=>{const a=req.account,now=Date.now();const last=Number(a.timeLastAt||now);const elapsed=Math.max(0,now-last);const earned=Math.floor(elapsed/60000);if(earned>0){a.timeBalance=Number(a.timeBalance||0)+earned;a.timeLastAt=last+earned*60000;save(req.db)}res.json({time:Number(a.timeBalance||0),ownerTokens:Number(a.ownerTokens||0),diamonds:Number(a.diamonds||0),minutes:earned,active:true,rate:'1 Time per minute while logged in'});});
app.post('/api/time/exchange',auth,(req,res)=>{const a=req.account,type=String(req.body?.type||'');let need=0,give=0;if(type==='token'){need=10;give=Math.max(1,Math.floor((typeof petStats==='function'?petStats(a).token:1)))}else if(type==='diamond'){need=5;give=Math.max(1,Math.floor((typeof petStats==='function'?petStats(a).diamond:1)))}else return res.status(400).json({error:'Unknown exchange.'});if((a.timeBalance||0)<need)return res.status(400).json({error:`You need ${need} time.`});a.timeBalance-=need;if(type==='token')a.ownerTokens=(a.ownerTokens||0)+give;else a.diamonds=(a.diamonds||0)+give;save(req.db);res.json({ok:true,time:a.timeBalance,ownerTokens:a.ownerTokens||0,diamonds:a.diamonds||0})});
app.post('/api/owner/give-owner-token',ownerOnly,(req,res)=>{const db=req.db,target=String(req.body?.username||req.username||'').trim().toLowerCase(),amount=Math.floor(Number(req.body?.amount||0));if(!Number.isInteger(amount)||amount<1)return res.status(400).json({error:'Owner Token amount must be a positive whole number.'});const acc=db.accounts[target];if(!acc)return res.status(404).json({error:'Player not found.'});acc.ownerTokens=Number(acc.ownerTokens||0)+amount;save(db);res.json({ok:true,username:acc.username,ownerTokens:acc.ownerTokens});});
app.post('/api/owner/tokens',ownerOnly,(req,res)=>{const db=req.db,target=String(req.body?.username||req.username||'').trim().toLowerCase(),amount=Math.floor(Number(req.body?.amount||0));if(!Number.isInteger(amount)||amount<1)return res.status(400).json({error:'Owner Token amount must be a positive whole number.'});const acc=db.accounts[target];if(!acc)return res.status(404).json({error:'Player not found.'});acc.ownerTokens=Number(acc.ownerTokens||0)+amount;save(db);res.json({ok:true,username:acc.username,ownerTokens:acc.ownerTokens});});
app.post('/api/owner/rank-license',ownerControl,(req,res)=>{if(!isRealOwner(req.account))return res.status(403).json({error:'Only the Owner can give rank licenses.'});const db=req.db,target=String(req.body?.target||'').toLowerCase(),rank=String(req.body?.rank||'mod');if(!db.accounts[target])return res.status(404).json({error:'Player not found.'});if(!['mod','admin'].includes(rank))return res.status(400).json({error:'Invalid rank license.'});db.accounts[target].ownerRankLicenses=db.accounts[target].ownerRankLicenses||{mod:0,admin:0};db.accounts[target].ownerRankLicenses[rank]=(db.accounts[target].ownerRankLicenses[rank]||0)+1;save(db);res.json({ok:true,licenses:db.accounts[target].ownerRankLicenses})});
app.post('/api/server-owner/grant',auth,(req,res)=>{const db=req.db,a=req.account,sid=String(req.body?.serverId||''),target=String(req.body?.target||'').toLowerCase(),type=String(req.body?.type||''),amount=Math.floor(Number(req.body?.amount||0));const srv=db.servers[sid];if(!srv||!isServerOwner(db,a,sid))return res.status(403).json({error:'Server Owner access required.'});if(!srv.members.includes(target)||!db.accounts[target])return res.status(400).json({error:'That player is not in this server.'});if(type==='points'){if(amount<1||amount>500)return res.status(400).json({error:'Server Owner can give 1–500 points at a time.'});db.accounts[target].points=(db.accounts[target].points||0)+amount}else if(type==='diamonds'){if(amount<1||amount>50)return res.status(400).json({error:'Server Owner can give 1–50 diamonds at a time.'});db.accounts[target].diamonds=(db.accounts[target].diamonds||0)+amount}else return res.status(400).json({error:'Unknown grant.'});save(db);res.json({ok:true,points:db.accounts[target].points,diamonds:db.accounts[target].diamonds})});
app.post('/api/server-owner/buy-license',auth,(req,res)=>{const db=req.db,a=req.account,sid=String(req.body?.serverId||''),rank=String(req.body?.rank||'mod');if(!isServerOwner(db,a,sid))return res.status(403).json({error:'Server Owner access required.'});const costs={mod:{t:5,d:0,p:0},admin:{t:20,d:20,p:0},serverAdmin:{t:30,d:50,p:0},serverOwner:{t:25,d:50,p:500}};if(!costs[rank])return res.status(400).json({error:'Invalid rank license.'});const current=String(db.servers[sid].roles?.[a.username]||'user'),allowed={user:['mod'],mod:['admin'],admin:['serverAdmin','serverOwner']};if(!(allowed[current]||[]).includes(rank))return res.status(400).json({error:`${rank} is not unlocked from ${current}.`});const c=costs[rank];if((a.ownerTokens||0)<c.t)return res.status(400).json({error:`You need ${c.t} Owner Tokens.`});if((a.diamonds||0)<c.d)return res.status(400).json({error:`You need ${c.d} Diamonds.`});if((a.points||0)<c.p)return res.status(400).json({error:`You need ${c.p} Points.`});a.ownerTokens-=c.t;a.diamonds-=c.d;a.points-=c.p;a.ownerRankLicenses=a.ownerRankLicenses||{mod:0,admin:0,serverAdmin:0,serverOwner:0};a.ownerRankLicenses[rank]=(a.ownerRankLicenses[rank]||0)+1;save(db);res.json({ok:true,ownerTokens:a.ownerTokens,diamonds:a.diamonds,points:a.points,licenses:a.ownerRankLicenses})});
app.post('/api/server-owner/rankup',auth,(req,res)=>{const db=req.db,a=req.account,sid=String(req.body?.serverId||''),target=String(req.body?.target||a.username).toLowerCase(),rank=String(req.body?.rank||'mod');if(!isServerOwner(db,a,sid))return res.status(403).json({error:'Server Owner access required.'});if(!db.accounts[target]||!db.servers[sid]?.members.includes(target))return res.status(400).json({error:'Player must be in this server.'});const current=String(db.servers[sid].roles?.[target]||'user'),allowed={user:['mod'],mod:['admin'],admin:['serverAdmin','serverOwner']};if(!(allowed[current]||[]).includes(rank))return res.status(400).json({error:`${rank} is not unlocked from ${current}.`});a.ownerRankLicenses=a.ownerRankLicenses||{mod:0,admin:0,serverAdmin:0,serverOwner:0};if((a.ownerRankLicenses[rank]||0)<1)return res.status(400).json({error:`You need a saved ${rank} license.`});a.ownerRankLicenses[rank]--;db.servers[sid].roles=db.servers[sid].roles||{};db.servers[sid].roles[target]=rank;save(db);res.json({ok:true,serverRole:rank,licenses:a.ownerRankLicenses})});
app.post('/api/server-owner/settings',auth,(req,res)=>{const db=req.db,a=req.account,sid=String(req.body?.serverId||''),srv=db.servers[sid];if(!srv||!isServerOwner(db,a,sid))return res.status(403).json({error:'Server Owner access required.'});if(req.body?.slowModeSeconds!==undefined)srv.slowModeSeconds=Math.max(0,Math.min(3600,Number(req.body.slowModeSeconds)||0));if(req.body?.welcomeMessage!==undefined)srv.welcomeMessage=String(req.body.welcomeMessage||'').slice(0,300);if(req.body?.icon!==undefined)srv.icon=String(req.body.icon||'').slice(0,500);save(db);res.json({ok:true,server:srv})});
app.post('/api/owner/power',auth,(req,res)=>{if(!isRealOwner(req.account))return res.status(403).json({error:'Owner only.'});const db=req.db,action=String(req.body?.action||''),sid=String(req.body?.serverId||''),srv=db.servers[sid];if(['freeze','rename','clear'].includes(action)&&!srv)return res.status(404).json({error:'Server not found.'});if(action==='freeze'){srv.frozen=!srv.frozen}else if(action==='rename'){const n=String(req.body?.name||'').trim();if(!n)return res.status(400).json({error:'Enter a name.'});srv.name=n.slice(0,60)}else if(action==='clear'){for(const a of Object.values(db.accounts))a.messages=(a.messages||[]).filter(m=>m.server!==sid)}else if(action==='grantTime'){const t=String(req.body?.target||'').toLowerCase(),amt=Math.floor(Number(req.body?.amount||0));if(!db.accounts[t]||amt<1)return res.status(400).json({error:'Invalid target/amount.'});db.accounts[t].timeBalance=(db.accounts[t].timeBalance||0)+amt}else if(action==='grantLicense'){const t=String(req.body?.target||'').toLowerCase(),rank=String(req.body?.rank||'mod');if(!db.accounts[t]||!['mod','admin'].includes(rank))return res.status(400).json({error:'Invalid target/rank.'});db.accounts[t].ownerRankLicenses=db.accounts[t].ownerRankLicenses||{mod:0,admin:0};db.accounts[t].ownerRankLicenses[rank]++}else return res.status(400).json({error:'Unknown owner power.'});save(db);res.json({ok:true,server:srv||null})});
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
app.post('/api/owner/role',auth,(req,res)=>{if(String(req.username||'').trim().toLowerCase()!==OWNER_USERNAME)return res.status(403).json({error:'Only the owner can change ranks.'});const db=req.db,target=String(req.body?.username||'').trim().toLowerCase(),role=String(req.body?.role||'user').trim().toLowerCase(),serverId=String(req.body?.serverId||'').trim();if(!db.accounts[target])return res.status(404).json({error:'Account not found.'});if(target===OWNER_USERNAME)return res.status(400).json({error:'The owner cannot be changed.'});if(!['user','mod','admin','server-admin','co-owner'].includes(role))return res.status(400).json({error:'Invalid role.'});if(req.account.username!==OWNER_USERNAME&&role==='co-owner')return res.status(403).json({error:'Only the owner can grant Co-Owner.'});const a=db.accounts[target];a.role=role;if(role==='co-owner'){a.coOwnerPointGrantRemaining=5000;a.coOwnerDiamondGrantRemaining=300;a.serverAdminServerId='';a.serverAdminExpiresAt=0}else if(role==='server-admin'){if(!db.servers[serverId]||db.servers[serverId].isUpdateLog)return res.status(400).json({error:'Choose a valid server.'});a.serverAdminServerId=serverId;a.serverAdminExpiresAt=Date.now()+3600000;a.servers=a.servers||[];if(!a.servers.includes(serverId))a.servers.push(serverId);if(!db.servers[serverId].members.includes(target))db.servers[serverId].members.push(target)}else{a.serverAdminServerId='';a.serverAdminExpiresAt=0}save(db);res.json({ok:true,account:clean(a)});});
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


/* LCA feature APIs */
app.post('/api/server/settings',(req,res)=>{
  const db=req.db,a=req.account||{},sid=String(req.body?.serverId||''),srv=db.servers[sid];
  if(!srv)return res.status(404).json({error:'Server not found.'});
  const role=effectiveRole(a);
  const allowed=a.username===OWNER_USERNAME||a.role==='co-owner'||srv.owner===a.username;
  if(!allowed)return res.status(403).json({error:'Only the server owner, co-owner, or main owner can change these settings.'});
  if(typeof req.body?.icon==='string')srv.icon=req.body.icon.slice(0,1000000);
  if(typeof req.body?.welcomeMessage==='string')srv.welcomeMessage=req.body.welcomeMessage.slice(0,500);
  if(typeof req.body?.slowModeSeconds!=='undefined')srv.slowModeSeconds=Math.max(0,Math.min(Number(req.body.slowModeSeconds)||0,3600));
  save(db);res.json({ok:true,server:srv});
});
app.post('/api/poll/vote',auth,(req,res)=>{const db=req.db,a=req.account,id=String(req.body?.id||''),option=String(req.body?.option||'');for(const owner of Object.values(db.accounts))for(const m of(owner.messages||[])){if(m.id===id&&m.poll){if(!m.poll.options.includes(option))return res.status(400).json({error:'Invalid answer.'});m.poll.votes=m.poll.votes||{};m.poll.votes[a.username]=option;save(db);return res.json({ok:true,votes:m.poll.votes})}}return res.status(404).json({error:'Poll not found.'})});
app.post('/api/poll',(req,res)=>{
  const db=req.db,a=req.account||{},sid=String(req.body?.serverId||''),srv=db.servers[sid];
  if(!srv)return res.status(404).json({error:'Server not found.'});
  const role=effectiveRole(a);
  if(!['owner','co-owner','server-admin'].includes(role)&&!isServerOwner(db,a,sid))return res.status(403).json({error:'Only Server Owner, Server Admin, Co-Owner, or Owner can create polls.'});
  if(!Array.isArray(srv.members)||!srv.members.includes(a.username))return res.status(403).json({error:'You must be in the server.'});
  const question=String(req.body?.question||'').trim().slice(0,300);
  const options=(Array.isArray(req.body?.options)?req.body.options:[]).map(x=>String(x).trim().slice(0,80)).filter(Boolean).slice(0,8);
  if(!question||options.length<2)return res.status(400).json({error:'A poll needs a question and at least two options.'});
  const m={id:crypto.randomBytes(8).toString('hex'),server:sid,name:a.name,username:a.username,text:'📊 '+question,originalText:'',attachments:[],time:new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),createdAt:new Date().toISOString(),poll:{question,options,votes:{}}};
  a.messages=a.messages||[];a.messages.push(m);save(db);res.json({ok:true,poll:m});
});
app.post('/api/server/voice',(req,res)=>{
  const db=req.db,a=req.account||{},name=String(req.body?.name||'').trim(),privateServer=!!req.body?.private,code=String(req.body?.code||'');
  if(!name)return res.status(400).json({error:'Enter a server name.'});
  if(Object.values(db.servers).some(x=>String(x.name||'').toLowerCase()===name.toLowerCase()))return res.status(409).json({error:'A server with that name already exists.'});
  if(privateServer&&code.length<4)return res.status(400).json({error:'Private server codes must be at least 4 characters.'});
  const id='s_'+crypto.randomBytes(7).toString('hex');
  db.servers[id]={id,name:name.slice(0,60),private:privateServer,codeHash:privateServer?hashPassword(code):'',owner:a.username,members:[a.username],announcement:null,voiceOnly:true,icon:'',welcomeMessage:'',slowModeSeconds:0};
  a.servers=a.servers||[];a.servers.push(id);save(db);res.json({ok:true,server:db.servers[id]});
});
app.post('/api/mod/mute',(req,res)=>{
  const a=req.account||req.user||{};
  const rank=effectiveRole(a);
  if(!['owner','co-owner'].includes(rank)) return res.status(403).json({error:'Only owner or co-owner can mute users.'});
  const username=String(req.body?.username||'');
  const duration=Math.max(1,Math.min(Number(req.body?.durationMinutes)||1,10080));
  if(!username || username===a.username) return res.status(400).json({error:'Invalid target.'});
  const db=req.db||DB;
  db.mutes=Array.isArray(db.mutes)?db.mutes:[];
  db.mutes=db.mutes.filter(x=>x.username!==username);
  db.mutes.push({id:Date.now().toString(36),username,until:Date.now()+duration*60000,by:a.username});
  save(db); res.json({ok:true,until:Date.now()+duration*60000});
});
app.post('/api/owner/staff-abuse',(req,res)=>{
  const db=req.db||DB; db.ownerMailbox=Array.isArray(db.ownerMailbox)?db.ownerMailbox:[];
  db.ownerMailbox.push({id:Date.now().toString(36),type:'staff-abuse',staff:String(req.body?.staff||''),reason:String(req.body?.reason||''),from:req.account?.username||req.user?.username||'unknown',createdAt:Date.now()});
  save(db); res.json({ok:true});
});



/* ===== LCA FEATURE PACK v1.20 PET/TRADING UPGRADE ===== */
const FEATURE_RARITIES=[
{id:'common',name:'Common',token:3,diamonds:60,chance:40,value:100,pointMult:1.05,diamondMult:1,tokenMult:1},
{id:'uncommon',name:'Uncommon',token:5,diamonds:100,chance:30,value:250,pointMult:1.10,diamondMult:1,tokenMult:1},
{id:'rare',name:'Rare',token:10,diamonds:200,chance:20,value:750,pointMult:1.25,diamondMult:1.05,tokenMult:1},
{id:'epic',name:'Epic',token:25,diamonds:500,chance:6,value:2500,pointMult:1.50,diamondMult:1.10,tokenMult:1},
{id:'legendary',name:'LEGENDARY',token:50,diamonds:1000,chance:3,value:10000,pointMult:2.00,diamondMult:1.25,tokenMult:1.10},
{id:'god',name:'GOD',token:250,diamonds:5000,chance:1,value:50000,pointMult:3.00,diamondMult:1.50,tokenMult:1.25}
];
const PET_BASE_NAMES=[
'Rabbit','Fox','Cat','Puppy','Bunny','Dragon','Wolf','Penguin','Otter','Shark','Phoenix','Slime','Tiger','Bear','Raccoon','Parrot','Turtle','Panda','Koala','Dino',
'Frog','Hedgehog','Deer','Monkey','Hamster','Duck','Owl','Goat','Cow','Pig','Horse','Zebra','Giraffe','Lion','Cheetah','Leopard','Crocodile','Alligator','Seal','Walrus',
'Whale','Dolphin','Octopus','Jellyfish','Crab','Lobster','Starfish','Seahorse','Swordfish','Manta','Falcon','Eagle','Hawk','Raven','Swan','Peacock','Flamingo','Toucan','Bee','Butterfly',
'Ladybug','Beetle','Firefly','Ant','Snail','Scorpion','Spider','Moth','Dragonfly','Griffin','Unicorn','Pegasus','Golem','Goblin','Wizard','Knight','Robot','Alien','Astronaut','Meteor',
'Comet','Galaxy','Nebula','Crystal','Shadow','Storm','Volcano','Frost','Solar','Lunar','Void','Cosmic','Titan','Serpent','Hydra','Kraken','Phoenix Prime','Celestial','Eclipse','Infinity'
];
const PET_RARITY_BY_INDEX=i=>i<40?'common':i<70?'uncommon':i<90?'rare':i<96?'epic':i<99?'legendary':'god';
const FEATURE_PETS=PET_BASE_NAMES.map((base,i)=>{const rarity=PET_RARITY_BY_INDEX(i);const rr=FEATURE_RARITIES.find(x=>x.id===rarity);return {id:`${base.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-${rarity}`,name:`${base}-${rarity}`,displayName:base,rarity,value:rr.value,pointMult:rr.pointMult,diamondMult:rr.diamondMult,tokenMult:rr.tokenMult,emoji:['🐇','🦊','🐱','🐶','🐰','🐉','🐺','🐧','🦦','🦈','🔥','🟢','🐯','🐻','🦝','🦜','🐢','🐼','🐨','🦖','🐸','🦔','🦌','🐒','🐹','🦆','🦉','🐐','🐮','🐷','🐴','🦓','🦒','🦁','🐆','🐊','🐊','🦭','🦭','🐋','🐬','🐙','🪼','🦀','🦞','⭐','🐚','🐴','🐟','🦅','🦅','🦅','🐦','🦢','🦚','🦩','🦜','🐝','🦋','🐞','🪲','✨','🐜','🐌','🦂','🕷️','🦋','🐲','🦄','🪽','🗿','👺','🧙','🛡️','🤖','👽','👨‍🚀','☄️','☄️','🌌','💎','🌑','🌩️','🌋','❄️','☀️','🌙','🕳️','🌌','🗿','🐍','🐲','🐙','🔥','🌠','🌌','♾️'][i]||'🐾'};});
const FEATURE_ACHIEVEMENTS=Array.from({length:100},(_,i)=>{const cats=['Chatting','Social','Servers','Economy','Pets','Challenges','Exploration','Staff','Collection','Milestones'];return{id:'ach_'+(i+1),name:`${cats[i%10]} Achievement ${i+1}`,category:cats[i%10],description:`Complete milestone ${i+1} in ${cats[i%10]}.`,rewardBadge:`badge_${i+1}`};});
const FEATURE_CHALLENGES={daily:Array.from({length:100},(_,i)=>({id:'daily_'+(i+1),name:`Daily Challenge ${i+1}`,description:`Complete today's activity challenge #${i+1}.`,reward:10+(i%10)*5})),weekly:Array.from({length:100},(_,i)=>({id:'weekly_'+(i+1),name:`Weekly Challenge ${i+1}`,description:`Complete this week's challenge #${i+1}.`,reward:50+(i%20)*10})),monthly:Array.from({length:100},(_,i)=>({id:'monthly_'+(i+1),name:`Monthly Challenge ${i+1}`,description:`Complete the monthly challenge #${i+1}.`,reward:200+(i%25)*25}))};
function featureInitAccount(a){
  a.following=Array.isArray(a.following)?a.following:[];a.followers=Array.isArray(a.followers)?a.followers:[];a.achievements=Array.isArray(a.achievements)?a.achievements:[];a.badges=Array.isArray(a.badges)?a.badges:[];a.challengeClaims=a.challengeClaims||{};a.dailyReward=a.dailyReward||{lastClaim:'',streak:0};
  a.pets=Array.isArray(a.pets)?a.pets:[];a.equippedPets=Array.isArray(a.equippedPets)?a.equippedPets:[];a.petRerollDate=a.petRerollDate||'';a.petShop=Array.isArray(a.petShop)?a.petShop:[];
  a.level=Number(a.level||1);a.xp=Number(a.xp||0);a.status=String(a.status||'');a.reminders=Array.isArray(a.reminders)?a.reminders:[];a.scheduledMessages=Array.isArray(a.scheduledMessages)?a.scheduledMessages:[];
  // Migrate legacy pet_001 IDs into the new human-readable IDs.
  a.pets=a.pets.map(id=>{if(FEATURE_PETS.some(p=>p.id===id))return id;const m=String(id).match(/^pet_(\d+)$/);if(m){const p=FEATURE_PETS[Number(m[1])-1];return p?p.id:null}return null}).filter(Boolean);
  a.equippedPets=a.equippedPets.map(id=>a.pets.includes(id)?id:null).filter(Boolean).slice(0,3);
}
function featureDate(){return new Date().toISOString().slice(0,10)}
function featureWeek(){const d=new Date(),one=new Date(Date.UTC(d.getUTCFullYear(),0,1));return String(Math.ceil((((d-one)/86400000)+one.getUTCDay()+1)/7))}
function featureMonth(){return new Date().toISOString().slice(0,7)}
function featureSeed(str){let n=0;for(let i=0;i<String(str).length;i++)n=(n*31+String(str).charCodeAt(i))>>>0;return n}
function weightedRarity(seed,boost=false,exclude=[]){
  const base={common:40,uncommon:30,rare:20,epic:6,legendary:3,god:1};
  if(boost){base.legendary+=1.5;base.god+=1.5;base.common-=1;base.uncommon-=1;base.rare-=1;}
  for(const x of exclude)if(base[x])base[x]=0;
  const total=Object.values(base).reduce((a,b)=>a+b,0);let n=(featureSeed(String(seed))%100000)/100000*total;
  for(const [rar,w] of Object.entries(base)){n-=w;if(n<=0)return rar}return 'common';
}
function featureDistinctShop(a){
  const day=featureDate();
  if(a.petRerollDate!==day||!a.petShop?.length){
    const usedRarity=new Set(),usedPet=new Set(),ids=[];
    for(let slot=0;slot<5;slot++){
      // Weighted rarity selection without replacement: every shop slot gets a different rarity.
      let rarity=weightedRarity(day+':'+a.username+':slot:'+slot, false, [...usedRarity]);
      if(usedRarity.has(rarity)){const available=FEATURE_RARITIES.map(x=>x.id).filter(x=>!usedRarity.has(x));rarity=available[featureSeed(day+':fallback:'+slot)%available.length]}
      usedRarity.add(rarity);
      let pool=FEATURE_PETS.filter(x=>x.rarity===rarity&&!usedPet.has(x.id));
      const pick=pool[featureSeed(day+':'+a.username+':pick:'+slot)%pool.length];
      usedPet.add(pick.id);ids.push(pick.id);
    }
    a.petShop=ids;a.petRerollDate=day;
  }
  return a.petShop.map(id=>FEATURE_PETS.find(x=>x.id===id)).filter(Boolean);
}
function featureRandomChallenge(type,a){const list=FEATURE_CHALLENGES[type]||[];return list[featureSeed(featureDate()+':'+type+':'+a.username)%list.length]}
function featureXp(a,amount){a.xp=Number(a.xp||0)+Math.max(0,Number(amount||0));a.level=Math.max(1,Math.floor(a.xp/100)+1)}
function petStats(a){
  const equipped=(a.equippedPets||[]).map(id=>FEATURE_PETS.find(p=>p.id===id)).filter(Boolean);
  let point=1,diamond=1,token=1;
  for(const p of equipped){point*=p.pointMult;diamond*=p.diamondMult;token*=p.tokenMult}
  return {point:Math.round(point*100)/100,diamond:Math.round(diamond*100)/100,token:Math.round(token*100)/100,equipped};
}
function petValue(p){return Number(p?.value||0)}
for(const acc of Object.values(DB?.accounts||{}))featureInitAccount(acc);

app.get('/api/features/achievements',auth,(req,res)=>{featureInitAccount(req.account);res.json({achievements:FEATURE_ACHIEVEMENTS.map(x=>({...x,unlocked:req.account.achievements.includes(x.id)})),badges:req.account.badges||[]})});
app.post('/api/features/achievements/unlock',auth,(req,res)=>{featureInitAccount(req.account);const x=FEATURE_ACHIEVEMENTS.find(v=>v.id===String(req.body?.id||''));if(!x)return res.status(404).json({error:'Achievement not found.'});if(!req.account.achievements.includes(x.id)){req.account.achievements.push(x.id);req.account.badges.push(x.rewardBadge);featureXp(req.account,25);save(req.db)}res.json({ok:true,achievement:x,level:req.account.level,xp:req.account.xp})});
app.post('/api/features/status',auth,(req,res)=>{featureInitAccount(req.account);req.account.status=String(req.body?.status||'').slice(0,80);save(req.db);res.json({ok:true,status:req.account.status})});
app.post('/api/features/follow',auth,(req,res)=>{featureInitAccount(req.account);const target=String(req.body?.username||'').trim().toLowerCase();if(!req.db.accounts[target])return res.status(404).json({error:'Player not found.'});if(target===req.username)return res.status(400).json({error:'You cannot follow yourself.'});const ta=req.db.accounts[target];featureInitAccount(ta);const i=req.account.following.indexOf(target);if(i>=0){req.account.following.splice(i,1);ta.followers=ta.followers.filter(x=>x!==req.username)}else{req.account.following.push(target);if(!ta.followers.includes(req.username))ta.followers.push(req.username)}save(req.db);res.json({ok:true,following:req.account.following})});
app.get('/api/features/rewards',auth,(req,res)=>{featureInitAccount(req.account);const today=featureDate(),r=req.account.dailyReward;res.json({today,lastClaim:r.lastClaim,streak:r.streak,canClaim:r.lastClaim!==today,calendar:Array.from({length:31},(_,i)=>({day:i+1,claimed:i<r.streak,available:i+1===Math.min(r.streak+1,31)}))})});
app.post('/api/features/rewards/claim',auth,(req,res)=>{featureInitAccount(req.account);const today=featureDate(),r=req.account.dailyReward;if(r.lastClaim===today)return res.status(400).json({error:'Daily reward already claimed.'});r.streak=Math.min(31,Number(r.streak||0)+1);r.lastClaim=today;const points=25+r.streak*10;req.account.points=Number(req.account.points||0)+Math.floor(points*petStats(req.account).point);featureXp(req.account,10);save(req.db);res.json({ok:true,points:req.account.points,streak:r.streak,reward:points})});
app.get('/api/features/challenges',auth,(req,res)=>{featureInitAccount(req.account);const out={};for(const type of ['daily','weekly','monthly']){const c=featureRandomChallenge(type,req.account);out[type]={...c,claimed:!!req.account.challengeClaims[c.id]}}res.json({catalogCounts:{daily:100,weekly:100,monthly:100},current:out})});
app.post('/api/features/challenges/claim',auth,(req,res)=>{featureInitAccount(req.account);const type=String(req.body?.type||'');if(!FEATURE_CHALLENGES[type])return res.status(400).json({error:'Invalid challenge type.'});const c=featureRandomChallenge(type,req.account);if(req.account.challengeClaims[c.id])return res.status(400).json({error:'Challenge already claimed.'});req.account.challengeClaims[c.id]=Date.now();req.account.points=Number(req.account.points||0)+Math.floor(c.reward*petStats(req.account).point);featureXp(req.account,type==='monthly'?100:50);save(req.db);res.json({ok:true,reward:c.reward,points:req.account.points,level:req.account.level,xp:req.account.xp})});

app.get('/api/features/pets',auth,(req,res)=>{featureInitAccount(req.account);const pets=featureDistinctShop(req.account),stats=petStats(req.account);save(req.db);res.json({pets,owned:req.account.pets,rarities:FEATURE_RARITIES,stats,equipped:req.account.equippedPets,rollCost:{tokens:100,diamonds:2000},rollBoost:3,guide:FEATURE_PETS})});
app.post('/api/features/pets/reroll',auth,(req,res)=>{featureInitAccount(req.account);const costType=String(req.body?.type||'token');const cost=costType==='diamond'?200:10;if(costType==='diamond'){if((req.account.diamonds||0)<cost)return res.status(400).json({error:'Not enough diamonds.'});req.account.diamonds-=cost}else{if((req.account.ownerTokens||0)<cost)return res.status(400).json({error:'Not enough Owner Tokens.'});req.account.ownerTokens-=cost}
  // Force a new market immediately. The new generator guarantees five different rarities.
  req.account.petRerollDate='';req.account.petShop=[];const pets=featureDistinctShop(req.account);save(req.db);res.json({ok:true,pets,diamonds:req.account.diamonds,ownerTokens:req.account.ownerTokens});
});
app.post('/api/features/pets/buy',auth,(req,res)=>{featureInitAccount(req.account);const id=String(req.body?.id||''),pay=String(req.body?.pay||'token'),pet=FEATURE_PETS.find(x=>x.id===id);if(!pet)return res.status(404).json({error:'Pet not found.'});if(!featureDistinctShop(req.account).some(x=>x.id===id))return res.status(400).json({error:"That pet is not in today's shop."});const rr=FEATURE_RARITIES.find(x=>x.id===pet.rarity);if(pay==='diamond'){if((req.account.diamonds||0)<rr.diamonds)return res.status(400).json({error:'Not enough diamonds.'});req.account.diamonds-=rr.diamonds}else{if((req.account.ownerTokens||0)<rr.token)return res.status(400).json({error:'Not enough Owner Tokens.'});req.account.ownerTokens-=rr.token}if(!req.account.pets.includes(id))req.account.pets.push(id);featureXp(req.account,20);save(req.db);res.json({ok:true,pet,owned:req.account.pets,diamonds:req.account.diamonds,ownerTokens:req.account.ownerTokens,stats:petStats(req.account)});});
app.post('/api/features/pets/legendary-roll',auth,(req,res)=>{featureInitAccount(req.account);const pay=String(req.body?.pay||'token');if(pay==='diamond'){if((req.account.diamonds||0)<2000)return res.status(400).json({error:'Need 2,000 diamonds.'});req.account.diamonds-=2000}else{if((req.account.ownerTokens||0)<100)return res.status(400).json({error:'Need 100 Owner Tokens.'});req.account.ownerTokens-=100}
  // Boost is applied to the combined Legendary/GOD pool, then choose only from those two rarities.
  const rollSeed=String(Date.now())+req.username+':legendary-roll';const godChance=4.0,legendChance=6.0;const pick=((featureSeed(rollSeed)%100000)/100000*(godChance+legendChance))<godChance?'god':'legendary';const candidates=FEATURE_PETS.filter(x=>x.rarity===pick);const pet=candidates[featureSeed(rollSeed+':pet')%candidates.length];if(!req.account.pets.includes(pet.id))req.account.pets.push(pet.id);featureXp(req.account,100);save(req.db);res.json({ok:true,pet,boost:'Legendary/GOD boosted by 3 percentage points total',diamonds:req.account.diamonds,ownerTokens:req.account.ownerTokens,owned:req.account.pets,stats:petStats(req.account)});
});
app.get('/api/features/pets/equipped',auth,(req,res)=>{featureInitAccount(req.account);const stats=petStats(req.account);res.json({equipped:req.account.equippedPets,stats,slots:3})});
app.post('/api/features/pets/equip',auth,(req,res)=>{featureInitAccount(req.account);const id=String(req.body?.id||''),pet=FEATURE_PETS.find(x=>x.id===id);if(!pet||!req.account.pets.includes(id))return res.status(400).json({error:'You do not own that pet.'});if(req.account.equippedPets.includes(id))return res.status(400).json({error:'That pet is already equipped.'});if(req.account.equippedPets.length>=3)return res.status(400).json({error:'You can equip up to 3 pets.'});req.account.equippedPets.push(id);save(req.db);res.json({ok:true,equipped:req.account.equippedPets,stats:petStats(req.account)});});
app.post('/api/features/pets/unequip',auth,(req,res)=>{featureInitAccount(req.account);const id=String(req.body?.id||'');req.account.equippedPets=req.account.equippedPets.filter(x=>x!==id);save(req.db);res.json({ok:true,equipped:req.account.equippedPets,stats:petStats(req.account)});});
app.get('/api/features/pets/guide',auth,(req,res)=>{featureInitAccount(req.account);res.json({pets:FEATURE_PETS,rarities:FEATURE_RARITIES})});

// Trading Plaza: two-sided offer/accept flow with values shown on every pet.
function ensureTradeStore(db){db.featureTrades=Array.isArray(db.featureTrades)?db.featureTrades:[];db.featureTradeRequests=Array.isArray(db.featureTradeRequests)?db.featureTradeRequests:[];}
function cleanTrade(db,t){return {...t,fromName:db.accounts[t.from]?.name||t.from,toName:db.accounts[t.to]?.name||t.to,offer:(t.offer||[]).map(id=>FEATURE_PETS.find(p=>p.id===id)).filter(Boolean),request:(t.request||[]).map(id=>FEATURE_PETS.find(p=>p.id===id)).filter(Boolean)};}
app.get('/api/features/trading',auth,(req,res)=>{featureInitAccount(req.account);const db=req.db;ensureTradeStore(db);const pending=db.featureTradeRequests.filter(x=>x.to===req.username&&x.status==='pending').map(x=>cleanTrade(db,x));const active=db.featureTradeRequests.filter(x=>x.status==='active'&&(x.from===req.username||x.to===req.username)).map(x=>cleanTrade(db,x));const listings=db.featureTrades.filter(x=>x.status==='listed').slice(-100).map(x=>({...x,pet:FEATURE_PETS.find(p=>p.id===x.petId),value:FEATURE_PETS.find(p=>p.id===x.petId)?.value||0}));res.json({listings,pending,active,owned:req.account.pets,values:FEATURE_PETS.map(p=>({id:p.id,name:p.name,value:p.value,rarity:p.rarity}))});});
app.post('/api/features/trading/request',auth,(req,res)=>{featureInitAccount(req.account);const db=req.db;ensureTradeStore(db);const target=String(req.body?.target||'').trim().toLowerCase();if(!db.accounts[target]||target===req.username)return res.status(400).json({error:'Choose another valid player.'});const existing=db.featureTradeRequests.find(x=>x.status==='pending'&&x.from===req.username&&x.to===target);if(existing)return res.status(400).json({error:'Trade request already sent.'});const t={id:'trade_'+crypto.randomBytes(8).toString('hex'),from:req.username,to:target,offer:[],request:[],fromAccepted:false,toAccepted:false,status:'pending',createdAt:Date.now()};db.featureTradeRequests.push(t);save(db);res.json({ok:true,trade:cleanTrade(db,t)});});
app.post('/api/features/trading/accept-request',auth,(req,res)=>{const db=req.db;ensureTradeStore(db);const t=db.featureTradeRequests.find(x=>x.id===String(req.body?.id||'')&&x.to===req.username&&x.status==='pending');if(!t)return res.status(404).json({error:'Trade request not found.'});t.status='active';save(db);res.json({ok:true,trade:cleanTrade(db,t)});});
app.post('/api/features/trading/decline',auth,(req,res)=>{const db=req.db;ensureTradeStore(db);const t=db.featureTradeRequests.find(x=>x.id===String(req.body?.id||'')&&(x.from===req.username||x.to===req.username)&&['pending','active'].includes(x.status));if(!t)return res.status(404).json({error:'Trade not found.'});t.status='declined';save(db);res.json({ok:true})});
app.post('/api/features/trading/add',auth,(req,res)=>{featureInitAccount(req.account);const db=req.db;ensureTradeStore(db);const t=db.featureTradeRequests.find(x=>x.id===String(req.body?.id||'')&&(x.from===req.username||x.to===req.username)&&x.status==='active');if(!t)return res.status(404).json({error:'Trade is not active.'});const id=String(req.body?.petId||'');if(!req.account.pets.includes(id))return res.status(400).json({error:'You do not own that pet.'});const side=t.from===req.username?'offer':'request';if(t[side].includes(id))return res.status(400).json({error:'That pet is already in the offer.'});if(t[side].length>=6)return res.status(400).json({error:'Maximum 6 pets per side.'});t[side].push(id);t.fromAccepted=false;t.toAccepted=false;save(db);res.json({ok:true,trade:cleanTrade(db,t)});});
app.post('/api/features/trading/remove',auth,(req,res)=>{const db=req.db;ensureTradeStore(db);const t=db.featureTradeRequests.find(x=>x.id===String(req.body?.id||'')&&(x.from===req.username||x.to===req.username)&&x.status==='active');if(!t)return res.status(404).json({error:'Trade is not active.'});const side=t.from===req.username?'offer':'request';t[side]=(t[side]||[]).filter(id=>id!==String(req.body?.petId||''));t.fromAccepted=false;t.toAccepted=false;save(db);res.json({ok:true,trade:cleanTrade(db,t)});});
app.post('/api/features/trading/ready',auth,(req,res)=>{const db=req.db;ensureTradeStore(db);const t=db.featureTradeRequests.find(x=>x.id===String(req.body?.id||'')&&(x.from===req.username||x.to===req.username)&&x.status==='active');if(!t)return res.status(404).json({error:'Trade is not active.'});if(!t.offer.length&&!t.request.length)return res.status(400).json({error:'Add at least one pet before accepting.'});if(t.from===req.username)t.fromAccepted=!!req.body?.ready;else t.toAccepted=!!req.body?.ready;if(t.fromAccepted&&t.toAccepted){const from=db.accounts[t.from],to=db.accounts[t.to];featureInitAccount(from);featureInitAccount(to);for(const id of t.offer)if(!from.pets.includes(id))return res.status(409).json({error:'Trade changed because a pet is no longer available.'});for(const id of t.request)if(!to.pets.includes(id))return res.status(409).json({error:'Trade changed because a requested pet is no longer available.'});from.pets=from.pets.filter(id=>!t.offer.includes(id));to.pets=to.pets.filter(id=>!t.request.includes(id));from.pets.push(...t.request);to.pets.push(...t.offer);from.equippedPets=from.equippedPets.filter(id=>from.pets.includes(id));to.equippedPets=to.equippedPets.filter(id=>to.pets.includes(id));t.status='completed';t.completedAt=Date.now();save(db);return res.json({ok:true,completed:true,trade:cleanTrade(db,t),owned:from.pets,stats:petStats(from)})}save(db);res.json({ok:true,completed:false,trade:cleanTrade(db,t)});});

app.post('/api/features/trading/list',auth,(req,res)=>{featureInitAccount(req.account);const db=req.db;ensureTradeStore(db);const pet=FEATURE_PETS.find(x=>x.id===String(req.body?.petId||''));if(!pet||!req.account.pets.includes(pet.id))return res.status(400).json({error:'You do not own that pet.'});const price=Math.max(1,Math.floor(Number(req.body?.price||0)));if(!price)return res.status(400).json({error:'Enter a price.'});db.featureTrades.push({id:'listing_'+crypto.randomBytes(8).toString('hex'),seller:req.username,petId:pet.id,price,status:'listed',createdAt:Date.now()});save(db);res.json({ok:true});});
app.post('/api/features/trading/bid',auth,(req,res)=>{featureInitAccount(req.account);const db=req.db;ensureTradeStore(db);const id=String(req.body?.id||''),bid=Math.floor(Number(req.body?.bid||0)),l=db.featureTrades.find(x=>x.id===id&&x.status==='listed');if(!l)return res.status(404).json({error:'Listing not found.'});if(l.seller===req.username)return res.status(400).json({error:'You cannot bid on your own listing.'});if(bid<l.price||Number(req.account.diamonds||0)<bid)return res.status(400).json({error:'Bid must meet the asking price and your diamond balance.'});const seller=db.accounts[l.seller];if(!seller)return res.status(404).json({error:'Seller not found.'});if(!seller.pets.includes(l.petId))return res.status(409).json({error:'This pet is no longer available.'});req.account.diamonds-=bid;seller.diamonds=Number(seller.diamonds||0)+bid;seller.pets=seller.pets.filter(id=>id!==l.petId);req.account.pets.push(l.petId);l.status='sold';l.buyer=req.username;l.bid=bid;save(db);res.json({ok:true,diamonds:req.account.diamonds});});

app.get('/api/features/pet-stats',auth,(req,res)=>{featureInitAccount(req.account);res.json(petStats(req.account))});
app.get('/api/features/leaderboard',auth,(req,res)=>{const db=req.db;const accounts=Object.values(db.accounts).map(a=>{featureInitAccount(a);return{username:a.username,name:a.name,points:Number(a.points||0),time:Number(a.timeBalance||0),level:Number(a.level||1),pets:(a.pets||[]).length,achievements:(a.achievements||[]).length}});const sort=k=>accounts.slice().sort((a,b)=>b[k]-a[k]).slice(0,20);res.json({points:sort('points'),time:sort('time'),level:sort('level'),pets:sort('pets'),achievements:sort('achievements')})});
app.get('/api/features/audit',auth,(req,res)=>{const sid=String(req.query?.serverId||''),srv=req.db.servers?.[sid];if(!srv)return res.status(404).json({error:'Server not found.'});const role=serverRole(req.db,req.account,sid);if(!isRealOwner(req.account)&&role!=='server-owner'&&!['mod','admin','server-admin'].includes(role))return res.status(403).json({error:'Staff access only.'});res.json({entries:Array.isArray(srv.auditLog)?srv.auditLog.slice(-200).reverse():[]})});
app.post('/api/scheduled-message',auth,(req,res)=>{const when=Number(req.body?.when||0),server=String(req.body?.server||'home'),text=String(req.body?.text||'').trim().slice(0,4000);if(!when||when<Date.now()+5000||!text)return res.status(400).json({error:'Choose a future time and message.'});if(!req.db.servers[server]||!effectiveServers(req.db,req.username).some(x=>x.id===server))return res.status(403).json({error:'You are not in that server.'});featureInitAccount(req.account);req.account.scheduledMessages.push({id:'sched_'+Date.now().toString(36),server,text,when,createdAt:Date.now()});save(req.db);res.json({ok:true})});
app.get('/api/reminders',auth,(req,res)=>{featureInitAccount(req.account);res.json({reminders:req.account.reminders||[]})});
app.post('/api/reminders',auth,(req,res)=>{featureInitAccount(req.account);const text=String(req.body?.text||'').trim().slice(0,300),when=Number(req.body?.when||0);if(!text||!when)return res.status(400).json({error:'Enter reminder text and time.'});req.account.reminders.push({id:'rem_'+Date.now().toString(36),text,when,done:false});save(req.db);res.json({ok:true,reminders:req.account.reminders})});


app.get('/health',(req,res)=>res.status(200).json({ok:true,service:'LCA'}));

let httpServer=null;
async function startServer(){
  if(httpServer) return httpServer;
  httpServer=await new Promise((resolve,reject)=>{
    const srv=app.listen({port:Number(PORT),host:'0.0.0.0',reusePort:true},()=>resolve(srv));
    srv.once('error',reject);
  });
  httpServer.keepAliveTimeout=120000;
  httpServer.headersTimeout=125000;
  console.log('LCA online server listening on 0.0.0.0:'+PORT);
  return httpServer;
}

process.on('SIGTERM',()=>{
  if(httpServer) httpServer.close(()=>process.exit(0));
  else process.exit(0);
});
process.on('SIGINT',()=>{
  if(httpServer) httpServer.close(()=>process.exit(0));
  else process.exit(0);
});

loadPersistent()
  .then(()=>startServer())
  .catch(e=>{console.error('LCA startup failed:',e);process.exit(1);});
