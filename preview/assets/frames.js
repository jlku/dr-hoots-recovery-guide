// The fourteen safety-card frames — one definition drives both animatics.
// Each frame: card furniture (number, chip), a placeholder pictogram built from
// design-system primitives, the canonical sentence ids it carries, its video
// treatment under the standing Dr. Hoots rules, and the production spec
// (illustration needed, on-frame text, motion) the finished card will require.

export const FRAMES = [
  {
    id: "wound-dressing", number: 1, part: 1,
    panel: "frame-01-art-grounded-v2.png",
    illustrationAlt: "Day 2: take the head bandage off, then check behind the ear for tape. A magnified inset marks the tape strip behind the ear.",
    title: "Bandage off, then check for tape",
    chip: "Day 2",
    panelCaptions: [
      { text: "Remove the head dressing" },
      { text: "Then check behind the ear" }
    ],
    sentenceIds: ["wc.01", "wc.02"],
    track: "wound-dressing",
    treatment: "diagram_led",
    canvas: `
      <div class="sc-row">
        <div class="sc-col"><span class="p-obj"></span><p class="sc-lbl">Bandage on</p></div>
        <span class="p-arrow"></span>
        <div class="sc-col"><span class="p-obj p-obj--stock"></span><p class="sc-lbl">Bandage off</p></div>
      </div>
      <div class="sc-row">
        <span class="p-inset"><span class="p-inset__main"></span><span class="p-inset__detail">Tape?</span></span>
        <p class="sc-lbl">Check behind the ear</p>
      </div>`,
    illustrationNeed: "Two-beat frame: hands removing the mastoid dressing; detail inset behind the ear showing tape present vs absent. Consistent figure from the card system.",
    onFrameText: ["01", "DAY 2", "Bandage on / off", "Tape?"],
    scrollMotion: "Arrow draws left to right; tape inset pops after the removal beat.",
    videoMotion: "Same two beats timed to the narration; inset appears on “check whether tape.”"
  },
  {
    id: "wound-tape", number: 2, part: 1,
    title: "If there is tape: keep it dry",
    chip: "Keep dry · 3 days",
    sentenceIds: ["wc.03", "wc.04"],
    track: "wound-tape",
    treatment: "diagram_led",
    canvas: `
      <div class="sc-split">
        <div class="sc-split__path">
          <span class="p-tape"></span>
          <p class="sc-lbl sc-lbl--big">Tape present</p>
          <div class="sc-row"><span class="p-no"></span><p class="sc-lbl">No cleaning<br>before day 3</p></div>
        </div>
        <div class="sc-split__path is-ghost">
          <span class="p-obj p-obj--stock"></span>
          <p class="sc-lbl">No tape<br>(next frame)</p>
        </div>
      </div>`,
    illustrationNeed: "Taped incision area kept dry; prohibition mark over cleaning supplies. Right half ghosts the alternate path so the branch stays visible.",
    onFrameText: ["02", "KEEP DRY · 3 DAYS", "Tape present", "No cleaning before day 3"],
    scrollMotion: "Tape path brightens while the no-tape path ghosts; prohibition mark draws last.",
    videoMotion: "Prohibition draws on “Do not clean.”"
  },
  {
    id: "wound-no-tape", number: 3, part: 1,
    title: "If there is no tape: clean twice a day",
    chip: "2× a day",
    sentenceIds: ["wc.05", "wc.06", "wc.07"],
    track: "wound-no-tape",
    treatment: "diagram_led",
    canvas: `
      <div class="sc-row">
        <div class="sc-col"><span class="p-step">1</span><span class="p-obj"></span><p class="sc-lbl">Clean gently<br>2× a day</p></div>
        <span class="p-arrow"></span>
        <div class="sc-col"><span class="p-step">2</span><span class="p-obj"></span><p class="sc-lbl">50 / 50 peroxide<br>+ distilled water</p></div>
        <span class="p-arrow"></span>
        <div class="sc-col"><span class="p-step">3</span><span class="p-obj"></span><p class="sc-lbl">Antibiotic<br>ointment</p></div>
      </div>`,
    illustrationNeed: "Three numbered sub-steps: gentle edge cleaning, the 50/50 mixing cup, ointment application. Technique depiction requires surgeon review before drawing.",
    onFrameText: ["03", "2× A DAY", "1 · 2 · 3", "50/50 mix", "ointment"],
    scrollMotion: "Steps 1→2→3 rise in order with their arrows.",
    videoMotion: "Each step lands on its sentence in the narration."
  },
  {
    id: "wound-shower", number: 4, part: 1,
    title: "Showering again",
    chip: "Day 3",
    sentenceIds: ["wc.08"],
    track: "wound-shower",
    treatment: "diagram_led",
    canvas: `
      <div class="sc-row">
        <div class="sc-col"><span class="p-drops"><i></i><i></i><i></i></span><span class="p-obj"></span><p class="sc-lbl sc-lbl--big">Shower and hair washing return</p></div>
      </div>`,
    illustrationNeed: "Figure showering with water over hair; calm, non-clinical, no incision detail.",
    onFrameText: ["04", "DAY 3", "Shower + hair"],
    scrollMotion: "Water strokes drop in after the figure.",
    videoMotion: "Single reveal; holds for the short narration."
  },
  {
    id: "wound-follow-up", number: 5, part: 1,
    title: "Your wound check",
    chip: "About 2 weeks",
    sentenceIds: ["wc.09", "wc.10"],
    track: "wound-follow-up",
    treatment: "diagram_led",
    canvas: `
      <div class="sc-row">
        <div class="sc-col"><span class="p-cal"><i></i><i></i><i></i><i class="is-mark"></i></span><p class="sc-lbl">Wound check<br>+ ear exam</p></div>
        <span class="p-arrow"></span>
        <div class="sc-col"><span class="p-inset"><span class="p-inset__main"></span><span class="p-inset__detail">Stitches</span></span><p class="sc-lbl">Dissolve on their own</p></div>
      </div>`,
    illustrationNeed: "Calendar marking the ~2-week visit; inset of dissolvable stitches (no removal tools).",
    onFrameText: ["05", "ABOUT 2 WEEKS", "Wound check + ear exam", "Stitches dissolve"],
    scrollMotion: "Calendar marks itself, then the stitches inset pops.",
    videoMotion: "Inset lands on “the stitches dissolve.”"
  },
  {
    id: "call-redness", number: 6, part: 2,
    illustrationAlt: "Call your surgeon or clinic if all three signs are present together: the incision area is red and swollen, it is not getting better over one to two days, and it hurts when touched.",
    title: "Redness with all three signs",
    chip: "All 3 together",
    textCard: {
      layout: "checklist",
      lead: "Call only when all three are present",
      items: [
        { marker: "1", title: "Red and swollen" },
        { marker: "2", title: "Not improving", detail: "Over the next 1–2 days" },
        { marker: "3", title: "Hurts when touched" }
      ],
      footer: "All three → call your surgeon or clinic"
    },
    sentenceIds: ["call.01", "call.01a", "call.01b", "call.01c"],
    track: "call-redness",
    treatment: "diagram_led",
    canvas: `
      <ul class="sc-checks">
        <li><i></i>Red and swollen</li>
        <li><i></i>Not better in 1–2 days</li>
        <li><i></i>Hurts when touched</li>
      </ul>`,
    illustrationNeed: "Behind-ear inset with the three sign checkboxes; equal visual weight, no severity grading.",
    onFrameText: ["06", "ALL 3 TOGETHER", "Red and swollen", "Not better in 1–2 days", "Hurts when touched"],
    scrollMotion: "The three checks tick in sequence.",
    videoMotion: "Each check ticks on its sentence."
  },
  {
    id: "call-fever", number: 7, part: 2,
    title: "Fever",
    chip: "Above",
    sentenceIds: ["call.02"],
    track: "call-fever",
    treatment: "diagram_led",
    canvas: `
      <div class="sc-row">
        <span class="p-therm"></span>
        <div class="sc-col"><p class="p-fig">101.5<small>°F</small></p><p class="sc-lbl">Call above this</p></div>
      </div>`,
    illustrationNeed: "Thermometer with the 101.5°F threshold line; comparator “above” preserved exactly.",
    onFrameText: ["07", "ABOVE", "101.5°F"],
    scrollMotion: "Threshold line draws, figure rises.",
    videoMotion: "Figure lands on “101.5 degrees.”"
  },
  {
    id: "call-fluid", number: 8, part: 2,
    title: "Swelling or fluid behind the ear",
    chip: "Behind the ear",
    sentenceIds: ["call.03"],
    track: "call-fluid",
    treatment: "diagram_led",
    canvas: `
      <div class="sc-row">
        <span class="p-inset"><span class="p-inset__main"></span><span class="p-inset__detail">Fluid</span></span>
        <p class="sc-lbl sc-lbl--big">Swollen skin, or fluid<br>building up under it</p>
      </div>`,
    illustrationNeed: "Behind-ear detail inset showing swelling / fluid collection area, drawn without alarm.",
    onFrameText: ["08", "BEHIND THE EAR", "Fluid"],
    scrollMotion: "Inset pops from the main frame.",
    videoMotion: "Single reveal timed to the sentence."
  },
  {
    id: "call-neuro", number: 9, part: 2,
    title: "Other warning signs",
    chip: "Any of these",
    sentenceIds: ["call.04"],
    track: "call-neuro",
    treatment: "diagram_led",
    canvas: `
      <div class="sc-row">
        <div class="sc-col"><span class="p-obj"></span><p class="sc-lbl">Headache</p></div>
        <div class="sc-col"><span class="p-obj"></span><p class="sc-lbl">Light<br>sensitivity</p></div>
        <div class="sc-col"><span class="p-obj"></span><p class="sc-lbl">Excessive<br>lethargy</p></div>
      </div>`,
    illustrationNeed: "Three equal glyphs: headache, light sensitivity, excessive lethargy. Same weight — no tiering.",
    onFrameText: ["09", "ANY OF THESE", "Headache", "Light sensitivity", "Excessive lethargy"],
    scrollMotion: "Three glyphs rise together.",
    videoMotion: "Glyphs land as each word is spoken."
  },
  {
    id: "call-concerns", number: 10, part: 2,
    title: "Questions or concerns",
    chip: "Just call",
    sentenceIds: ["call.05"],
    track: "call-concerns",
    treatment: "diagram_led",
    canvas: `
      <div class="sc-row">
        <span class="p-phone"></span>
        <p class="sc-lbl sc-lbl--big">Any wound-care question<br>or medical concern</p>
      </div>`,
    illustrationNeed: "Phone glyph with a neutral question motif; applies to you or your child.",
    onFrameText: ["10", "JUST CALL"],
    scrollMotion: "Phone rises, label follows.",
    videoMotion: "Single reveal."
  },
  {
    id: "call-contact", number: 11, part: 2,
    art: "frame-11-numbers.svg",
    illustrationAlt: "Two phone routes: routine questions to the nursing line at 415-353-2148 with a callback within 12 hours, and emergencies to 415-476-1000 asking for the Otolaryngology resident on call.",
    title: "The numbers to use",
    chip: "Save these",
    sentenceIds: ["call.06", "call.07", "call.07a", "call.08"],
    track: "call-contact",
    treatment: "diagram_led",
    canvas: `
      <div class="sc-routes">
        <div class="sc-route"><p class="sc-lbl">Routine questions</p><p class="num">415-353-2148</p><p class="fine">Nursing line · callback within 12 hours · call again if none</p></div>
        <div class="sc-route sc-route--er"><p class="sc-lbl">Emergency</p><p class="num">415-476-1000</p><p class="fine">Ask for the Otolaryngology resident on call</p></div>
      </div>`,
    illustrationNeed: "Two route panels exactly as the source separates them; numbers set large and tappable in interactive formats.",
    onFrameText: ["11", "SAVE THESE", "415-353-2148", "415-476-1000", "12 hours"],
    scrollMotion: "Routine route lands first, emergency second.",
    videoMotion: "Routes land with their sentences; both hold to the end of the scene."
  },
  {
    id: "act-healing", number: 12, part: 3,
    title: "After healing, you return",
    chip: "After healing",
    sentenceIds: ["act.01"],
    track: "healing",
    treatment: "host_led",
    canvas: `
      <div class="sc-row">
        <div class="sc-col"><span class="p-obj p-obj--stock"></span><p class="sc-lbl">Surgery site<br>healed</p></div>
        <span class="p-arrow"></span>
        <div class="sc-col"><span class="p-cal"><i></i><i></i><i></i><i class="is-mark"></i></span><p class="sc-lbl">First programming<br>visit</p></div>
      </div>`,
    illustrationNeed: "Video: host-led — approved speaking Dr. Hoots clip carries this beat (no diagram). Scroll: this timeline frame.",
    onFrameText: ["12", "AFTER HEALING", "First programming visit"],
    scrollMotion: "Arrow draws from healed site to the visit calendar.",
    videoMotion: "HOST-LED: main-stage Dr. Hoots speaks (approved clip); no caption avatar; wing welcome on “you return.”"
  },
  {
    id: "act-programming", number: 13, part: 3,
    title: "Your first programming visit",
    chip: "The audiologist",
    sentenceIds: ["act.02", "act.03"],
    track: "chaptered-programming",
    treatment: "diagram_led",
    illustration: "../assets/illustrations/ci-activation-programming-safety-card-v1.png",
    illustrationAlt: "An audiologist sits with a patient and adjusts an outside-ear speech processor using a computer.",
    canvas: "",
    illustrationNeed: "APPROVED (unreviewed concept art): the existing programming illustration owns the frame.",
    onFrameText: ["13", "THE AUDIOLOGIST"],
    scrollMotion: "Illustration settles from a slight scale; nothing else moves.",
    videoMotion: "Diagram-led: illustration owns the stage; Dr. Hoots speaks from the caption avatar."
  },
  {
    id: "act-follow-up", number: 14, part: 3,
    title: "Visits that continue",
    chip: "Ongoing",
    sentenceIds: ["act.04", "act.05"],
    track: "follow-up",
    treatment: "host_led",
    canvas: `
      <div class="sc-row">
        <div class="sc-col"><span class="p-cal"><i class="is-mark"></i><i class="is-mark"></i><i class="is-mark"></i><i></i></span><p class="sc-lbl">Checks +<br>measurements</p></div>
        <div class="sc-col"><span class="p-loop"></span><p class="sc-lbl">Fine-tuning<br>continues</p></div>
      </div>`,
    illustrationNeed: "Video: host-led — approved speaking clip. Scroll: repeat-visit calendar with the tuning loop.",
    onFrameText: ["14", "ONGOING", "Checks + measurements", "Fine-tuning"],
    scrollMotion: "Calendar marks fill, loop draws.",
    videoMotion: "HOST-LED: main-stage Dr. Hoots speaks (approved clip); wing invitation on “keep returning.”"
  }
];

// ---- v1.1 video-only composite frames (approved consolidation, 2026-08-23).
// The 14-frame card is unchanged for the scroll guide; these composites exist so
// consolidated video scenes keep one frame on stage. numLabel shows the frame
// range they cover; videoOnly keeps them out of the scroll build.
export const VIDEO_FRAMES = [
  {
    id: "wound-paths-combo", numLabel: "02–03", part: 1, videoOnly: true,
    illustrationAlt: "Two care paths behind the ear: tape present stays dry with no cleaning; no tape gets gentle cleaning twice a day with the 50/50 mix, then ointment.",
    title: "The two paths",
    chip: "Follow only yours",
    textCard: {
      layout: "columns",
      lead: "First check whether tape covers the incision behind your ear",
      items: [
        {
          title: "Tape present",
          accent: "teal",
          lines: ["Keep the area dry until day 3", "Do not clean the incision before then"]
        },
        {
          title: "No tape",
          accent: "yellow",
          lines: ["Clean the incision edges gently twice a day", "Use equal parts peroxide and distilled water", "Then apply antibiotic ointment"]
        }
      ],
      footer: "Follow only the path that matches what you see"
    },
    sentenceIds: ["wc.03", "wc.04", "wc.05", "wc.06", "wc.07"],
    track: "wound-paths",
    treatment: "diagram_led",
    canvas: `
      <div class="sc-split">
        <div class="sc-split__path">
          <span class="p-tape"></span>
          <p class="sc-lbl sc-lbl--big">Tape present</p>
          <div class="sc-split__fig"><p class="sc-lbl">Keep dry</p><p class="fig">3 days</p></div>
          <div class="sc-row"><span class="p-no"></span><p class="sc-lbl">No cleaning<br>before day 3</p></div>
        </div>
        <div class="sc-split__path">
          <span class="p-obj p-obj--stock"></span>
          <p class="sc-lbl sc-lbl--big">No tape</p>
          <div class="sc-badges-row"><span class="p-step">1</span><span class="p-step">2</span><span class="p-step">3</span></div>
          <div class="sc-split__fig"><p class="sc-lbl">Clean gently · 50/50 mix · ointment</p><p class="fig">2× a day</p></div>
        </div>
      </div>`,
    illustrationNeed: "One split frame, both paths at full strength: taped incision kept dry with the cleaning prohibition; no-tape side with the three numbered cleaning sub-steps. The active half follows the narration.",
    onFrameText: ["02–03", "FOLLOW ONLY YOURS", "Tape present · Keep dry · 3 days · No cleaning before day 3", "No tape · 1 2 3 · 2× a day · 50/50 mix · ointment"],
    scrollMotion: "— (scroll keeps frames 02 and 03 separate)",
    videoMotion: "Tape half emphasizes during its sentences, then the no-tape half; prohibition draws on “do not clean.”"
  },
  {
    id: "wound-milestones", numLabel: "04–05", part: 1, videoOnly: true,
    illustrationAlt: "Showering returns on day 3; the wound check and ear exam happen about two weeks after surgery, and the stitches dissolve on their own.",
    title: "The next milestones",
    chip: "Day 3 · ≈ 2 weeks",
    textCard: {
      layout: "timeline",
      items: [
        { marker: "Day 3", title: "Shower and wash your hair" },
        { marker: "About 2 weeks", title: "Wound check and ear exam" },
        { marker: "Stitches", title: "They dissolve on their own", detail: "They do not need to be removed" }
      ]
    },
    sentenceIds: ["wc.08", "wc.09", "wc.10"],
    track: "wound-milestones",
    treatment: "diagram_led",
    canvas: `
      <div class="sc-row">
        <div class="sc-col"><span class="p-drops"><i></i><i></i><i></i></span><span class="p-obj"></span><p class="sc-lbl">Day 3<br>Shower + hair</p></div>
        <span class="p-arrow"></span>
        <div class="sc-col"><span class="p-cal"><i></i><i></i><i></i><i class="is-mark"></i></span><p class="sc-lbl">About 2 weeks<br>Wound check + ear exam</p></div>
      </div>
      <div class="sc-row">
        <span class="p-inset"><span class="p-inset__main"></span><span class="p-inset__detail">Stitches</span></span>
        <p class="sc-lbl">Dissolve on their own</p>
      </div>`,
    illustrationNeed: "Recovery track with two stops: showering at day 3, the ~2-week wound check; inset of dissolvable stitches (no removal tools).",
    onFrameText: ["04–05", "DAY 3 · ≈ 2 WEEKS", "Shower + hair", "Wound check + ear exam", "Stitches dissolve"],
    scrollMotion: "— (scroll keeps frames 04 and 05 separate)",
    videoMotion: "Marker advances day 3 → two weeks with the narration; stitches inset lands on “dissolve on their own.”"
  },
  {
    id: "call-any-list", numLabel: "07–10", part: 2, videoOnly: true,
    illustrationAlt: "Four independent reasons to call: fever above 101.5 degrees Fahrenheit, swelling or fluid behind the ear, headache or light sensitivity or excessive lethargy, or any question or concern.",
    title: "Also call for any of these",
    chip: "Any of these",
    textCard: {
      layout: "list",
      lead: "Any one of these is a reason to call",
      items: [
        { marker: "1", title: "Fever above 101.5°F" },
        { marker: "2", title: "Swelling or fluid building up under the skin behind the ear" },
        { marker: "3", title: "Headache, light sensitivity, or excessive lethargy" },
        { marker: "4", title: "Any wound-care question or medical concern" }
      ],
      footer: "Any one → call your surgeon or clinic"
    },
    sentenceIds: ["call.02", "call.03", "call.04", "call.05"],
    track: "call-any",
    treatment: "diagram_led",
    canvas: `
      <ul class="sc-checks">
        <li><i></i>Fever above 101.5°F</li>
        <li><i></i>Swelling or fluid behind the ear</li>
        <li><i></i>Headache · light sensitivity · lethargy</li>
        <li><i></i>Any question or concern</li>
      </ul>`,
    illustrationNeed: "Four equal rows, no urgency tiers: fever with the 101.5°F threshold, behind-ear swelling/fluid, the three neurological signs, and the open question row.",
    onFrameText: ["07–10", "ANY OF THESE", "Fever above 101.5°F", "Swelling or fluid behind the ear", "Headache · light sensitivity · lethargy", "Any question or concern"],
    scrollMotion: "— (scroll keeps frames 07–10 separate)",
    videoMotion: "Each row lands as its item is narrated; all four hold to the end of the scene."
  }
];

VIDEO_FRAMES.push({
  id: "recap-card", numLabel: "1–3", part: 3, videoOnly: true,
  art: "frame-recap.svg",
  illustrationAlt: "The full guide: care for the surgery site, when to call, and first programming visits. Replay any part.",
  title: "The full guide",
  chip: "Replay any part",
  sentenceIds: [],
  track: "outro-v2",
  treatment: "diagram_led",
  canvas: "",
  illustrationNeed: "Typographic recap card (final).",
  onFrameText: ["1–3", "THE FULL GUIDE", "REPLAY ANY PART"],
  scrollMotion: "—",
  videoMotion: "Static recap while the closing line plays."
});

export const ALL_FRAMES = [...FRAMES, ...VIDEO_FRAMES];
export const frameById = (id) => ALL_FRAMES.find((frame) => frame.id === id);


const G = {
  tape: `<svg class="tape-overlay" viewBox="0 0 60 90" xmlns="http://www.w3.org/2000/svg"><g transform="rotate(8 30 45)"><rect x="14" y="6" width="30" height="76" rx="4" fill="#ffffff" stroke="#052049" stroke-width="5"/><line x1="14" y1="30" x2="44" y2="30" stroke="#052049" stroke-width="3.5"/><line x1="14" y1="54" x2="44" y2="54" stroke="#052049" stroke-width="3.5"/></g></svg>`,
  swab: `<svg viewBox="0 0 22 84" xmlns="http://www.w3.org/2000/svg"><rect x="9" y="12" width="4" height="62" fill="#ffffff" stroke="#052049" stroke-width="3"/><ellipse cx="11" cy="10" rx="8" ry="9" fill="#ffffff" stroke="#052049" stroke-width="4"/><ellipse cx="11" cy="76" rx="7" ry="7" fill="#ffffff" stroke="#052049" stroke-width="4"/></svg>`,
  bottleDark: `<svg viewBox="0 0 44 84" xmlns="http://www.w3.org/2000/svg"><rect x="16" y="4" width="12" height="12" fill="#052049"/><rect x="12" y="14" width="20" height="10" fill="#052049"/><rect x="6" y="24" width="32" height="56" rx="4" fill="#052049"/><rect x="12" y="40" width="20" height="26" fill="#ffffff"/></svg>`,
  bottleLight: `<svg viewBox="0 0 44 84" xmlns="http://www.w3.org/2000/svg"><rect x="16" y="4" width="12" height="12" fill="#052049"/><rect x="12" y="14" width="20" height="10" fill="#052049"/><rect x="6" y="24" width="32" height="56" rx="4" fill="#ddecf0" stroke="#052049" stroke-width="4"/><rect x="12" y="40" width="20" height="26" fill="#ffffff" stroke="#052049" stroke-width="3"/></svg>`,
  tube: `<svg viewBox="0 0 40 84" xmlns="http://www.w3.org/2000/svg"><rect x="12" y="4" width="16" height="10" fill="#ddecf0" stroke="#052049" stroke-width="4"/><path d="M8 20 L32 20 L36 74 Q36 80 30 80 L10 80 Q4 80 4 74 Z" fill="#ffffff" stroke="#052049" stroke-width="4"/></svg>`,
  drops: `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg"><path d="M18 8 Q28 24 18 34 Q8 24 18 8Z" fill="#ddecf0" stroke="#052049" stroke-width="4"/><path d="M42 22 Q52 38 42 48 Q32 38 42 22Z" fill="#ddecf0" stroke="#052049" stroke-width="4"/></svg>`,
  noRing: `<svg class="no-ring" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="44" fill="none" stroke="#e61048" stroke-width="10"/><line x1="20" y1="80" x2="80" y2="20" stroke="#e61048" stroke-width="10"/></svg>`,
  knot: `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg"><path d="M22 30 C34 16 52 18 58 30 C64 42 50 50 40 44 C30 38 34 26 46 26" fill="none" stroke="#052049" stroke-width="5" stroke-linecap="round"/><line x1="20" y1="52" x2="28" y2="52" stroke="#052049" stroke-width="4"/><line x1="34" y1="58" x2="42" y2="58" stroke="#052049" stroke-width="4"/><line x1="48" y1="64" x2="56" y2="64" stroke="#052049" stroke-width="4"/></svg>`
};

function twinPathsCard(frame) {
  const card = document.createElement("div");
  card.className = "sc-card-art";
  card.dataset.frame = frame.id;
  const zone = document.createElement("div");
  zone.className = "sc-card-art__zone";

  const twin = document.createElement("div");
  twin.className = "sc-twin";
  const col = (side) => {
    const c = document.createElement("div");
    c.className = "sc-twin__col";
    const header = document.createElement("p");
    header.className = "sc-twin__header";
    header.textContent = side === "tape" ? "TAPE PRESENT" : "NO TAPE";
    c.append(header);
    const circle = document.createElement("div");
    circle.className = "sc-twin__circle";
    const img = document.createElement("img");
    img.src = "assets/cards/art/behind-ear-art.png";
    img.alt = "";
    circle.append(img);
    if (side === "tape") circle.insertAdjacentHTML("beforeend", G.tape);
    const ring = document.createElement("span");
    ring.className = "sc-twin__ring";
    circle.append(ring);
    c.append(circle);
    const objects = document.createElement("div");
    objects.className = "sc-twin__objects";
    if (side === "tape") {
      const no = document.createElement("div");
      no.className = "sc-twin__no";
      no.innerHTML = G.swab + G.drops + G.noRing;
      objects.append(no);
    } else {
      objects.innerHTML = G.swab + G.bottleDark + G.bottleLight + G.tube;
    }
    c.append(objects);
    return c;
  };
  twin.append(col("tape"), col("no-tape"));
  zone.append(twin);

  const num = document.createElement("span");
  num.className = "sc-num";
  num.textContent = frame.numLabel ?? String(frame.number).padStart(2, "0");
  zone.append(num);
  if (frame.chip) {
    const chip = document.createElement("span");
    chip.className = "sc-chip";
    chip.textContent = frame.chip;
    zone.append(chip);
  }
  card.append(zone);

  const strip = document.createElement("div");
  strip.className = "sc-card-art__strip";
  const caps = document.createElement("div");
  caps.className = "sc-card-art__caps";
  for (const cap of frame.panelCaptions ?? []) {
    const label = document.createElement("p");
    label.className = "sc-card-art__caption";
    label.textContent = cap.text;
    caps.append(label);
  }
  strip.append(caps);
  const status = document.createElement("span");
  status.className = "sc-status";
  status.textContent = "DRAFT ART · PENDING CLINICAL REVIEW";
  strip.append(status);
  card.append(strip);
  return card;
}

function textLedCard(frame) {
  const card = document.createElement("div");
  card.className = `sc-field sc-field--text sc-field--text-${frame.textCard.layout ?? "list"}`;
  card.dataset.frame = frame.id;

  const num = document.createElement("span");
  num.className = "sc-num";
  num.textContent = frame.numLabel ?? String(frame.number).padStart(2, "0");
  card.append(num);

  if (frame.chip) {
    const chip = document.createElement("span");
    chip.className = "sc-chip";
    chip.textContent = frame.chip;
    card.append(chip);
  }

  const body = document.createElement("div");
  body.className = "sc-text-card";
  if (frame.textCard.lead) {
    const lead = document.createElement("p");
    lead.className = "sc-text-card__lead";
    lead.textContent = frame.textCard.lead;
    body.append(lead);
  }

  const items = document.createElement("div");
  items.className = "sc-text-card__items";
  for (const item of frame.textCard.items ?? []) {
    const row = document.createElement("section");
    row.className = `sc-text-card__item${item.accent ? ` sc-text-card__item--${item.accent}` : ""}`;
    if (item.marker) {
      const marker = document.createElement("span");
      marker.className = "sc-text-card__marker";
      marker.textContent = item.marker;
      row.append(marker);
    }
    const copy = document.createElement("div");
    copy.className = "sc-text-card__copy";
    const title = document.createElement("h3");
    title.textContent = item.title;
    copy.append(title);
    if (item.detail) {
      const detail = document.createElement("p");
      detail.textContent = item.detail;
      copy.append(detail);
    }
    if (item.lines?.length) {
      const list = document.createElement("ol");
      for (const line of item.lines) {
        const entry = document.createElement("li");
        entry.textContent = line;
        list.append(entry);
      }
      copy.append(list);
    }
    row.append(copy);
    items.append(row);
  }
  body.append(items);

  if (frame.textCard.footer) {
    const footer = document.createElement("p");
    footer.className = "sc-text-card__footer";
    footer.textContent = frame.textCard.footer;
    body.append(footer);
  }
  card.append(body);
  return card;
}

export function renderFrame(frame, { animated = true } = {}) {
  if (frame.textCard) return textLedCard(frame);
  if (frame.panelLayout === "twin-paths") return twinPathsCard(frame);
  if (frame.panel) {
    const card = document.createElement("div");
    card.className = "sc-card-art";
    card.dataset.frame = frame.id;

    const zone = document.createElement("div");
    zone.className = "sc-card-art__zone";
    const img = document.createElement("img");
    img.className = "sc-card-art__img";
    img.src = `assets/cards/art/${frame.panel}`;
    img.alt = frame.illustrationAlt ?? "";
    zone.append(img);
    const num = document.createElement("span");
    num.className = "sc-num";
    num.textContent = frame.numLabel ?? String(frame.number).padStart(2, "0");
    zone.append(num);
    if (frame.chip) {
      const chip = document.createElement("span");
      chip.className = "sc-chip";
      chip.textContent = frame.chip;
      zone.append(chip);
    }
    for (const q of frame.quadNums ?? []) {
      const badge = document.createElement("span");
      badge.className = "sc-card-art__qnum";
      badge.style.left = `${q.x}%`;
      badge.style.top = `${q.y}%`;
      badge.textContent = q.n;
      zone.append(badge);
    }
    for (const vi of frame.panelInsets ?? []) {
      const inset = document.createElement("div");
      inset.className = "sc-vinset";
      inset.style.left = `${vi.x}%`;
      inset.style.top = `${vi.y}%`;
      inset.style.width = `${vi.w}%`;
      inset.style.aspectRatio = "1";
      inset.innerHTML = G[vi.glyph] ?? "";
      if (vi.tag) {
        const tag = document.createElement("p");
        tag.className = "sc-vinset__tag";
        tag.textContent = vi.tag;
        inset.append(tag);
      }
      zone.append(inset);
      if (vi.leader) {
        const svgNS = "http://www.w3.org/2000/svg";
        const leader = document.createElementNS(svgNS, "svg");
        leader.setAttribute("class", "sc-vleader");
        leader.setAttribute("viewBox", "0 0 100 100");
        leader.setAttribute("preserveAspectRatio", "none");
        leader.style.left = "0"; leader.style.top = "0";
        leader.style.width = "100%"; leader.style.height = "100%";
        leader.innerHTML = `<line x1="${vi.leader.x}" y1="${vi.leader.y}" x2="${vi.x + vi.w / 2}" y2="${vi.y + vi.w / 2}" stroke="#052049" stroke-width="0.8" vector-effect="non-scaling-stroke"/><circle cx="${vi.leader.x}" cy="${vi.leader.y}" r="1.4" fill="#052049"/>`;
        zone.append(leader);
      }
    }
    for (const ov of frame.panelOverlays ?? []) {
      const o = document.createElement("p");
      o.className = "sc-card-art__overlay";
      o.style.left = `${ov.x}%`;
      o.style.top = `${ov.y}%`;
      o.textContent = ov.text;
      zone.append(o);
    }
    card.append(zone);

    if (frame.actionBand) {
      const band = document.createElement("div");
      band.className = "sc-card-art__action";
      band.textContent = frame.actionBand;
      card.append(band);
    }

    const strip = document.createElement("div");
    strip.className = "sc-card-art__strip";
    const caps = document.createElement("div");
    caps.className = "sc-card-art__caps";
    for (const cap of frame.panelCaptions ?? []) {
      const label = document.createElement("p");
      label.className = "sc-card-art__caption";
      label.textContent = cap.text;
      caps.append(label);
    }
    strip.append(caps);
    const status = document.createElement("span");
    status.className = "sc-status";
    status.textContent = "DRAFT ART · PENDING CLINICAL REVIEW";
    strip.append(status);
    card.append(strip);
    return card;
  }
  if (frame.art) {
    const img = document.createElement("img");
    img.className = "sc-art";
    img.src = new URL(`./cards/${frame.art}`, import.meta.url).href.replace(location.origin, "").replace(/^\/preview\/assets\//, "assets/");
    img.src = `assets/cards/${frame.art}`;
    img.alt = frame.illustrationAlt ?? "";
    img.dataset.frame = frame.id;
    return img;
  }
  const field = document.createElement("div");
  field.className = "sc-field" + (frame.illustration ? " sc-field--illustrated" : "") + (animated && !frame.illustration ? " sc-anim" : "");
  field.dataset.frame = frame.id;

  const num = document.createElement("span");
  num.className = "sc-num";
  num.textContent = frame.numLabel ?? String(frame.number).padStart(2, "0");
  field.append(num);

  if (frame.chip) {
    const chip = document.createElement("span");
    chip.className = "sc-chip";
    chip.textContent = frame.chip;
    field.append(chip);
  }

  if (frame.illustration) {
    const img = document.createElement("img");
    img.src = frame.illustration;
    img.alt = frame.illustrationAlt ?? "";
    field.append(img);
    const status = document.createElement("span");
    status.className = "sc-status";
    status.textContent = "Unreviewed concept art";
    field.append(status);
  } else {
    const canvas = document.createElement("div");
    canvas.className = "sc-canvas";
    canvas.innerHTML = frame.canvas;
    field.append(canvas);
    const status = document.createElement("span");
    status.className = "sc-status";
    status.textContent = "Placeholder · illustration pending surgeon review";
    field.append(status);
  }
  return field;
}

export const PART_TITLES = {
  1: "Care for the surgery site",
  2: "When to call",
  3: "Your first programming visits"
};
