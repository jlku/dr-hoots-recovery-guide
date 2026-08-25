import assert from "node:assert/strict";
import test from "node:test";

import {
  ATTEMPT_LIMIT,
  MODEL_ID,
  PROVIDER_SPEND_CAP_USD,
  authorizeSpendLedger,
  buildHostSubmissionPlan,
  buildProviderHeaders,
  calculateMaximumCostUsd,
  createSpendLedger,
  inspectDownloadedVideoBytes,
  redactProviderData,
  reserveProviderAttempt,
  submissionGateForRun,
  transitionProviderAttempt,
  validateDownloadedDuration,
  validateProviderDownloadUrl
} from "../scripts/lib/provider-boundary.mjs";

const blockedRun = {
  stage: "motion_generation",
  status: "blocked",
  reason_code: "provider_spend_authorization_required",
  resume_action: "accept_provider_spend_cap"
};

test("dry-run plan names only the two approved host performances and cannot submit while authorization is pending", () => {
  const plan = buildHostSubmissionPlan({
    run: blockedRun,
    contentLockId: "lock:" + "a".repeat(64),
    radioBundleId: "radio:" + "b".repeat(64),
    imagePath: "assets/character/dr-hoots-motion-base-v2.png",
    scenes: [
      { scene_id: "scene/activation/healing", narration_id: "healing", duration_seconds: 4.284063 },
      { scene_id: "scene/activation/programming", narration_id: "chaptered-programming", duration_seconds: 10.605688 },
      { scene_id: "scene/activation/follow-up", narration_id: "follow-up", duration_seconds: 8.280813 }
    ]
  });

  assert.equal(plan.model_id, MODEL_ID);
  assert.equal(plan.provider_call_allowed, false);
  assert.equal(plan.block_reason, "provider_spend_authorization_required");
  assert.deepEqual(
    plan.performances.map(({ performance_id }) => performance_id),
    ["host/healing", "host/follow-up"]
  );
  assert.equal(plan.performances.some(({ performance_id }) => performance_id.includes("programming")), false);
  assert.ok(plan.maximum_first_pass_cost_usd > 0);
  assert.ok(plan.maximum_first_pass_cost_usd < 1);
  assert.equal(plan.provider_spend_cap_usd, 15);
  assert.equal(plan.patient_ready, false);
});

test("retention headers opt out of request history and expire generated media", () => {
  assert.deepEqual(buildProviderHeaders(), {
    "X-Fal-Object-Lifecycle-Preference": JSON.stringify({ expiration_duration_seconds: 3600 }),
    "X-Fal-Store-IO": "0"
  });
});

test("spend ledger requires explicit acceptance, reserves before submit, and enforces cap and attempt count", () => {
  let ledger = createSpendLedger();
  assert.equal(ledger.authorized, false);
  assert.throws(
    () => reserveProviderAttempt(ledger, {
      performanceId: "host/healing",
      durationSeconds: 4.284063,
      clientIdempotencyKey: "attempt-healing-1"
    }),
    /authorization/i
  );

  ledger = authorizeSpendLedger(ledger, {
    acceptedCapUsd: 15,
    acceptanceEvidence: "operator-explicit-acceptance"
  });
  let reservation;
  ({ ledger, reservation } = reserveProviderAttempt(ledger, {
    performanceId: "host/healing",
    durationSeconds: 4.284063,
    clientIdempotencyKey: "attempt-healing-1"
  }));
  assert.equal(reservation.state, "reserved");
  assert.equal(ledger.held_reservations.length, 1);
  assert.equal(reservation.maximum_cost_usd, calculateMaximumCostUsd(4.284063));

  let current = ledger;
  for (let attempt = 2; attempt <= ATTEMPT_LIMIT; attempt += 1) {
    ({ ledger: current } = reserveProviderAttempt(current, {
      performanceId: "host/healing",
      durationSeconds: 4.284063,
      clientIdempotencyKey: "attempt-healing-" + attempt
    }));
  }
  assert.throws(
    () => reserveProviderAttempt(current, {
      performanceId: "host/healing",
      durationSeconds: 4.284063,
      clientIdempotencyKey: "attempt-healing-4"
    }),
    /attempt limit/i
  );

  const tooSmall = authorizeSpendLedger(createSpendLedger(), {
    acceptedCapUsd: 0.01,
    acceptanceEvidence: "fixture"
  });
  assert.throws(
    () => reserveProviderAttempt(tooSmall, {
      performanceId: "host/follow-up",
      durationSeconds: 8.280813,
      clientIdempotencyKey: "attempt-follow-up-1"
    }),
    /spend cap/i
  );
});

test("attempt transitions are monotonic and unknown outcomes retain their reservation", () => {
  let ledger = authorizeSpendLedger(createSpendLedger(), {
    acceptedCapUsd: PROVIDER_SPEND_CAP_USD,
    acceptanceEvidence: "fixture"
  });
  let reservation;
  ({ ledger, reservation } = reserveProviderAttempt(ledger, {
    performanceId: "host/healing",
    durationSeconds: 4.284063,
    clientIdempotencyKey: "attempt-healing-unknown"
  }));
  ({ ledger, reservation } = transitionProviderAttempt(ledger, {
    reservationId: reservation.reservation_id,
    event: "submit_started"
  }));
  ({ ledger, reservation } = transitionProviderAttempt(ledger, {
    reservationId: reservation.reservation_id,
    event: "submit_outcome_unknown"
  }));
  assert.equal(reservation.state, "unknown_unreconcilable");
  assert.equal(ledger.held_reservations.length, 1);
  assert.throws(
    () => transitionProviderAttempt(ledger, {
      reservationId: reservation.reservation_id,
      event: "submit_started"
    }),
    /terminal|transition/i
  );
});

test("known provider success commits cost without double-counting the held review reservation", () => {
  let ledger = authorizeSpendLedger(createSpendLedger({ configuredCapUsd: 0.72 }), {
    acceptedCapUsd: 0.72,
    acceptanceEvidence: "fixture"
  });
  let reservation;
  ({ ledger, reservation } = reserveProviderAttempt(ledger, {
    performanceId: "host/healing",
    durationSeconds: 4.284063,
    clientIdempotencyKey: "attempt-known-success"
  }));
  ({ ledger, reservation } = transitionProviderAttempt(ledger, {
    reservationId: reservation.reservation_id,
    event: "submit_started"
  }));
  ({ ledger, reservation } = transitionProviderAttempt(ledger, {
    reservationId: reservation.reservation_id,
    event: "provider_request_received",
    providerRequestId: "request-known-success"
  }));
  ({ ledger, reservation } = transitionProviderAttempt(ledger, {
    reservationId: reservation.reservation_id,
    event: "provider_succeeded",
    actualCostUsd: reservation.maximum_cost_usd
  }));
  assert.equal(ledger.committed_spend_usd, 0.25);
  assert.equal(ledger.held_reservations.length, 1);
  assert.doesNotThrow(() => reserveProviderAttempt(ledger, {
    performanceId: "host/follow-up",
    durationSeconds: 8.280813,
    clientIdempotencyKey: "attempt-follow-up-after-success"
  }));
});

test("download boundary rejects unsafe URLs and validates MP4 magic, type, size, and one-frame duration tolerance", () => {
  assert.equal(
    validateProviderDownloadUrl("https://v3.fal.media/files/example/output.mp4").hostname,
    "v3.fal.media"
  );
  for (const url of [
    "http://v3.fal.media/files/x.mp4",
    "https://127.0.0.1/x.mp4",
    "https://169.254.169.254/latest/meta-data",
    "https://fal.media.evil.example/x.mp4",
    "file:///tmp/x.mp4"
  ]) {
    assert.throws(() => validateProviderDownloadUrl(url), /https|host|url/i);
  }

  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(32)]);
  assert.equal(
    inspectDownloadedVideoBytes({
      bytes: mp4,
      contentType: "video/mp4",
      contentLength: mp4.byteLength
    }).container,
    "mp4"
  );
  assert.throws(
    () => inspectDownloadedVideoBytes({
      bytes: Buffer.from("not a video"),
      contentType: "video/mp4",
      contentLength: 11
    }),
    /magic/i
  );
  assert.throws(
    () => inspectDownloadedVideoBytes({
      bytes: mp4,
      contentType: "text/html",
      contentLength: mp4.byteLength
    }),
    /content type/i
  );

  assert.equal(validateDownloadedDuration({
    expectedSeconds: 4.284063,
    actualSeconds: 4.284063 + (1 / 30),
    framesPerSecond: 30
  }).within_tolerance, true);
  assert.throws(
    () => validateDownloadedDuration({
      expectedSeconds: 4.284063,
      actualSeconds: 4.5,
      framesPerSecond: 30
    }),
    /duration drift/i
  );
});

test("provider logs redact credentials and signed URL query strings", () => {
  const secret = "fixture-super-secret-key";
  const value = {
    authorization: "Key " + secret,
    output: "https://v3.fal.media/files/output.mp4?token=signed-secret&expires=999",
    nested: [secret, "safe"]
  };
  const serialized = JSON.stringify(redactProviderData(value, { secrets: [secret] }));
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("signed-secret"), false);
  assert.match(serialized, /REDACTED/);
  assert.equal(serialized.includes("https://v3.fal.media/files/output.mp4"), true);
});

test("submission gate accepts only the exact post-authorization run state", () => {
  assert.deepEqual(submissionGateForRun(blockedRun), {
    allowed: false,
    reason_code: "provider_spend_authorization_required"
  });
  assert.deepEqual(submissionGateForRun({
    stage: "motion_generation",
    status: "partial",
    reason_code: "host_performances_required",
    resume_action: "generate_next_host_performance"
  }), { allowed: true, reason_code: null });
  assert.equal(submissionGateForRun({
    stage: "animatic_review",
    status: "pending_review",
    reason_code: "animatic_review_required"
  }).allowed, false);
});
