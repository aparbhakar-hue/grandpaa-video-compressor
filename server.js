const express = require("express");
const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const { spawn } = require("child_process");

const app = express();
app.use(express.json({ limit: "1mb" }));

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});

const bucket = process.env.R2_BUCKET;

app.get("/", (req, res) => {
  res.status(200).send("Grandpaa Video Compressor is running");
});

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

/* STEP 1 — CREATE DIRECT R2 UPLOAD URL */
app.post("/presign", async (req, res) => {
  try {
    const contentType = req.body.contentType || "video
