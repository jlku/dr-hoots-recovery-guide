const EXPECTED_SCENE_ORDER = [
  "scene/activation/healing",
  "scene/activation/programming",
  "scene/activation/follow-up"
];

const EXPECTED_TREATMENTS = new Map([
  ["scene/activation/healing", { treatment: "host_led", narration: "healing", avatar: false }],
  ["scene/activation/programming", { treatment: "diagram_led", narration: "chaptered-programming", avatar: true }],
  ["scene/activation/follow-up", { treatment: "host_led", narration: "follow-up", avatar: false }]
]);

const FORBIDDEN_COPY_KEYS = new Set(["text", "copy", "caption", "narration_text", "visible_text"]);

const sameArray = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function findCharacterAsset(manifest, reference) {
  return manifest.assets.find(
    (asset) =>
      asset.id === reference.id &&
      asset.version === reference.version &&
      (asset.status === "design_gate_passed" || asset.status === "design_gate_passed_as_component")
  );
}

function containsForbiddenCopy(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsForbiddenCopy);
  return Object.entries(value).some(
    ([key, child]) => FORBIDDEN_COPY_KEYS.has(key) || containsForbiddenCopy(child)
  );
}

export function validateActivationProductionContract({
  production,
  canonical,
  sceneSource,
  programmingAdaptation,
  illustrationManifest,
  characterManifest
}) {
  const errors = [];
  const check = (condition, message) => {
    if (!condition) errors.push(message);
  };

  check(production.schema_version === "activation-production/v1", "Unsupported activation production schema");
  check(
    production.scope === "private_concept_only" &&
      production.status === "unverified_draft" &&
      production.patient_ready === false,
    "Activation production must remain private concept only and never patient-ready"
  );
  check(
    production.artifact_id === canonical.artifact.id &&
      production.artifact_version === canonical.artifact.version,
    "Production artifact identity drifted from canonical content"
  );
  check(production.module_id === "ci/activation", "Production must resolve only ci/activation");
  check(
    sameArray(production.scene_order, EXPECTED_SCENE_ORDER) &&
      sameArray(production.scenes.map((scene) => scene.scene_id), EXPECTED_SCENE_ORDER),
    "Production must preserve the exact activation scene order"
  );
  check(!containsForbiddenCopy(production.scenes), "Production scenes must not embed clinical copy");

  const canonicalModule = canonical.modules.find((module) => module.id === production.module_id);
  const canonicalSentenceIds = new Set(canonicalModule?.canonical_sentences.map((sentence) => sentence.id));
  const sourceScenes = new Map(
    sceneSource.scenes
      .filter((scene) => scene.module_id === production.module_id)
      .map((scene) => [scene.id, scene])
  );

  for (const scene of production.scenes) {
    const source = sourceScenes.get(scene.scene_id);
    const expected = EXPECTED_TREATMENTS.get(scene.scene_id);
    check(Boolean(source), `${scene.scene_id}: scene is missing from the shared scene manifest`);
    if (!source || !expected) continue;

    check(
      sameArray(scene.canonical_sentence_ids, source.sentence_ids) &&
        scene.canonical_sentence_ids.every((id) => canonicalSentenceIds.has(id)),
      `${scene.scene_id}: canonical sentence mapping drifted`
    );
    check(
      sameArray(scene.source_claim_ids, source.source_claim_ids),
      `${scene.scene_id}: source claim mapping drifted`
    );
    check(scene.narration_id === expected.narration, `${scene.scene_id}: narration track drifted`);
    check(
      scene.performance?.carries_clinical_meaning === false,
      `${scene.scene_id}: performance may not carry clinical meaning`
    );
    check(
      scene.performance?.neutral_holds_during_pauses === true &&
        typeof scene.performance?.reduced_motion_pose === "string",
      `${scene.scene_id}: neutral and reduced-motion performance states are required`
    );

    if (scene.scene_id === "scene/activation/programming") {
      check(scene.treatment === "diagram_led", "Activation programming must remain diagram-led");
      check(
        scene.show_caption_avatar === true,
        "Diagram-led programming must retain the centered caption avatar"
      );
    } else {
      check(scene.treatment === "host_led", `${scene.scene_id}: activation scene must remain host-led`);
      check(
        scene.show_caption_avatar === false,
        "Host-led scenes must suppress the duplicate caption avatar"
      );
    }
  }

  check(
    production.compact_avatar?.preserve_head_and_beak === true &&
      production.compact_avatar?.may_reduce_caption_typography === false &&
      sameArray(production.compact_avatar?.sizes_px, [64, 48]),
    "Compact avatar contract must preserve head, beak, and caption typography at 64px and 48px"
  );

  check(
    Boolean(findCharacterAsset(characterManifest, production.character.motion_base)) &&
      Boolean(findCharacterAsset(characterManifest, production.character.motion_rig)) &&
      Boolean(findCharacterAsset(characterManifest, production.character.gesture_sheet)),
    "Production must reference the approved character motion rig, base, and gesture sheet"
  );

  const programming = production.scenes.find(
    (scene) => scene.scene_id === "scene/activation/programming"
  );
  const illustration = illustrationManifest.assets.find(
    (asset) =>
      asset.scene_id === programming?.scene_id &&
      asset.file === programming?.illustration_file &&
      asset.renderable_in_private_prototype === true &&
      asset.patient_use === false
  );
  check(Boolean(illustration), "Production must reference the private programming illustration");
  if (illustration && programming) {
    check(
      sameArray(illustration.source_claim_ids, programming.source_claim_ids),
      "Private programming illustration claim mapping drifted"
    );
  }

  check(
    programmingAdaptation.scene_id === programming?.scene_id &&
      sameArray(programmingAdaptation.canonical_sentence_ids, programming?.canonical_sentence_ids) &&
      sameArray(programmingAdaptation.source_claim_ids, programming?.source_claim_ids) &&
      programmingAdaptation.patient_use === false,
    "Programming adaptation must match the private production scene"
  );

  if (errors.length) throw new Error(errors.join("\n"));

  return {
    production_id: production.production_id,
    production_version: production.production_version,
    scope: production.scope,
    scenes: production.scenes.map((scene) => structuredClone(scene))
  };
}

const COMPARISON_VARIANTS = new Set(["baseline", "mixed"]);
const GENERATED_MEDIA_STATES = new Set(["animatic", "available", "blocked", "stale"]);

function comparisonTreatment(variant, productionScene) {
  if (productionScene.treatment === "diagram_led") return "diagram_led";
  return variant === "mixed" ? "host_led" : "baseline";
}

function staticMotion(productionScene) {
  return {
    mode: "static",
    envelope: "neutral_hold",
    visibly_speaking: false,
    generated_motion: false,
    finished_motion: false,
    beak: false,
    head: false,
    wing: false,
    neutral_pose: productionScene.performance.reduced_motion_pose,
    carries_clinical_meaning: false
  };
}

function animaticMotion(productionScene, treatment) {
  const compact = treatment !== "host_led";
  return {
    mode: "deterministic_low_fidelity",
    envelope: compact ? "token_beak_restrained_head" : "token_beak_head_single_wing",
    visibly_speaking: true,
    generated_motion: false,
    finished_motion: false,
    beak: true,
    head: true,
    wing: !compact,
    neutral_pose: productionScene.performance.reduced_motion_pose,
    carries_clinical_meaning: false
  };
}

/**
 * Builds the renderer contract used by both controlled animatic cuts. The
 * caller supplies resolved copy and timing so this module cannot become a
 * second clinical-content authority.
 */
export function buildActivationComparisonModel({
  production,
  scenes,
  variant,
  media_state = "animatic",
  reduced_motion = false
}) {
  if (!COMPARISON_VARIANTS.has(variant)) {
    throw new Error(`Unknown activation comparison variant: ${variant}`);
  }
  if (!GENERATED_MEDIA_STATES.has(media_state)) {
    throw new Error(`Unknown generated media state: ${media_state}`);
  }
  if (!production || !Array.isArray(scenes)) {
    throw new Error("Activation production and resolved scene inputs are required");
  }

  const inputs = new Map(scenes.map((scene) => [scene.scene_id, scene]));
  const forceStatic = reduced_motion || media_state === "blocked" || media_state === "stale";
  const model = {
    schema_version: "activation-comparison-renderer/v1",
    production_id: production.production_id,
    production_version: production.production_version,
    variant,
    scope: "private_concept_only",
    status: "unverified_draft",
    patient_ready: false,
    generated_media_state: media_state,
    reduced_motion,
    compact_avatar: structuredClone(production.compact_avatar),
    caption_contract: {
      visible_by_default: true,
      complete_scene_copy: true,
      minimum_font_px: 18,
      may_reduce_typography_to_fit_avatar: false
    },
    layout_profiles: {
      desktop: { viewport_width_px: 1280, zoom_percent: 100, avatar_size_px: 64 },
      mobile: { viewport_width_px: 390, zoom_percent: 100, avatar_size_px: 48 },
      zoom_200: { viewport_width_px: 640, zoom_percent: 200, avatar_size_px: 48 }
    },
    scenes: production.scene_order.map((sceneId) => {
      const productionScene = production.scenes.find((scene) => scene.scene_id === sceneId);
      const input = inputs.get(sceneId);
      if (!productionScene || !input) {
        throw new Error(`${sceneId}: comparison renderer input is missing`);
      }
      if (!input.text?.trim() || !input.timing?.narration_id) {
        throw new Error(`${sceneId}: complete caption copy and timing are required`);
      }
      if (input.timing.narration_id !== productionScene.narration_id) {
        throw new Error(`${sceneId}: narration timing drifted from the production contract`);
      }

      const renderTreatment = comparisonTreatment(variant, productionScene);
      const avatarCount = renderTreatment === "host_led" ? 0 : 1;
      const stageKind = renderTreatment === "host_led"
        ? "host"
        : renderTreatment === "diagram_led" ? "diagram" : "title_card";
      return {
        scene_id: sceneId,
        label: input.label,
        source_treatment: productionScene.treatment,
        render_treatment: renderTreatment,
        stage: {
          kind: stageKind,
          host_count: renderTreatment === "host_led" ? 1 : 0,
          illustration: renderTreatment === "diagram_led" ? structuredClone(input.illustration) : null
        },
        caption: {
          speaker: "Dr. Hoots",
          text: input.text,
          avatar: {
            count: avatarCount,
            optically_face_centered: avatarCount === 1,
            desktop_size_px: avatarCount === 1 ? 64 : null,
            compact_size_px: avatarCount === 1 ? 48 : null,
            focal_anchor: avatarCount === 1
              ? structuredClone(production.compact_avatar.focal_anchor)
              : null
          }
        },
        timing: structuredClone(input.timing),
        motion: forceStatic
          ? staticMotion(productionScene)
          : animaticMotion(productionScene, renderTreatment),
        static_fallback: productionScene.static_fallback
      };
    })
  };

  validateActivationComparisonModel(model);
  return model;
}

export function validateActivationComparisonModel(model) {
  const errors = [];
  const check = (condition, message) => {
    if (!condition) errors.push(message);
  };

  check(
    model?.schema_version === "activation-comparison-renderer/v1",
    "Unsupported activation comparison renderer schema"
  );
  check(
    COMPARISON_VARIANTS.has(model?.variant),
    "Comparison variant must be baseline or mixed"
  );
  check(
    model?.scope === "private_concept_only" &&
      model?.status === "unverified_draft" &&
      model?.patient_ready === false,
    "Comparison render must remain a private unverified draft, never patient-ready"
  );
  check(
    sameArray(model?.scenes?.map((scene) => scene.scene_id), EXPECTED_SCENE_ORDER),
    "Comparison render must preserve the exact activation scene order"
  );
  check(
    model?.compact_avatar?.preserve_head_and_beak === true &&
      sameArray(model?.compact_avatar?.sizes_px, [64, 48]) &&
      model?.compact_avatar?.focal_anchor?.x === 0.5 &&
      model?.compact_avatar?.focal_anchor?.y === 0.42,
    "Comparison avatar must preserve the centered head-and-beak crop at 64px and 48px"
  );
  check(
    model?.caption_contract?.visible_by_default === true &&
      model?.caption_contract?.complete_scene_copy === true &&
      model?.caption_contract?.minimum_font_px >= 18 &&
      model?.caption_contract?.may_reduce_typography_to_fit_avatar === false,
    "Caption typography may not be reduced to fit the avatar"
  );

  for (const scene of model?.scenes ?? []) {
    check(Boolean(scene.caption?.text?.trim()), `${scene.scene_id}: complete visible caption is required`);
    check(
      scene.motion?.carries_clinical_meaning === false,
      `${scene.scene_id}: motion or gesture may not carry clinical meaning`
    );
    check(scene.motion?.finished_motion === false, `${scene.scene_id}: animatic may not claim finished motion`);
    check(Boolean(scene.static_fallback), `${scene.scene_id}: approved static fallback is required`);

    if (scene.render_treatment === "host_led") {
      check(
        scene.stage?.kind === "host" && scene.stage?.host_count === 1,
        `${scene.scene_id}: host-led treatment requires exactly one main-stage host`
      );
      check(
        scene.caption?.avatar?.count === 0,
        `${scene.scene_id}: duplicate caption avatar is forbidden in host-led treatment`
      );
    } else if (scene.render_treatment === "diagram_led") {
      check(
        scene.stage?.kind === "diagram" && scene.stage?.host_count === 0 && scene.stage?.illustration,
        `${scene.scene_id}: diagram-led treatment requires the stage illustration and no stage host`
      );
      check(
        scene.caption?.avatar?.count === 1 && scene.caption?.avatar?.optically_face_centered === true,
        `${scene.scene_id}: diagram-led caption requires one centered speaking avatar`
      );
    } else if (scene.render_treatment === "baseline") {
      check(
        scene.stage?.kind === "title_card" && scene.stage?.host_count === 0,
        `${scene.scene_id}: baseline treatment requires a title-card stage`
      );
      check(
        scene.caption?.avatar?.count === 1,
        `${scene.scene_id}: baseline caption requires one speaking avatar`
      );
    } else {
      check(false, `${scene.scene_id}: unknown render treatment`);
    }

    if (model.reduced_motion || ["blocked", "stale"].includes(model.generated_media_state)) {
      check(
        scene.motion?.mode === "static" &&
          scene.motion?.generated_motion === false &&
          scene.motion?.visibly_speaking === false,
        `${scene.scene_id}: reduced or unavailable media must use the neutral static fallback`
      );
    }
  }

  if (errors.length) throw new Error(errors.join("\n"));
  return true;
}

export { EXPECTED_SCENE_ORDER };
