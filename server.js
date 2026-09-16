const express=require("express");
const {S3Client,GetObjectCommand,PutObjectCommand,DeleteObjectCommand}=require("@aws-sdk/client-s3");
const fs=require("fs"),os=require("os"),path=require("path"); const {pipeline}=require("stream/promises"); const {spawn}=require("child_process");
const app=express(); app.use(express.json({limit:"1mb"})); app.get("/",(_,r)=>r.json({ok:true,service:"grandpaa-video-compressor"})); app.get("/health",(_,r)=>r.json({ok:true}));
const need=n=>{if(!process.env[n])throw Error("Missing "+n);return process.env[n]}, valid=k=>typeof k==="string"&&k.length>0&&k.length<900&&!k.includes("..");
function ffmpeg(i,o){return new Promise((ok,no)=>{const p=spawn("ffmpeg",["-y","-i",i,"-vf","scale='min(720,iw)':-2","-c:v","libx264","-preset","medium","-crf","23","-c:a","aac","-b:a","128k","-movflags","+faststart",o]);let e="";p.stderr.on("data",d=>{if(e.length<12000)e+=d});p.on("error",no);p.on("close",c=>c===0?ok():no(Error("ffmpeg failed: "+e.slice(-2000))))})}
app.post("/process",async(req,res)=>{if(!process.env.PROCESSOR_TOKEN||req.get("x-processor-token")!==process.env.PROCESSOR_TOKEN)return res.status(401).json({error:"Unauthorized"});
const {inputKey,outputKey,deleteOriginal=false}=req.body||{};if(!valid(inputKey)||!valid(outputKey))return res.status(400).json({error:"Valid inputKey and outputKey required"});let dir;
try{const bucket=need("R2_BUCKET"),s3=new S3Client({region:"auto",endpoint:need("R2_ENDPOINT"),credentials:{accessKeyId:need("R2_ACCESS_KEY_ID"),secretAccessKey:need("R2_SECRET_ACCESS_KEY")}});
dir=fs.mkdtempSync(path.join(os.tmpdir(),"grandpaa-"));const i=path.join(dir,"in.mp4"),o=path.join(dir,"out.mp4");const obj=await s3.send(new GetObjectCommand({Bucket:bucket,Key:inputKey}));await pipeline(obj.Body,fs.createWriteStream(i));await ffmpeg(i,o);await s3.send(new PutObjectCommand({Bucket:bucket,Key:outputKey,Body:fs.createReadStream(o),ContentType:"video/mp4"}));if(deleteOriginal)await s3.send(new DeleteObjectCommand({Bucket:bucket,Key:inputKey}));res.json({ok:true,inputKey,outputKey})}
catch(e){console.error(e);res.status(500).json({error:"Processing failed",detail:e.message})}finally{if(dir)fs.rmSync(dir,{recursive:true,force:true})}});
app.listen(Number(process.env.PORT||8080),"0.0.0.0");
