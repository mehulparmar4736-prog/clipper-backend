const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");

const CLIP_DURATION = 30;

function getDuration(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, data) => {
      if (err) return reject(err);
      resolve(data.format.duration);
    });
  });
}

function detectSceneChanges(videoPath) {
  return new Promise((resolve, reject) => {
    const timestamps = [];

    ffmpeg(videoPath)
      .outputOptions(["-vf", "select='gt(scene,0.4)',showinfo", "-f", "null"])
      .output("-")
      .on("stderr", (line) => {
        const match = line.match(/pts_time:([\d.]+)/);
        if (match) {
          timestamps.push(parseFloat(match[1]));
        }
      })
      .on("end", () => resolve(timestamps))
      .on("error", (err) => {
        console.warn("Scene detection failed, falling back to fixed chunks:", err.message);
        resolve([]);
      })
      .run();
  });
}

function buildClipPlan(duration, sceneTimestamps) {
  const plan = [];
  let cursor = 0;

  while (cursor < duration) {
    let start = cursor;
    let end = Math.min(cursor + CLIP_DURATION, duration);

    if (sceneTimestamps.length > 0) {
      const nearby = sceneTimestamps.find(
        (t) => t >= start - 3 && t <= start + 3 && t > 0.5
      );
      if (nearby !== undefined) {
        start = nearby;
        end = Math.min(start + CLIP_DURATION, duration);
      }
    }

    if (end - start >= 5) {
      plan.push({ start, end });
    }
    cursor = end;
  }

  return plan;
}

function cutClip(sourcePath, outputPath, start, end) {
  return new Promise((resolve, reject) => {
    ffmpeg(sourcePath)
      .setStartTime(start)
      .setDuration(end - start)
      .outputOptions(["-c:v", "libx264", "-preset", "fast", "-c:a", "aac"])
      .output(outputPath)
      .on("end", () => resolve(outputPath))
      .on("error", (err) => reject(err))
      .run();
  });
}

async function processVideoIntoClips(sourcePath, outputDir, jobId) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const duration = await getDuration(sourcePath);
  const sceneTimestamps = await detectSceneChanges(sourcePath);
  const plan = buildClipPlan(duration, sceneTimestamps);

  const clips = [];
  for (let i = 0; i < plan.length; i++) {
    const { start, end } = plan[i];
    const fileName = `${jobId}_clip_${i + 1}.mp4`;
    const outputPath = path.join(outputDir, fileName);
    await cutClip(sourcePath, outputPath, start, end);
    clips.push({
      index: i + 1,
      fileName,
      start: Math.round(start),
      end: Math.round(end),
      durationSec: Math.round(end - start),
    });
  }

  return clips;
}

module.exports = { processVideoIntoClips, getDuration, CLIP_DURATION };
