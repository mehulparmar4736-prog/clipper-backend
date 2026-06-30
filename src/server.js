const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const { processVideoIntoClips } = require("./videoProcessor");

const app = express();
app.use(cors());
app.use(express.json());

const UPLOAD_DIR = path.join(__dirname, "..", "storage", "uploads");
const CLIPS_DIR = path.join(__dirname, "..", "storage", "clips");
[UPLOAD_DIR, CLIPS_DIR].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const jobs = {};

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${uuidv4()}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [".mp4", ".mov", ".mkv", ".webm"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error("Unsupported file type"));
  },
});

app.post("/api/upload", upload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const jobId = uuidv4();
  jobs[jobId] = { status: "processing", clips: [], error: null };

  res.json({ jobId, status: "processing" });

  const jobOutputDir = path.join(CLIPS_DIR, jobId);
  try {
    const clips = await processVideoIntoClips(req.file.path, jobOutputDir, jobId);
    jobs[jobId] = { status: "done", clips, error: null };
  } catch (err) {
    console.error("Processing failed:", err);
    jobs[jobId] = { status: "failed", clips: [], error: err.message };
  }
});

app.get("/api/jobs/:jobId", (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

app.get("/api/jobs/:jobId/clips/:fileName/download", (req, res) => {
  const { jobId, fileName } = req.params;
  const filePath = path.join(CLIPS_DIR, jobId, fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Clip not found" });
  }
  res.download(filePath, fileName);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
