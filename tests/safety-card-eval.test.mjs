import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildReviewPacket,
  evaluateCardStatus,
  recordReceipt,
  sha256File,
  validateEvaluationSpec
} from "../scripts/lib/safety-card-eval.mjs";

async function createHarness({ clinicalReviewRequired = true, evaluationMode = "illustration_blind", baselineDecision = null } = {}) {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "safety-card-eval-"));
  const receiptsRoot = join(repositoryRoot, "receipts");
  await mkdir(join(repositoryRoot, "assets"), { recursive: true });
  await mkdir(join(repositoryRoot, "content/canonical"), { recursive: true });
  await writeFile(join(repositoryRoot, "assets/candidate.png"), "candidate-v1");
  await writeFile(join(repositoryRoot, "assets/wrapped.png"), "wrapped-v1");
  await writeFile(join(repositoryRoot, "assets/reference.png"), "reference");
  await writeFile(join(repositoryRoot, "assets/primitives.png"), "primitives");
  await writeFile(
    join(repositoryRoot, "content/canonical/test.json"),
    JSON.stringify({
      artifact: {
        id: "test-canonical",
        status: "unverified_draft",
        patient_use: false,
        missing_authorities: ["authorized clinical source"]
      },
      sources: [{ id: "test-source", title: "Test governing source" }],
      modules: [{
        id: "test-module",
        version: "1.0.0",
        status: "unverified_draft",
        content_sha256: "test-content-hash",
        visual_policy: "clinical review required",
        review: { authorized_clinician: "pending" },
        canonical_sentences: [{
          id: "claim.01",
          text: "Check the skin behind the ear.",
          source_claim_ids: ["source.claim.01"]
        }]
      }]
    })
  );

  const candidateSha256 = await sha256File(join(repositoryRoot, "assets/candidate.png"));
  const wrappedSha256 = await sha256File(join(repositoryRoot, "assets/wrapped.png"));
  const card = {
    id: "frame-test",
    evaluation_mode: evaluationMode,
    candidate_path: "assets/candidate.png",
    wrapped_path: "assets/wrapped.png",
    source_claim_ids: ["claim.01"],
    clinical_review_required: clinicalReviewRequired,
    contract: {
      anatomy: ["skin behind the ear"],
      action: ["check behind the ear"],
      state: ["tape present"],
      timing_or_comparator: ["day 2"],
      branch_logic: ["inspect after removing the dressing"],
      forbidden_inferences: ["look inside the ear canal"]
    }
  };
  if (baselineDecision) {
    card.baseline = {
      candidate_sha256: candidateSha256,
      wrapped_sha256: wrappedSha256,
      semantic_decision: baselineDecision,
      design_decision: baselineDecision,
      design_score: 4,
      blockers: ["Known baseline failure."]
    };
  }
  const spec = {
    schema_version: "safety-card-eval-spec/v1",
    evaluation_version: "1.0.0",
    canonical_source_path: "content/canonical/test.json",
    requirements: {
      blind_observations: 3,
      semantic_adjudications: 1,
      design_passes: 1,
      clinical_passes: 1
    },
    benchmarks: {
      illustration_register: "assets/reference.png",
      design_primitives: "assets/primitives.png"
    },
    cards: [card]
  };
  validateEvaluationSpec(spec);
  return { repositoryRoot, receiptsRoot, spec, card, candidateSha256, wrappedSha256 };
}

function commonReceipt(harness, overrides = {}) {
  return {
    schema_version: "safety-card-eval-receipt/v1",
    receipt_id: "receipt-1",
    card_id: harness.card.id,
    evaluation_version: harness.spec.evaluation_version,
    evaluation_mode: harness.card.evaluation_mode,
    phase: "observe",
    reviewer_id: "observer-1",
    reviewer_role: "blind_observer",
    candidate_sha256: harness.candidateSha256,
    wrapped_sha256: harness.wrappedSha256,
    created_at: "2026-08-24T05:00:00.000Z",
    ...overrides
  };
}

function observationReceipt(harness, index) {
  return commonReceipt(harness, {
    receipt_id: `observation-${index}`,
    reviewer_id: `observer-${index}`,
    observation: {
      anatomy: ["skin behind the ear"],
      actions: ["check behind the ear"],
      states: ["tape present"],
      timing_or_comparators: ["day 2"],
      branch_logic: ["inspect after removing the dressing"],
      possible_meanings: ["check for tape"],
      confusions: [],
      harmful_alternatives: []
    },
    saw_expected_contract: false,
    saw_reference: false,
    saw_prior_findings: false
  });
}

async function currentIdentity(harness) {
  return {
    candidateSha256: await sha256File(join(harness.repositoryRoot, harness.card.candidate_path)),
    wrappedSha256: await sha256File(join(harness.repositoryRoot, harness.card.wrapped_path))
  };
}

async function recordThreeObservations(harness) {
  for (let index = 1; index <= 3; index += 1) {
    await recordReceipt({
      repositoryRoot: harness.repositoryRoot,
      receiptsRoot: harness.receiptsRoot,
      spec: harness.spec,
      receipt: observationReceipt(harness, index)
    });
  }
}

test("known failing baseline hash stays repair-required until the asset revision changes", async () => {
  const harness = await createHarness({ baselineDecision: "fail" });
  const initial = await evaluateCardStatus({
    repositoryRoot: harness.repositoryRoot,
    receiptsRoot: harness.receiptsRoot,
    spec: harness.spec,
    cardId: harness.card.id
  });
  assert.equal(initial.state, "repair_required");
  assert.match(initial.next_action, /new candidate/i);

  await writeFile(join(harness.repositoryRoot, harness.card.candidate_path), "candidate-v2");
  await writeFile(join(harness.repositoryRoot, harness.card.wrapped_path), "wrapped-v2");
  const revised = await evaluateCardStatus({
    repositoryRoot: harness.repositoryRoot,
    receiptsRoot: harness.receiptsRoot,
    spec: harness.spec,
    cardId: harness.card.id
  });
  assert.equal(revised.state, "collecting_blind_observations");
  assert.equal(revised.progress.observations, 0);
});

test("a semantic baseline failure cannot be bypassed by changing only the wrapper", async () => {
  const harness = await createHarness();
  harness.card.baseline = {
    candidate_sha256: harness.candidateSha256,
    wrapped_sha256: harness.wrappedSha256,
    semantic_decision: "fail",
    design_decision: "pass",
    design_score: 6,
    blockers: ["Known semantic failure."]
  };
  await writeFile(join(harness.repositoryRoot, harness.card.wrapped_path), "wrapped-v2");
  const wrapperOnly = await evaluateCardStatus({
    repositoryRoot: harness.repositoryRoot,
    receiptsRoot: harness.receiptsRoot,
    spec: harness.spec,
    cardId: harness.card.id
  });
  assert.equal(wrapperOnly.state, "repair_required");
  assert.equal(wrapperOnly.blocking_phase, "semantic");

  await writeFile(join(harness.repositoryRoot, harness.card.candidate_path), "candidate-v2");
  const repaired = await evaluateCardStatus({
    repositoryRoot: harness.repositoryRoot,
    receiptsRoot: harness.receiptsRoot,
    spec: harness.spec,
    cardId: harness.card.id
  });
  assert.equal(repaired.state, "collecting_blind_observations");
});

test("blind observation packet does not leak the expected contract or prior findings", async () => {
  const harness = await createHarness();
  const packet = await buildReviewPacket({
    repositoryRoot: harness.repositoryRoot,
    receiptsRoot: harness.receiptsRoot,
    spec: harness.spec,
    cardId: harness.card.id,
    phase: "observe"
  });
  const serialized = JSON.stringify(packet);
  assert.equal(packet.evaluation_image_path, harness.card.candidate_path);
  assert.equal(packet.expected_contract, undefined);
  assert.equal(packet.source_claim_ids, undefined);
  assert.doesNotMatch(serialized, /look inside the ear canal/);
  assert.doesNotMatch(serialized, /Known baseline failure/);
});

test("three unique blind observations advance to semantic adjudication", async () => {
  const harness = await createHarness();
  await recordThreeObservations(harness);
  const status = await evaluateCardStatus({
    repositoryRoot: harness.repositoryRoot,
    receiptsRoot: harness.receiptsRoot,
    spec: harness.spec,
    cardId: harness.card.id
  });
  assert.equal(status.state, "semantic_adjudication");
  assert.equal(status.progress.observations, 3);

  const duplicateReviewerReceipt = observationReceipt(harness, 1);
  duplicateReviewerReceipt.receipt_id = "observation-duplicate-reviewer";
  await assert.rejects(
    recordReceipt({
      repositoryRoot: harness.repositoryRoot,
      receiptsRoot: harness.receiptsRoot,
      spec: harness.spec,
      receipt: duplicateReviewerReceipt
    }),
    /already recorded|duplicate/i
  );
});

test("changing the evaluation version invalidates receipts for unchanged asset hashes", async () => {
  const harness = await createHarness();
  await recordThreeObservations(harness);

  harness.spec.evaluation_version = "1.1.0";
  const status = await evaluateCardStatus({
    repositoryRoot: harness.repositoryRoot,
    receiptsRoot: harness.receiptsRoot,
    spec: harness.spec,
    cardId: harness.card.id
  });

  assert.equal(status.state, "collecting_blind_observations");
  assert.equal(status.progress.observations, 0);
});

test("receipts cannot be recorded out of gate order", async () => {
  const harness = await createHarness();
  await assert.rejects(
    recordReceipt({
      repositoryRoot: harness.repositoryRoot,
      receiptsRoot: harness.receiptsRoot,
      spec: harness.spec,
      receipt: commonReceipt(harness, {
        receipt_id: "design-too-early",
        phase: "design",
        reviewer_id: "designer-1",
        reviewer_role: "design_reviewer",
        decision: "pass",
        reference_compared: true,
        wrapped_render_checked: true,
        two_second_test: "pass",
        findings: [],
        exact_repairs: []
      })
    }),
    /unavailable while card state is collecting_blind_observations/i
  );
});

test("a failed adjudication permanently blocks the current hashes", async () => {
  const harness = await createHarness();
  await recordThreeObservations(harness);
  await recordReceipt({
    repositoryRoot: harness.repositoryRoot,
    receiptsRoot: harness.receiptsRoot,
    spec: harness.spec,
    receipt: commonReceipt(harness, {
      receipt_id: "adjudication-1",
      phase: "adjudicate",
      reviewer_id: "adjudicator-1",
      reviewer_role: "semantic_adjudicator",
      observation_receipt_ids: ["observation-1", "observation-2", "observation-3"],
      decision: "fail",
      checks: { anatomy: true, action: false, state: true, timing_or_comparator: true, branch_logic: true },
      harmful_alternatives: ["viewer may inspect inside the ear"],
      findings: ["The action is ambiguous."],
      exact_repairs: ["Show the check behind the ear."]
    })
  });
  const status = await evaluateCardStatus({
    repositoryRoot: harness.repositoryRoot,
    receiptsRoot: harness.receiptsRoot,
    spec: harness.spec,
    cardId: harness.card.id
  });
  assert.equal(status.state, "repair_required");
  assert.match(status.next_action, /new candidate/i);
});

test("passing semantic and design gates stops at authorized clinical review", async () => {
  const harness = await createHarness();
  await recordThreeObservations(harness);
  await recordReceipt({
    repositoryRoot: harness.repositoryRoot,
    receiptsRoot: harness.receiptsRoot,
    spec: harness.spec,
    receipt: commonReceipt(harness, {
      receipt_id: "adjudication-1",
      phase: "adjudicate",
      reviewer_id: "adjudicator-1",
      reviewer_role: "semantic_adjudicator",
      observation_receipt_ids: ["observation-1", "observation-2", "observation-3"],
      decision: "pass",
      checks: { anatomy: true, action: true, state: true, timing_or_comparator: true, branch_logic: true },
      harmful_alternatives: [],
      findings: [],
      exact_repairs: []
    })
  });
  await recordReceipt({
    repositoryRoot: harness.repositoryRoot,
    receiptsRoot: harness.receiptsRoot,
    spec: harness.spec,
    receipt: commonReceipt(harness, {
      receipt_id: "design-1",
      phase: "design",
      reviewer_id: "designer-1",
      reviewer_role: "design_reviewer",
      decision: "pass",
      reference_compared: true,
      wrapped_render_checked: true,
      two_second_test: "pass",
      findings: [],
      exact_repairs: []
    })
  });
  const status = await evaluateCardStatus({
    repositoryRoot: harness.repositoryRoot,
    receiptsRoot: harness.receiptsRoot,
    spec: harness.spec,
    cardId: harness.card.id
  });
  assert.equal(status.state, "clinical_review");
  assert.equal(status.patient_ready, false);

  const clinicalPacket = await buildReviewPacket({
    repositoryRoot: harness.repositoryRoot,
    receiptsRoot: harness.receiptsRoot,
    spec: harness.spec,
    cardId: harness.card.id,
    phase: "clinical"
  });
  assert.deepEqual(clinicalPacket.canonical_context.claims, [{
    id: "claim.01",
    text: "Check the skin behind the ear.",
    source_claim_ids: ["source.claim.01"],
    module_id: "test-module",
    module_status: "unverified_draft",
    module_review: { authorized_clinician: "pending" }
  }]);
  assert.equal(clinicalPacket.canonical_context.artifact.patient_use, false);

  await assert.rejects(
    recordReceipt({
      repositoryRoot: harness.repositoryRoot,
      receiptsRoot: harness.receiptsRoot,
      spec: harness.spec,
      receipt: commonReceipt(harness, {
        receipt_id: "clinical-1",
        phase: "clinical",
        reviewer_id: "clinician-1",
        reviewer_role: "authorized_clinical_reviewer",
        decision: "pass",
        authorized_human: false,
        source_claim_ids_reviewed: ["claim.01"],
        findings: [],
        exact_repairs: [],
        patient_ready: false
      })
    }),
    /authorized human/i
  );
});

test("authorized clinical pass reaches private approval without claiming patient readiness", async () => {
  const harness = await createHarness();
  await recordThreeObservations(harness);
  const receipts = [
    commonReceipt(harness, {
      receipt_id: "adjudication-1",
      phase: "adjudicate",
      reviewer_id: "adjudicator-1",
      reviewer_role: "semantic_adjudicator",
      observation_receipt_ids: ["observation-1", "observation-2", "observation-3"],
      decision: "pass",
      checks: { anatomy: true, action: true, state: true, timing_or_comparator: true, branch_logic: true },
      harmful_alternatives: [], findings: [], exact_repairs: []
    }),
    commonReceipt(harness, {
      receipt_id: "design-1",
      phase: "design",
      reviewer_id: "designer-1",
      reviewer_role: "design_reviewer",
      decision: "pass",
      reference_compared: true,
      wrapped_render_checked: true,
      two_second_test: "pass",
      findings: [], exact_repairs: []
    }),
    commonReceipt(harness, {
      receipt_id: "clinical-1",
      phase: "clinical",
      reviewer_id: "clinician-1",
      reviewer_role: "authorized_clinical_reviewer",
      decision: "pass",
      authorized_human: true,
      reviewer_name: "Dr Test",
      reviewer_credential: "MD",
      authorization_reference: "clinic-review-roster-1",
      source_claim_ids_reviewed: ["claim.01"],
      findings: [], exact_repairs: [],
      patient_ready: false
    })
  ];
  for (const receipt of receipts) {
    await recordReceipt({ repositoryRoot: harness.repositoryRoot, receiptsRoot: harness.receiptsRoot, spec: harness.spec, receipt });
  }
  const status = await evaluateCardStatus({
    repositoryRoot: harness.repositoryRoot,
    receiptsRoot: harness.receiptsRoot,
    spec: harness.spec,
    cardId: harness.card.id
  });
  assert.equal(status.state, "private_approved");
  assert.equal(status.patient_ready, false);
});

test("receipt IDs are immutable", async () => {
  const harness = await createHarness();
  const receipt = observationReceipt(harness, 1);
  const stored = await recordReceipt({ repositoryRoot: harness.repositoryRoot, receiptsRoot: harness.receiptsRoot, spec: harness.spec, receipt });
  assert.deepEqual(JSON.parse(await readFile(stored.path, "utf8")), receipt);

  await assert.rejects(
    recordReceipt({
      repositoryRoot: harness.repositoryRoot,
      receiptsRoot: harness.receiptsRoot,
      spec: harness.spec,
      receipt: { ...receipt, observation: { ...receipt.observation, confusions: ["changed later"] } }
    }),
    /immutable/i
  );
});
