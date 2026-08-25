import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  mkdir,
  open,
  readFile,
  rename,
  rmdir
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createFalClient } from "@fal-ai/client";

import {
  addArtifact,
  createArtifactRecord,
  persistRunRevision,
  reportRunStop,
  validateRunState
} from "./lib/production-run.mjs";
import {
  MEDIA_EXPIRATION_SECONDS,
  MODEL_ID,
  buildHostSubmissionPlan,
  buildProviderHeaders,
  inspectDownloadedVideoBytes,
  redactProviderData,
  reserveProviderAttempt,
  transitionProviderAttempt,
  validateDownloadedDuration,
  validateProviderDownloadUrl
} from "./lib/provider-boundary.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUN_ID_PATTERN = /^(?=.{1,128}$)(?=.*[^.])[A-Za-z0-9._-]+$/;
const MAX_REDIRECTS = 3;
const POLL_INTERVAL_MS = 2000;
const POLL_LIMIT = 900;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseArguments(argv) {
  const options = {
    runId: null,
    stateRoot: resolve(repositoryRoot, ".production/activation"),
    submit: false,
    reconcile: false,
    performanceId: null,
    json: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--run-id") {
      options.runId = value;
      index += 1;
    } else if (argument === "--state-root") {
      options.stateRoot = resolve(value);
      index += 1;
    } else if (argument === "--submit") {
      options.submit = true;
    } else if (argument === "--reconcile") {
      options.reconcile = true;
    } else if (argument === "--performance-id") {
      options.performanceId = value;
      index += 1;
    } else if (argument === "--json") {
      options.json = true;
    } else {
      throw new Error("unknown argument: " + argument);
    }
  }
  if (!RUN_ID_PATTERN.test(options.runId ?? "")) throw new Error("--run-id is required");
  if (options.submit && options.reconcile) {
    throw new Error("choose only one of --submit or --reconcile");
  }
  if ((options.submit || options.reconcile) && !options.performanceId) {
    throw new Error("--submit and --reconcile require --performance-id");
  }
  return options;
}

async function atomicWrite(path, value, { json = true } = {}) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + ".tmp-" + process.pid + "-" + randomUUID();
  const handle = await open(temporary, "wx", 0o600);
  try {
    if (json) await handle.writeFile(JSON.stringify(value, null, 2) + "\n");
    else await handle.writeFile(value);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

async function withAttemptLock(root, operation) {
  await mkdir(root, { recursive: true });
  const lockPath = join(root, ".writer.lock");
  let acquired = false;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      await mkdir(lockPath);
      acquired = true;
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
  }
  if (!acquired) throw new Error("provider attempt writer is busy");
  try {
    return await operation();
  } finally {
    await rmdir(lockPath);
  }
}

async function loadCurrentRun(stateRoot, runId) {
  const runRoot = join(stateRoot, "runs", runId);
  const pointer = JSON.parse(await readFile(join(runRoot, "current.json"), "utf8"));
  const run = JSON.parse(
    await readFile(join(runRoot, "revisions", pointer.revision_id.slice(9) + ".json"), "utf8")
  );
  validateRunState(run);
  return { runRoot, run, pointer };
}

function currentArtifact(run, kind) {
  const matches = run.artifacts.filter(
    (candidate) =>
      candidate.kind === kind &&
      candidate.content_lock_id === run.current_content_lock_id &&
      run.valid_artifacts.includes(candidate.candidate_asset_id)
  );
  if (matches.length !== 1) throw new Error("expected one current artifact: " + kind);
  return matches[0];
}

async function loadPlanInputs(stateRoot, runId) {
  const { runRoot, run, pointer } = await loadCurrentRun(stateRoot, runId);
  const timelineArtifact = currentArtifact(run, "activation_timeline_json");
  const manifestArtifact = currentArtifact(run, "activation_radio_manifest");
  const radioArtifact = currentArtifact(run, "activation_radio_cut_mp3");
  const [timeline, radioManifest] = await Promise.all([
    readFile(join(runRoot, timelineArtifact.file_path), "utf8").then(JSON.parse),
    readFile(join(runRoot, manifestArtifact.file_path), "utf8").then(JSON.parse)
  ]);
  const plan = buildHostSubmissionPlan({
    run,
    contentLockId: run.current_content_lock_id,
    radioBundleId: radioManifest.bundle_id,
    imagePath: "assets/character/dr-hoots-motion-base-v2.png",
    scenes: timeline.scenes
  });
  return {
    runRoot,
    run,
    pointer,
    timeline,
    radioManifest,
    radioArtifact,
    plan
  };
}

async function persistLedgerAndRun({
  stateRoot,
  runId,
  transform,
  stopReason = null
}) {
  const runRoot = join(stateRoot, "runs", runId);
  const attemptsRoot = join(runRoot, "attempts");
  const ledgerPath = join(attemptsRoot, "spend-ledger.json");
  return withAttemptLock(attemptsRoot, async () => {
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    const current = await loadCurrentRun(stateRoot, runId);
    const transformed = await transform({ ledger, run: current.run });
    await atomicWrite(ledgerPath, transformed.ledger);
    let nextRun = {
      ...structuredClone(transformed.run ?? current.run),
      held_reservations: structuredClone(transformed.ledger.held_reservations)
    };
    if (stopReason) nextRun = reportRunStop(nextRun, stopReason);
    const persistence = await persistRunRevision(stateRoot, nextRun);
    return {
      ...transformed,
      run: nextRun,
      persistence,
      ledgerPath
    };
  });
}

async function verifyLockedInputs({ stateRoot, run, timeline, performance }) {
  const lock = JSON.parse(
    await readFile(
      join(stateRoot, "locks", run.current_content_lock_id.slice("lock:".length) + ".json"),
      "utf8"
    )
  );
  const imageRecord = lock.inputs.find(
    (input) => input.source_path === performance.image_path
  );
  if (!imageRecord) throw new Error("host image is absent from the current content lock");
  const scene = timeline.scenes.find(
    (candidate) => candidate.scene_id === performance.scene_id
  );
  if (!scene || scene.narration_id !== performance.narration_id) {
    throw new Error("host audio scene is absent from the locked timeline");
  }
  const [imageBytes, audioBytes] = await Promise.all([
    readFile(join(repositoryRoot, performance.image_path)),
    readFile(join(repositoryRoot, performance.audio_path))
  ]);
  if (
    imageBytes.byteLength !== imageRecord.byte_length ||
    sha256(imageBytes) !== imageRecord.sha256
  ) {
    throw new Error("host image hash drifted from the current content lock");
  }
  if (
    audioBytes.byteLength !== scene.audio_byte_length ||
    sha256(audioBytes) !== scene.audio_sha256
  ) {
    throw new Error("host audio hash drifted from the locked radio timeline");
  }
  return {
    imageBytes,
    audioBytes,
    imageSha256: imageRecord.sha256,
    audioSha256: scene.audio_sha256
  };
}

function falClient(apiKey) {
  return createFalClient({
    credentials: apiKey,
    requestMiddleware: async (request) => ({
      ...request,
      headers: {
        ...(request.headers ?? {}),
        ...buildProviderHeaders()
      }
    })
  });
}

async function downloadBounded(initialUrl) {
  let url = validateProviderDownloadUrl(initialUrl);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetch(url, { redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirects === MAX_REDIRECTS) {
        throw new Error("provider download redirect is invalid or excessive");
      }
      url = validateProviderDownloadUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok || !response.body) {
      throw new Error("provider download failed with status " + response.status);
    }
    const declaredLength = Number(response.headers.get("content-length"));
    const chunks = [];
    let byteLength = 0;
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > 250 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("provider download exceeds the allowed size");
      }
      chunks.push(Buffer.from(value));
    }
    const bytes = Buffer.concat(chunks);
    const inspection = inspectDownloadedVideoBytes({
      bytes,
      contentType: response.headers.get("content-type"),
      contentLength: Number.isFinite(declaredLength) && declaredLength > 0
        ? declaredLength
        : bytes.byteLength
    });
    return { bytes, inspection };
  }
  throw new Error("provider download redirect loop");
}

function parseFrameRate(value) {
  const [numerator, denominator] = String(value ?? "0/1").split("/").map(Number);
  const result = numerator / denominator;
  if (!Number.isFinite(result) || result <= 0) throw new Error("provider video frame rate is invalid");
  return result;
}

async function inspectMedia(path, expectedDuration) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:stream=index,codec_type,codec_name,width,height,r_frame_rate",
    "-of", "json",
    path
  ]);
  const report = JSON.parse(stdout);
  const video = report.streams?.find((stream) => stream.codec_type === "video");
  const audio = report.streams?.find((stream) => stream.codec_type === "audio");
  if (!video || !audio) throw new Error("provider candidate must contain video and audio streams");
  const framesPerSecond = parseFrameRate(video.r_frame_rate);
  const duration = Number(report.format?.duration);
  const durationValidation = validateDownloadedDuration({
    expectedSeconds: expectedDuration,
    actualSeconds: duration,
    framesPerSecond
  });
  if (video.width < 720 || video.height < 720) {
    throw new Error("provider candidate resolution is below the approved minimum");
  }
  return {
    report,
    video_stream: {
      codec: video.codec_name,
      width: video.width,
      height: video.height,
      frames_per_second: framesPerSecond
    },
    audio_stream: { codec: audio.codec_name },
    duration: durationValidation
  };
}

async function finalizeProviderRequest({
  options,
  inputs,
  performance,
  locked,
  reservation,
  requestId,
  client
}) {
  let status;
  for (let poll = 0; poll < POLL_LIMIT; poll += 1) {
    status = await client.queue.status(MODEL_ID, { requestId, logs: false });
    if (status.status === "COMPLETED") break;
    await new Promise((resolveWait) => setTimeout(resolveWait, POLL_INTERVAL_MS));
  }
  if (status?.status !== "COMPLETED") {
    throw new Error("provider request remains pending; rerun --reconcile by performance identity");
  }
  const result = await client.queue.result(MODEL_ID, { requestId });
  const videoUrl = result.data?.video?.url;
  validateProviderDownloadUrl(videoUrl);
  const downloaded = await downloadBounded(videoUrl);
  const attemptRoot = join(
    inputs.runRoot,
    "attempts",
    reservation.reservation_id.slice("reservation:".length)
  );
  const candidatePath = join(attemptRoot, "candidate.mp4");
  await atomicWrite(candidatePath, downloaded.bytes, { json: false });
  const media = await inspectMedia(candidatePath, performance.duration_seconds);

  const completed = await persistLedgerAndRun({
    stateRoot: options.stateRoot,
    runId: options.runId,
    transform: ({ ledger, run }) => {
      const transitioned = transitionProviderAttempt(ledger, {
        reservationId: reservation.reservation_id,
        event: "provider_succeeded",
        actualCostUsd: reservation.maximum_cost_usd
      });
      const relativePath = candidatePath.slice(inputs.runRoot.length + 1);
      const candidate = createArtifactRecord({
        kind: "activation_host_performance_candidate",
        outputHash: downloaded.inspection.sha256,
        contentLockId: run.current_content_lock_id,
        directInputIds: [
          run.current_content_lock_id,
          inputs.radioArtifact.candidate_asset_id
        ],
        filePath: relativePath,
        reviewState: "unreviewed",
        provenance: {
          source: "generated",
          prompt: performance.prompt,
          model: MODEL_ID,
          request_id: requestId,
          settings: {
            performance_id: performance.performance_id,
            duration_seconds: performance.duration_seconds,
            gesture_envelope: performance.gesture_envelope,
            media_expiration_seconds: MEDIA_EXPIRATION_SECONDS,
            request_payload_storage: false,
            image_sha256: locked.imageSha256,
            audio_sha256: locked.audioSha256
          }
        }
      });
      return {
        ledger: transitioned.ledger,
        run: addArtifact(run, candidate),
        reservation: transitioned.reservation,
        candidate
      };
    }
  });

  await atomicWrite(join(attemptRoot, "validation.json"), {
    schema_version: "activation-provider-validation/v1",
    reservation_id: reservation.reservation_id,
    request_id: requestId,
    byte_inspection: downloaded.inspection,
    media,
    patient_ready: false,
    review_state: "unreviewed"
  });
  return {
    provider_call_made: true,
    reconciled: true,
    performance_id: performance.performance_id,
    reservation_id: reservation.reservation_id,
    provider_request_id: requestId,
    candidate_asset_id: completed.candidate.candidate_asset_id,
    output_sha256: downloaded.inspection.sha256,
    duration: media.duration,
    review_state: "unreviewed",
    revision_id: completed.persistence.revision_id,
    patient_ready: false
  };
}

async function reconcilePerformance(options, inputs) {
  if (!inputs.plan.provider_call_allowed) {
    throw new Error(
      "provider reconciliation blocked: " +
      (inputs.plan.block_reason ?? "production_run_not_ready")
    );
  }
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) throw new Error("FAL_KEY is required only for --reconcile");
  const performance = inputs.plan.performances.find(
    (candidate) => candidate.performance_id === options.performanceId
  );
  if (!performance) throw new Error("unknown or non-host performance id");
  const ledger = JSON.parse(
    await readFile(join(inputs.runRoot, "attempts", "spend-ledger.json"), "utf8")
  );
  const attempts = ledger.attempts.filter(
    (attempt) =>
      attempt.performance_id === performance.performance_id &&
      attempt.state === "provider_pending"
  );
  if (attempts.length !== 1 || !attempts[0].provider_request_id) {
    throw new Error("expected one reconcilable provider_pending attempt");
  }
  const locked = await verifyLockedInputs({
    stateRoot: options.stateRoot,
    run: inputs.run,
    timeline: inputs.timeline,
    performance
  });
  return finalizeProviderRequest({
    options,
    inputs,
    performance,
    locked,
    reservation: attempts[0],
    requestId: attempts[0].provider_request_id,
    client: falClient(apiKey)
  });
}

async function submitPerformance(options, inputs) {
  if (!inputs.plan.provider_call_allowed) {
    throw new Error(
      "provider call blocked: " + (inputs.plan.block_reason ?? "production_run_not_ready")
    );
  }
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) throw new Error("FAL_KEY is required only for --submit");
  const performance = inputs.plan.performances.find(
    (candidate) => candidate.performance_id === options.performanceId
  );
  if (!performance) throw new Error("unknown or non-host performance id");
  const locked = await verifyLockedInputs({
    stateRoot: options.stateRoot,
    run: inputs.run,
    timeline: inputs.timeline,
    performance
  });
  const ledgerSnapshot = JSON.parse(
    await readFile(join(inputs.runRoot, "attempts", "spend-ledger.json"), "utf8")
  );
  const priorAttempts = ledgerSnapshot.attempts.filter(
    (attempt) => attempt.performance_id === performance.performance_id
  );
  const nonRetryable = priorAttempts.find(
    (attempt) => !new Set(["rejected", "provider_failed"]).has(attempt.state)
  );
  if (nonRetryable) {
    throw new Error(
      "a provider attempt already exists in non-retryable state " + nonRetryable.state
    );
  }
  const attemptNumber = priorAttempts.length + 1;
  const idempotencyKey =
    "activation-host:" +
    sha256(
      JSON.stringify({
        run_id: options.runId,
        content_lock_id: inputs.run.current_content_lock_id,
        performance_id: performance.performance_id,
        attempt_number: attemptNumber,
        model_id: MODEL_ID,
        prompt: performance.prompt,
        image_sha256: locked.imageSha256,
        audio_sha256: locked.audioSha256
      })
    );

  const reserved = await persistLedgerAndRun({
    stateRoot: options.stateRoot,
    runId: options.runId,
    transform: ({ ledger, run }) => {
      const result = reserveProviderAttempt(ledger, {
        performanceId: performance.performance_id,
        durationSeconds: performance.duration_seconds,
        clientIdempotencyKey: idempotencyKey
      });
      return { ledger: result.ledger, run, reservation: result.reservation, reused: result.reused };
    }
  });
  if (reserved.reused && reserved.reservation.state !== "reserved") {
    throw new Error(
      "the deterministic provider attempt already exists in state " + reserved.reservation.state
    );
  }

  const client = falClient(apiKey);
  const imageFile = new File(
    [locked.imageBytes],
    basename(performance.image_path),
    { type: "image/png" }
  );
  const audioFile = new File(
    [locked.audioBytes],
    basename(performance.audio_path),
    { type: "audio/mpeg" }
  );
  const lifecycle = { expiresIn: MEDIA_EXPIRATION_SECONDS };
  const [imageUrl, audioUrl] = await Promise.all([
    client.storage.upload(imageFile, { lifecycle }),
    client.storage.upload(audioFile, { lifecycle })
  ]);

  await atomicWrite(
    join(
      inputs.runRoot,
      "attempts",
      reserved.reservation.reservation_id.slice("reservation:".length),
      "input-receipt.json"
    ),
    {
      schema_version: "activation-provider-input-receipt/v1",
      reservation_id: reserved.reservation.reservation_id,
      performance_id: performance.performance_id,
      image_sha256: locked.imageSha256,
      audio_sha256: locked.audioSha256,
      image_upload_host: validateProviderDownloadUrl(imageUrl).hostname,
      audio_upload_host: validateProviderDownloadUrl(audioUrl).hostname,
      media_expiration_seconds: MEDIA_EXPIRATION_SECONDS,
      request_payload_storage: false
    }
  );

  const submitting = await persistLedgerAndRun({
    stateRoot: options.stateRoot,
    runId: options.runId,
    transform: ({ ledger, run }) => {
      const result = transitionProviderAttempt(ledger, {
        reservationId: reserved.reservation.reservation_id,
        event: "submit_started"
      });
      return { ledger: result.ledger, run, reservation: result.reservation };
    }
  });

  let requestId;
  try {
    const response = await client.queue.submit(MODEL_ID, {
      input: {
        image_url: imageUrl,
        audio_url: audioUrl,
        prompt: performance.prompt
      },
      headers: buildProviderHeaders(),
      storageSettings: lifecycle
    });
    requestId = response.request_id;
    if (typeof requestId !== "string" || requestId.length === 0) {
      throw new Error("provider returned no request identity");
    }
  } catch (error) {
    await persistLedgerAndRun({
      stateRoot: options.stateRoot,
      runId: options.runId,
      stopReason: "provider_outcome_unknown",
      transform: ({ ledger, run }) => {
        const result = transitionProviderAttempt(ledger, {
          reservationId: submitting.reservation.reservation_id,
          event: "submit_outcome_unknown"
        });
        return { ledger: result.ledger, run, reservation: result.reservation };
      }
    });
    const safe = redactProviderData(
      { message: error.message },
      { secrets: [apiKey, imageUrl, audioUrl] }
    );
    throw new Error("provider submit outcome is unknown; automatic retry prohibited: " + safe.message);
  }

  await persistLedgerAndRun({
    stateRoot: options.stateRoot,
    runId: options.runId,
    transform: ({ ledger, run }) => {
      const result = transitionProviderAttempt(ledger, {
        reservationId: submitting.reservation.reservation_id,
        event: "provider_request_received",
        providerRequestId: requestId
      });
      return { ledger: result.ledger, run, reservation: result.reservation };
    }
  });
  return finalizeProviderRequest({
    options,
    inputs,
    performance,
    locked,
    reservation: {
      ...reserved.reservation,
      state: "provider_pending",
      provider_request_id: requestId
    },
    requestId,
    client
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const inputs = await loadPlanInputs(options.stateRoot, options.runId);
  const output = options.submit
    ? await submitPerformance(options, inputs)
    : options.reconcile
      ? await reconcilePerformance(options, inputs)
      : {
        ...inputs.plan,
        run_id: options.runId,
        revision_id: inputs.pointer.revision_id,
        mode: "dry_run",
        provider_call_made: false
      };
  process.stdout.write((options.json ? JSON.stringify(output, null, 2) : JSON.stringify(output)) + "\n");
}

main().catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
