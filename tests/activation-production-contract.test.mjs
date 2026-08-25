import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { validateActivationProductionContract } from "../scripts/lib/activation-production.mjs";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const clone = (value) => structuredClone(value);

const fixtures = await Promise.all([
  readJson("../content/productions/ci-activation-v0.1.0.json"),
  readJson("../content/canonical/ci-phase0-v0.1.0.json"),
  readJson("../content/scenes/ci-phase0-v0.1.0.scenes.json"),
  readJson("../content/adaptations/activation-programming-v0.1.0.json"),
  readJson("../assets/illustrations/manifest.json"),
  readJson("../assets/character/manifest.json")
]);

const validate = (production = fixtures[0]) =>
  validateActivationProductionContract({
    production,
    canonical: fixtures[1],
    sceneSource: fixtures[2],
    programmingAdaptation: fixtures[3],
    illustrationManifest: fixtures[4],
    characterManifest: fixtures[5]
  });

test("resolves the activation production treatments in canonical scene order", () => {
  const result = validate();
  assert.deepEqual(
    result.scenes.map(({ scene_id, treatment, show_caption_avatar }) => ({
      scene_id,
      treatment,
      show_caption_avatar
    })),
    [
      {
        scene_id: "scene/activation/healing",
        treatment: "host_led",
        show_caption_avatar: false
      },
      {
        scene_id: "scene/activation/programming",
        treatment: "diagram_led",
        show_caption_avatar: true
      },
      {
        scene_id: "scene/activation/follow-up",
        treatment: "host_led",
        show_caption_avatar: false
      }
    ]
  );
});

test("rejects production copy and unsupported source identifiers", () => {
  const withCopy = clone(fixtures[0]);
  withCopy.scenes[0].text = "A new clinical proposition.";
  assert.throws(() => validate(withCopy), /must not embed clinical copy/i);

  const unknownScene = clone(fixtures[0]);
  unknownScene.scenes[0].scene_id = "scene/activation/unknown";
  assert.throws(() => validate(unknownScene), /exact activation scene order/i);
});

test("rejects treatment, avatar, and patient-readiness drift", () => {
  const wrongTreatment = clone(fixtures[0]);
  wrongTreatment.scenes[1].treatment = "host_led";
  assert.throws(() => validate(wrongTreatment), /programming must remain diagram-led/i);

  const duplicateHost = clone(fixtures[0]);
  duplicateHost.scenes[0].show_caption_avatar = true;
  assert.throws(() => validate(duplicateHost), /host-led scenes must suppress/i);

  const patientReady = clone(fixtures[0]);
  patientReady.patient_ready = true;
  assert.throws(() => validate(patientReady), /private concept only/i);
});

test("requires approved character references and the private programming illustration", () => {
  const missingRig = clone(fixtures[0]);
  missingRig.character.motion_rig.version = 999;
  assert.throws(() => validate(missingRig), /approved character motion rig/i);

  const missingIllustration = clone(fixtures[0]);
  missingIllustration.scenes[1].illustration_file = "missing.png";
  assert.throws(() => validate(missingIllustration), /private programming illustration/i);
});
