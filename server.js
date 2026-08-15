const express = require("express");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 10000;
app.use(express.json({limit:"1mb"}));
app.use(express.urlencoded({extended:true}));
app.get("/health", (_req,res)=>res.json({ok:true,app:"LCA",version:"1.16-rebuild"}));
app.get("*", (_req,res)=>res.sendFile(path.join(__dirname,"index.html")));
app.listen(PORT,"0.0.0.0",()=>console.log(`LCA listening on 0.0.0.0:${PORT}`));
