import assert from "node:assert/strict";
import test from "node:test";

import {
  addArtifact,
  buildContentLock,
  createArtifactRecord,
  createProductionRun,
  invalidateForContentLock,
  recordArtifactReview,
  resolveCandidateAsset
} from "../scripts/lib/production-run.mjs";

const makeLock = (content = "canonical-v1") =>
  buildContentLock({
    inputs: [{ id: "canonical", sourcePath: "content/canonical.json", content }],
    renderConfig: { viewport: [1280, 720] },
    toolVersions: { renderer: "v1" }
  });

const makeCandidate = (lock, overrides = {}) =>
  createArtifactRecord({
    kind: "host_performance",
    outputHash: "c".repeat(64),
    contentLockId: lock.lock_id,
    directInputIds: [lock.lock_id],
    filePath: "attempts/host-approved.mp4",
    reviewState: "approved",
    provenance: {
      source: "generated",
      prompt: "Restrained speaking performance",
      model: "provider/model",
      request_id: "request-123",
      seed: 42,
      settings: { duration: 8 }
    },
    ...overrides
  });

test("resolves only an approved candidate ID bound to the current content lock", () => {
  const lock = makeLock();
  const candidate = makeCandidate(lock);
  const run = addArtifact(createProductionRun({ runId: "resolve-run", contentLock: lock }), candidate);

  assert.deepEqual(
    resolveCandidateAsset(run, {
      candidate_asset_id: candidate.candidate_asset_id,
      content_lock_id: lock.lock_id
    }),
    candidate
  );

  assert.throws(
    () => resolveCandidateAsset(run, { filename: "host-approved.mp4", content_lock_id: lock.lock_id }),
    /filename resolution is forbidden/i
  );
  assert.throws(
    () =>
      resolveCandidateAsset(run, {
        candidate_asset_id: candidate.candidate_asset_id,
        content_lock_id: "lock:wrong"
      }),
    /current content lock/i
  );
});

test("rejects unreviewed, rejected, and stale candidate dependencies", () => {
  const lock = makeLock();
  const base = createProductionRun({ runId: "reject-run", contentLock: lock });

  const unreviewed = makeCandidate(lock, {
    outputHash: "d".repeat(64),
    reviewState: "unreviewed"
  });
  const withUnreviewed = addArtifact(base, unreviewed);
  assert.throws(
    () =>
      resolveCandidateAsset(withUnreviewed, {
        candidate_asset_id: unreviewed.candidate_asset_id,
        content_lock_id: lock.lock_id
      }),
    /not review-approved/i
  );

  const rejected = makeCandidate(lock, {
    outputHash: "e".repeat(64),
    reviewState: "rejected",
    rejectionReason: "Character identity drift"
  });
  const withRejected = addArtifact(base, rejected);
  assert.throws(
    () =>
      resolveCandidateAsset(withRejected, {
        candidate_asset_id: rejected.candidate_asset_id,
        content_lock_id: lock.lock_id
      }),
    /not review-approved/i
  );

  const approved = makeCandidate(lock);
  const withApproved = addArtifact(base, approved);
  const stale = invalidateForContentLock(withApproved, makeLock("canonical-v2"));
  assert.throws(
    () =>
      resolveCandidateAsset(stale, {
        candidate_asset_id: approved.candidate_asset_id,
        content_lock_id: stale.current_content_lock_id
      }),
    /stale_nonrenderable/i
  );
});

test("re-adding identical artifact identity is idempotent without mutating the run", () => {
  const lock = makeLock();
  const candidate = makeCandidate(lock);
  const once = addArtifact(createProductionRun({ runId: "idempotent-run", contentLock: lock }), candidate);
  const twice = addArtifact(once, structuredClone(candidate));

  assert.equal(twice, once);
  assert.equal(twice.artifacts.length, 1);
});

test("an immutable unreviewed artifact becomes renderable only through a bound review event", () => {
  const lock = makeLock();
  const candidate = makeCandidate(lock, { outputHash: "f".repeat(64), reviewState: "unreviewed" });
  const recorded = addArtifact(createProductionRun({ runId: "review-event-run", contentLock: lock }), candidate);
  const approved = recordArtifactReview(recorded, {
    candidateAssetId: candidate.candidate_asset_id,
    decision: "approved",
    reviewerRole: "independent_designer",
    receiptId: "host-review:" + "1".repeat(64)
  });
  assert.equal(approved.artifacts[0].review_state, "unreviewed");
  assert.deepEqual(resolveCandidateAsset(approved, {
    candidate_asset_id: candidate.candidate_asset_id,
    content_lock_id: lock.lock_id
  }), candidate);
  assert.throws(() => recordArtifactReview(approved, {
    candidateAssetId: candidate.candidate_asset_id,
    decision: "approved",
    reviewerRole: "independent_designer",
    receiptId: "host-review:" + "2".repeat(64)
  }), /already terminal/i);
});
