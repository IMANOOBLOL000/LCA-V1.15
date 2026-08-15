const express=require('express');
const path=require('path');
const crypto=require('crypto');
const app=express();
const PORT=Number(process.env.PORT||10000);
const HOST='0.0.0.0';
const SECRET=process.env.LCA_SESSION_SECRET||'lca-local-stable-secret-change-me';
const OWNER_USERNAME=String(process.env.OWNER_USERNAME||'CEOIMANOOB').trim().toLowerCase();
app.disable('x-powered-by');
app.use(express.json({limit:'2mb'}));
app.use(express.urlencoded({extended:true}));

const users=new Map();
const servers=[];
const messages=new Map();
const polls=new Map();
const pets=[];
const achievements=[];
const challengeBank={daily:[],weekly:[],monthly:[]};

function id(p='id'){return p+'_'+crypto.randomBytes(8).toString('hex')}
function uname(v){return String(v||'').trim().toLowerCase()}
function b64(v){return Buffer.from(v).toString('base64url')}
function signSession(username){const payload=JSON.stringify({u:username,t:Date.now()});const body=b64(payload);const sig=crypto.createHmac('sha256',SECRET).update(body).digest('base64url');return body+'.'+sig}
function verifySession(token){try{const [body,sig]=String(token||'').split('.');if(!body||!sig)return null;const expected=crypto.createHmac('sha256',SECRET).update(body).digest('base64url');if(!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return null;const p=JSON.parse(Buffer.from(body,'base64url').toString());if(Date.now()-p.t>30*24*60*60*1000)return null;return uname(p.u)}catch{return null}}
function getToken(req){const h=String(req.headers.authorization||'');if(h.startsWith('Bearer '))return h.slice(7);const c=String(req.headers.cookie||'');const m=c.match(/(?:^|;\s*)lca_session=([^;]+)/);return m?decodeURIComponent(m[1]):''}
function safeUser(u){return {username:u.username,displayName:u.displayName,role:u.role,points:u.points,diamonds:u.diamonds,time:u.time,ownerTokens:u.ownerTokens,level:u.level,xp:u.xp,badges:u.badges,pets:u.pets,servers:u.servers}}
function makeUser(username,password,role='member'){const u={username,displayName:username,password:password||'',role,points:0,diamonds:0,time:0,ownerTokens:0,level:1,xp:0,badges:[],pets:[],servers:[],lastTimeTick:Date.now()};users.set(username,u);return u}
if(!users.has(OWNER_USERNAME))makeUser(OWNER_USERNAME,'','owner');
function auth(req,res,next){const u=users.get(verifySession(getToken(req)));if(!u)return res.status(401).json({error:'AUTH_REQUIRED'});req.user=u;next()}
function owner(req,res,next){if(req.user.username!==OWNER_USERNAME&&req.user.role!=='owner')return res.status(403).json({error:'OWNER_ONLY'});next()}
function grantTime(u){const now=Date.now();const elapsed=Math.floor((now-u.lastTimeTick)/60000);if(elapsed>0){u.time+=elapsed;u.lastTimeTick+=elapsed*60000;u.xp+=elapsed;u.level=1+Math.floor(u.xp/100)}}
function persistCookie(res,token){res.setHeader('Set-Cookie',`lca_session=${encodeURIComponent(token)}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`)}

const achCats=['Chatting','Social','Servers','Economy','Pets','Challenges','Staff','Milestones','Exploration','Special'];
for(let i=1;i<=100;i++)achievements.push({id:'a'+i,name:`Achievement ${i}`,category:achCats[(i-1)%achCats.length],description:`Complete milestone ${i}.`});
for(const type of Object.keys(challengeBank))for(let i=1;i<=100;i++)challengeBank[type].push({id:`${type}-${i}`,type,title:`${type[0].toUpperCase()+type.slice(1)} Challenge ${i}`,description:`Complete objective ${i}.`,reward:{points:type==='daily'?20+i: type==='weekly'?100+i*2:500+i*5,time:type==='daily'?1: type==='weekly'?5:25}});
const rarity=[['Common',3,60,40],['Uncommon',5,100,30],['Rare',10,200,20],['Epic',25,500,6],['Legendary',50,1000,3],['GOD',250,5000,1]];
for(let i=1;i<=100;i++){const r=rarity[(i-1)%rarity.length];pets.push({id:'pet'+i,name:`Pet ${i}`,rarity:r[0],ownerTokens:r[1],diamonds:r[2],chance:r[3]})}

app.get('/health',(req,res)=>res.json({ok:true,service:'LCA',version:'1.17-stable'}));
app.post('/api/login',(req,res)=>{const username=uname(req.body.username),password=String(req.body.password||'');if(!username)return res.status(400).json({error:'USERNAME_REQUIRED'});let u=users.get(username);if(!u)u=makeUser(username,password,username===OWNER_USERNAME?'owner':'member');else if(u.password&&u.password!==password)return res.status(401).json({error:'INVALID_LOGIN'});grantTime(u);persistCookie(res,signSession(username));res.json({ok:true,token:signSession(username),account:safeUser(u)})});
app.post('/api/logout',(req,res)=>{res.setHeader('Set-Cookie','lca_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');res.json({ok:true})});
app.get('/api/me',auth,(req,res)=>{grantTime(req.user);res.setHeader('Cache-Control','no-store');res.json({ok:true,account:safeUser(req.user)})});
app.get('/api/currency',auth,(req,res)=>{grantTime(req.user);res.json({points:req.user.points,diamonds:req.user.diamonds,time:req.user.time,ownerTokens:req.user.ownerTokens})});
app.post('/api/activity',auth,(req,res)=>{grantTime(req.user);res.json({ok:true,account:safeUser(req.user)})});

function exchange(field,cost){return (req,res)=>{grantTime(req.user);const amount=Math.max(1,Math.floor(Number(req.body.amount||1)));if(!Number.isInteger(amount)||amount<1)return res.status(400).json({error:'INVALID_AMOUNT'});const needed=amount*cost;if(req.user.time<needed)return res.status(400).json({error:'NOT_ENOUGH_TIME'});req.user.time-=needed;req.user[field]+=amount;res.json({ok:true,account:safeUser(req.user)})}}
app.post('/api/exchange/time-diamond',auth,exchange('diamonds',5));
app.post('/api/exchange/time-owner-token',auth,exchange('ownerTokens',10));
function grant(field){return (req,res)=>{const target=uname(req.body.username)||req.user.username;const amount=Math.floor(Number(req.body.amount));if(!Number.isFinite(amount)||amount<0)return res.status(400).json({error:'INVALID_AMOUNT'});let u=users.get(target);if(!u&&target===req.user.username)u=req.user;if(!u)return res.status(404).json({error:'USER_NOT_FOUND'});u[field]+=amount;res.json({ok:true,account:safeUser(u)})}}
app.post('/api/owner/give-time',auth,owner,grant('time'));
app.post('/api/owner/give-points',auth,owner,grant('points'));
app.post('/api/owner/give-diamonds',auth,owner,grant('diamonds'));
app.post('/api/owner/give-owner-token',auth,owner,grant('ownerTokens'));

app.get('/api/servers',auth,(req,res)=>res.json({servers}));
function createServer(isVoice){return (req,res)=>{const name=String(req.body.name||'').trim();if(!name)return res.status(400).json({error:'SERVER_NAME_REQUIRED'});const s={id:id('srv'),name,voice:!!isVoice,owner:req.user.username,members:[req.user.username],createdAt:Date.now()};servers.push(s);req.user.servers.push(s.id);res.json({ok:true,server:s,account:safeUser(req.user)})}}
app.post('/api/servers/create',auth,createServer(false));
app.post('/api/servers/create-voice',auth,createServer(true));
app.post('/api/servers/join',auth,(req,res)=>{const s=servers.find(x=>x.id===req.body.serverId);if(!s)return res.status(404).json({error:'SERVER_NOT_FOUND'});if(!s.members.includes(req.user.username))s.members.push(req.user.username);if(!req.user.servers.includes(s.id))req.user.servers.push(s.id);res.json({ok:true,server:s,account:safeUser(req.user)})});

app.get('/api/achievements',auth,(req,res)=>res.json({achievements,unlocked:req.user.badges}));
app.get('/api/challenges',auth,(req,res)=>{const pick=k=>challengeBank[k].slice().sort(()=>Math.random()-.5).slice(0,5);res.json({daily:pick('daily'),weekly:pick('weekly'),monthly:pick('monthly')})});
app.get('/api/daily-rewards',auth,(req,res)=>{const rewards=Array.from({length:31},(_,i)=>({day:i+1,reward:{points:100+i*25,time:1+Math.floor(i/7)}}));res.json({day:Math.floor(Date.now()/86400000),rewards,claimed:[]})});
app.get('/api/pets',auth,(req,res)=>res.json({pets:pets.slice().sort(()=>Math.random()-.5).slice(0,5),rarities:rarity}));
app.post('/api/pets/buy',auth,(req,res)=>{const p=pets.find(x=>x.id===req.body.petId);if(!p)return res.status(404).json({error:'PET_NOT_FOUND'});const cur=req.body.currency==='diamonds'?'diamonds':'ownerTokens';const cost=p[cur];if(req.user[cur]<cost)return res.status(400).json({error:'NOT_ENOUGH_'+cur.toUpperCase()});req.user[cur]-=cost;req.user.pets.push(p.id);res.json({ok:true,pet:p,account:safeUser(req.user)})});
app.get('/api/polls',auth,(req,res)=>res.json({polls:[...polls.values()]}));
app.post('/api/polls',auth,(req,res)=>{const p={id:id('poll'),question:String(req.body.question||'').trim(),answers:Array.isArray(req.body.answers)?req.body.answers.map(x=>String(x).trim()).filter(Boolean):[],creator:req.user.username,createdAt:Date.now(),votes:{}};if(!p.question||p.answers.length<2)return res.status(400).json({error:'QUESTION_AND_TWO_ANSWERS_REQUIRED'});polls.set(p.id,p);res.json({ok:true,poll:p})});
app.post('/api/polls/:id/vote',auth,(req,res)=>{const p=polls.get(req.params.id);if(!p)return res.status(404).json({error:'POLL_NOT_FOUND'});const a=String(req.body.answer||'');if(!p.answers.includes(a))return res.status(400).json({error:'ANSWER_NOT_FOUND'});p.votes[req.user.username]=a;res.json({ok:true,poll:p})});
app.get('/api/features',auth,(req,res)=>res.json({voice:{record:true,transcribe:true},trading:{trade:true,sell:true,bid:true},categories:['Social','Others','Shops']}));

const root=__dirname;const index=path.join(root,'index.html');
app.get('/',(req,res)=>res.sendFile(index));
app.use(express.static(root,{index:false,fallthrough:true}));
app.get('*',(req,res)=>{if(req.path.startsWith('/api/'))return res.status(404).json({error:'NOT_FOUND'});res.sendFile(index)});

const server=app.listen(PORT,HOST,()=>console.log(`LCA stable server listening on ${HOST}:${PORT}`));
server.on('error',e=>{console.error('SERVER_ERROR',e);process.exit(1)});
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
process.on('SIGINT',()=>server.close(()=>process.exit(0)));
