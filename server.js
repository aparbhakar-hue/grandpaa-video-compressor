const express=require("express");
const {S3Client,GetObjectCommand,PutObjectCommand,DeleteObjectCommand,CreateMultipartUploadCommand,UploadPartCommand,CompleteMultipartUploadCommand}=require("@aws-sdk/client-s3");
const {getSignedUrl}=require("@aws-sdk/s3-request-presigner");
const {pipeline}=require("stream/promises");
const fs=require("fs");
const {spawn}=require("child_process");

const app=express();

const s3=new S3Client({
 region:"auto",
 endpoint:process.env.R2_ENDPOINT,
 credentials:{
  accessKeyId:process.env.R2_ACCESS_KEY_ID,
  secretAccessKey:process.env.R2_SECRET_ACCESS_KEY
 }
});

const B=process.env.R2_BUCKET;

app.use(express.json());

app.use((q,s,n)=>{
 s.set("Access-Control-Allow-Origin","*");
 s.set("Access-Control-Allow-Headers","Content-Type");
 s.set("Access-Control-Allow-Methods","GET,POST,PUT,OPTIONS");
 if(q.method==="OPTIONS")return s.sendStatus(204);
 n();
});

app.post("/multipart/start",async(q,s)=>{
 try{
  const n=Date.now();
  const inputKey="uploads/"+n+".mp4";
  const outputKey="compressed/"+n+".mp4";

  const r=await s3.send(new CreateMultipartUploadCommand({
   Bucket:B,
   Key:inputKey,
   ContentType:"video/mp4"
  }));

  s.json({
   inputKey,
   outputKey,
   uploadId:r.UploadId
  });
 }catch(e){
  console.error("START ERROR",e);
  s.status(500).json({error:e.message});
 }
});

app.post("/multipart/part",async(q,s)=>{
 try{
  const {inputKey,uploadId,partNumber}=q.body;

  const url=await getSignedUrl(
   s3,
   new UploadPartCommand({
    Bucket:B,
    Key:inputKey,
    UploadId:uploadId,
    PartNumber:partNumber
   }),
   {expiresIn:900}
  );

  s.json({url});
 }catch(e){
  console.error("PART ERROR",e);
  s.status(500).json({error:e.message});
 }
});

app.post("/multipart/complete",async(q,s)=>{
 try{
  const {inputKey,uploadId,parts}=q.body;

  await s3.send(new CompleteMultipartUploadCommand({
   Bucket:B,
   Key:inputKey,
   UploadId:uploadId,
   MultipartUpload:{Parts:parts}
  }));

  s.json({ok:true});
 }catch(e){
  console.error("COMPLETE ERROR",e);
  s.status(500).json({error:e.message});
 }
});

app.post("/process",async(q,s)=>{
 try{
  const {inputKey,outputKey}=q.body;
  const input="/tmp/in.mp4";
  const output="/tmp/out.mp4";

  const x=await s3.send(new GetObjectCommand({
   Bucket:B,
   Key:inputKey
  }));

  await pipeline(x.Body,fs.createWriteStream(input));

  await new Promise((resolve,reject)=>{
   const p=spawn("ffmpeg",[
    "-y","-i",input,
    "-vf","scale=-2:720",
    "-c:v","libx264",
    "-crf","28",
    output
   ]);

   p.on("error",reject);
   p.on("close",c=>c?reject(Error("ffmpeg")):resolve());
  });

  await s3.send(new PutObjectCommand({
   Bucket:B,
   Key:outputKey,
   Body:fs.createReadStream(output),
   ContentType:"video/mp4"
  }));

  await s3.send(new DeleteObjectCommand({
   Bucket:B,
   Key:inputKey
  }));

  s.json({
   ok:true,
   url:"https://"+q.get("host")+"/media?key="+encodeURIComponent(outputKey)
  });

 }catch(e){
  console.error("PROCESS ERROR",e);
  s.status(500).json({error:e.message});
 }
});

app.get("/media",async(q,s)=>{
 try{
  const url=await getSignedUrl(
   s3,
   new GetObjectCommand({
    Bucket:B,
    Key:q.query.key
   }),
   {expiresIn:900}
  );

  s.redirect(url);
 }catch(e){
  console.error("MEDIA ERROR",e);
  s.status(500).json({error:e.message});
 }
});

app.listen(process.env.PORT||8080);
