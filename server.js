const express = require("express");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 10000);
const HOST = "0.0.0.0";

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// In-memory fallback keeps the rebuilt demo functional immediately.
// If Supabase is connected later, the persistence layer can be swapped without
// changing the browser API.
const db = {
  users: new Map(),
  sessions: new Map(),
  achievements: [],
  challenges: { daily: [], weekly: [], monthly: [] },
  pets: [],
  dailyPets: [],
  shopDay: "",
  activity: new Map()
};

const OWNER_USERNAME = String(process.env.OWNER_USERNAME || "CEOIMANOOB").toLowerCase();

function id(prefix="id"){
  return prefix + "_" + crypto.randomBytes(9).toString("hex");
}
function cleanUser(v){ return String(v || "").trim().toLowerCase(); }
function safeUser(u){
  return {
    username:u.username,
    displayName:u.displayName,
    role:u.role,
    points:u.points,
    diamonds:u.diamonds,
    time:u.time,
    ownerTokens:u.ownerTokens,
    xp:u.xp,
    level:u.level,
    status:u.status,
    badges:u.badges || [],
    pets:u.pets || []
  };
}
function makeUser(username, password, role="member"){
  const u={
    username,
    displayName:username,
    password,
    role,
    points:0, diamonds:0, time:0, ownerTokens:0,
    xp:0, level:1, status:"Online",
    badges:[], pets:[],
    createdAt:Date.now()
  };
  db.users.set(cleanUser(username),u);
  return u;
}
function auth(req,res,next){
  const header=String(req.headers.authorization || "");
  const cookie=String(req.headers.cookie || "");
  let token=header.startsWith("Bearer ")?header.slice(7):"";
  if(!token){
    const m=cookie.match(/(?:^|;\s*)lca_session=([^;]+)/);
    token=m ? decodeURIComponent(m[1]) : "";
  }
  const username=db.sessions.get(token);
  if(!username){
    return res.status(401).json({error:"AUTH_REQUIRED"});
  }
  const u=db.users.get(username);
  if(!u)return res.status(401).json({error:"AUTH_REQUIRED"});
  req.user=u;
  req.username=username;
  next();
}
function ownerOnly(req,res,next){
  if(req.username!==OWNER_USERNAME && req.user.role!=="owner")
    return res.status(403).json({error:"OWNER_ONLY"});
  next();
}
function activeTouch(u){
  db.activity.set(cleanUser(u.username),Date.now());
}
function awardTime(u){
  const key=cleanUser(u.username), now=Date.now();
  const last=Number(db.activity.get(key)||now);
  const minutes=Math.floor(Math.max(0,now-last)/60000);
  if(minutes>0){
    u.time += minutes; // exactly 1 Time per minute
    db.activity.set(key,last+minutes*60000);
  }
  return minutes;
}

// Default owner exists for local testing. Production can use env credentials.
if(!db.users.has(OWNER_USERNAME))
  makeUser(OWNER_USERNAME,"","owner");

// ---------- Authentication ----------
app.post("/api/login",(req,res)=>{
  const username=cleanUser(req.body.username);
  const password=String(req.body.password||"");
  if(!username)return res.status(400).json({error:"USERNAME_REQUIRED"});
  let u=db.users.get(username);
  if(!u){
    u=makeUser(username,password,username===OWNER_USERNAME?"owner":"member");
  } else if(u.password && u.password!==password){
    return res.status(401).json({error:"INVALID_LOGIN"});
  }
  const token=id("sess");
  db.sessions.set(token,username);
  activeTouch(u);
  res.setHeader("Set-Cookie",`lca_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`);
  res.json({ok:true,token,account:safeUser(u)});
});

app.post("/api/logout",auth,(req,res)=>{
  const header=String(req.headers.authorization||"");
  if(header.startsWith("Bearer "))db.sessions.delete(header.slice(7));
  res.setHeader("Set-Cookie","lca_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
  res.json({ok:true});
});

app.get("/api/me",auth,(req,res)=>{
  awardTime(req.user); activeTouch(req.user);
  res.setHeader("Cache-Control","no-store");
  res.json({ok:true,account:safeUser(req.user)});
});

// ---------- Activity / Currency ----------
app.post("/api/activity",auth,(req,res)=>{
  awardTime(req.user);
  activeTouch(req.user);
  res.json({ok:true,account:safeUser(req.user)});
});
app.get("/api/currency",auth,(req,res)=>{
  awardTime(req.user);
  res.json({points:req.user.points,diamonds:req.user.diamonds,time:req.user.time,ownerTokens:req.user.ownerTokens});
});
app.post("/api/exchange/time-diamond",auth,(req,res)=>{
  const amount=Math.max(1,Math.floor(Number(req.body.amount||1)));
  const cost=amount*5;
  if(req.user.time<cost)return res.status(400).json({error:"NOT_ENOUGH_TIME"});
  req.user.time-=cost; req.user.diamonds+=amount;
  res.json({ok:true,account:safeUser(req.user)});
});
app.post("/api/exchange/time-owner-token",auth,(req,res)=>{
  const amount=Math.max(1,Math.floor(Number(req.body.amount||1)));
  const cost=amount*10;
  if(req.user.time<cost)return res.status(400).json({error:"NOT_ENOUGH_TIME"});
  req.user.time-=cost; req.user.ownerTokens+=amount;
  res.json({ok:true,account:safeUser(req.user)});
});

// Owner grants: unlimited amount. Blank username means self.
function grantField(field){
  return (req,res)=>{
    const target=cleanUser(req.body.username) || req.username;
    const amount=Number(req.body.amount);
    if(!Number.isFinite(amount) || amount<0 || !Number.isInteger(amount))
      return res.status(400).json({error:"INVALID_AMOUNT"});
    const u=db.users.get(target);
    if(!u)return res.status(404).json({error:"USER_NOT_FOUND"});
    u[field]+=amount;
    res.json({ok:true,account:safeUser(u)});
  };
}
app.post("/api/owner/give-time",auth,ownerOnly,grantField("time"));
app.post("/api/owner/give-points",auth,ownerOnly,grantField("points"));
app.post("/api/owner/give-diamonds",auth,ownerOnly,grantField("diamonds"));
app.post("/api/owner/give-owner-token",auth,ownerOnly,grantField("ownerTokens"));

// ---------- Achievements ----------
const achievementCategories=["Chatting","Social","Servers","Economy","Pets","Challenges","Staff","Milestones","Exploration","Special"];
for(let i=1;i<=100;i++){
  db.achievements.push({id:"a"+i,name:`Achievement ${i}`,category:achievementCategories[(i-1)%10],description:`Complete milestone ${i}.`});
}
app.get("/api/achievements",auth,(req,res)=>{
  res.json({achievements:db.achievements,unlocked:req.user.badges});
});

// ---------- Challenges ----------
function buildChallenges(){
  for(const type of ["daily","weekly","monthly"]){
    const arr=[];
    for(let i=1;i<=100;i++){
      arr.push({id:`${type}-${i}`,type,title:`${type[0].toUpperCase()+type.slice(1)} Challenge ${i}`,description:`Complete objective ${i}.`,reward:{points:i*2,time:Math.max(1,Math.floor(i/10))}});
    }
    db.challenges[type]=arr;
  }
}
buildChallenges();
app.get("/api/challenges",auth,(req,res)=>{
  const pick=type=>db.challenges[type].slice().sort(()=>Math.random()-.5).slice(0,5);
  res.json({daily:pick("daily"),weekly:pick("weekly"),monthly:pick("monthly")});
});

// ---------- Daily rewards ----------
app.get("/api/daily-rewards",auth,(req,res)=>{
  const day=Math.floor(Date.now()/86400000);
  const rewards=Array.from({length:31},(_,i)=>({day:i+1,reward:{points:100+(i*25),time:1+Math.floor(i/7)}}));
  res.json({day,rewards,claimed:[]});
});

// ---------- Pets ----------
const rarities=[
  ["Common",3,60,40],["Uncommon",5,100,30],["Rare",10,200,20],
  ["Epic",25,500,6],["Legendary",50,1000,3],["GOD",250,5000,1]
];
for(let i=1;i<=100;i++){
  let r=rarities[(i-1)%rarities.length];
  db.pets.push({id:"pet"+i,name:`Pet ${i}`,rarity:r[0],ownerTokens:r[1],diamonds:r[2],chance:r[3]});
}
app.get("/api/pets",auth,(req,res)=>{
  const five=db.pets.slice().sort(()=>Math.random()-.5).slice(0,5);
  res.json({pets:five,rarities});
});
app.post("/api/pets/buy",auth,(req,res)=>{
  const p=db.pets.find(x=>x.id===req.body.petId);
  if(!p)return res.status(404).json({error:"PET_NOT_FOUND"});
  if(req.body.currency==="diamonds"){
    if(req.user.diamonds<p.diamonds)return res.status(400).json({error:"NOT_ENOUGH_DIAMONDS"});
    req.user.diamonds-=p.diamonds;
  }else{
    if(req.user.ownerTokens<p.ownerTokens)return res.status(400).json({error:"NOT_ENOUGH_OWNER_TOKENS"});
    req.user.ownerTokens-=p.ownerTokens;
  }
  req.user.pets.push(p.id);
  res.json({ok:true,account:safeUser(req.user),pet:p});
});

// ---------- Feature state endpoints ----------
app.get("/api/features",auth,(req,res)=>res.json({
  customStatus:req.user.status, following:[], auditLog:[], levels:{level:req.user.level,xp:req.user.xp},
  threads:[],scheduled:[],drafts:[],reminders:[],trading:[],voice:{record:true,transcribe:true}
}));

// ---------- Static ----------
app.get("/health",(req,res)=>res.json({ok:true}));
const fs = require("fs");
const publicDir = path.join(__dirname, "public");
const publicIndex = path.join(publicDir, "index.html");
const rootIndex = path.join(__dirname, "index.html");

// Serve either layout so Render uploads that flatten folders still work.
if (fs.existsSync(publicDir)) app.use(express.static(publicDir));
app.use(express.static(__dirname));

app.get("/",(req,res)=>{
  if (fs.existsSync(publicIndex)) return res.sendFile(publicIndex);
  if (fs.existsSync(rootIndex)) return res.sendFile(rootIndex);
  return res.status(500).send("LCA frontend is missing. Upload index.html with server.js.");
});

app.get("*",(req,res)=>{
  if (req.path.startsWith("/api/")) return res.status(404).json({error:"NOT_FOUND"});
  if (fs.existsSync(publicIndex)) return res.sendFile(publicIndex);
  if (fs.existsSync(rootIndex)) return res.sendFile(rootIndex);
  return res.status(500).send("LCA frontend is missing.");
});

let server;
function start(){
  server=app.listen(PORT,HOST,()=>console.log(`LCA listening on ${HOST}:${PORT}`));
  server.keepAliveTimeout=65000;
  server.headersTimeout=66000;
}
start();
process.on("SIGTERM",()=>server?.close(()=>process.exit(0)));
process.on("SIGINT",()=>server?.close(()=>process.exit(0)));
