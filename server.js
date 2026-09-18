const express = require("express");
const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const { spawn } = require("child_process");

const app = express();
app.use(express.json());

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});

const bucket = process.env.R2_BUCKET;

app.post("/presign", async (req, res) => {
  try {
    const contentType = req.body.contentType || "video/mp4";

    if (!contentType.startsWith("video/")) {
      return res.status(400).json({ error: "Video only" });
    }

    const id = Date.now() + "-" + Math.random().toString(36).slice(2, 10);
    const inputKey = uploads/${id}-original.mp4;
    const outputKey = compressed/${id}-720p.mp4;

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: inputKey,
      ContentType: contentType
    });

    const uploadUrl = await getSignedUrl(s3, command, {
      expiresIn: 900
    });

    res.json({
      uploadUrl,
      inputKey,
      outputKey
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/process", async (req, res) => {
  try {
    if (req.headers["x-processor-token"] !== process.env.PROCESSOR_TOKEN) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { inputKey, outputKey } = req.body;

    if (!inputKey || !outputKey) {
      return res.status(400).json({
        error: "inputKey and outputKey required"
      });
    }

    const id = Date.now().toString();
    const inputFile = path.join("/tmp", ${id}-input.mp4);
    const outputFile = path.join("/tmp", ${id}-output.mp4);

    const object = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: inputKey
      })
    );

    await pipeline(object.Body, fs.createWriteStream(inputFile));

    await new Promise((resolve, reject) => {
      const p = spawn("ffmpeg", [
        "-y",
        "-i", inputFile,
        "-vf", "scale=-2:720",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "28",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        outputFile
      ]);

      p.on("error", reject);

      p.on("close", code => {
        if (code === 0) resolve();
        else reject(new Error(FFmpeg exited with code ${code}));
      });
    });

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: outputKey,
        Body: fs.createReadStream(outputFile),
        ContentType: "video/mp4"
      })
    );

    await s3.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: inputKey
      })
    );

    res.json({
      ok: true,
      outputKey
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err.message
    });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT);
