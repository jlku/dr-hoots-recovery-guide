import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const FORMAT = "aformat=sample_rates=44100:channel_layouts=mono";

export function timelineElements(timeline) {
  const elements = [{ kind: "silence", seconds: timeline.title_card.end - timeline.title_card.start }];
  timeline.beats.forEach((beat, index) => {
    elements.push({ kind: "track", file: beat.source_audio, seconds: beat.speech_seconds, beat: beat.id });
    const isLast = index === timeline.beats.length - 1;
    elements.push({ kind: "silence", seconds: isLast ? timeline.tail_seconds : timeline.beat_gap_seconds });
  });
  return elements.filter((element) => element.kind === "track" || element.seconds > 0);
}

export function buildConcatCommand({ timeline, root, outputPath }) {
  const elements = timelineElements(timeline);
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y"];
  const chains = [];
  elements.forEach((element, index) => {
    if (element.kind === "silence") {
      args.push("-f", "lavfi", "-t", element.seconds.toFixed(3), "-i", "anullsrc=r=44100:cl=mono");
      chains.push(`[${index}:a]${FORMAT}[a${index}]`);
    } else {
      args.push("-i", join(root, element.file));
      chains.push(`[${index}:a]atrim=0:${element.seconds.toFixed(3)},asetpts=PTS-STARTPTS,${FORMAT}[a${index}]`);
    }
  });
  const concat = `${elements.map((_, index) => `[a${index}]`).join("")}concat=n=${elements.length}:v=0:a=1[out]`;
  args.push("-filter_complex", `${chains.join(";")};${concat}`, "-map", "[out]", "-c:a", "libmp3lame", "-q:a", "4", outputPath);
  return { args, elements };
}

export async function renderSegmentAudio({ timeline, root, outputPath, ffmpeg = "ffmpeg" }) {
  const { args } = buildConcatCommand({ timeline, root, outputPath });
  await execFileAsync(ffmpeg, args);
  return outputPath;
}

export async function probeDurationSeconds(path, ffprobe = "ffprobe") {
  const { stdout } = await execFileAsync(ffprobe, [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path
  ]);
  return Number(stdout.trim());
}
