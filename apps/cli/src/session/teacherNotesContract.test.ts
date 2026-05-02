import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTeacherNotesPromptGuidance,
  detectTeacherNotesDomains,
  sanitizeTeacherNotesSourceText,
  validateTeacherNotesContent
} from "./teacherNotesContract.js";

test("detectTeacherNotesDomains identifies mixed demo/setup/soldering sessions without 3D leakage", () => {
  const domains = detectTeacherNotesDomains([
    "Session 01 - Nexgen Zippy Demo",
    "Students watch the Nexgen Zippy demo, install Arduino IDE, select the correct board and port, and practise basic soldering technique with the iron."
  ]);

  assert.ok(domains.includes("demo_orientation"));
  assert.ok(domains.includes("software_setup"));
  assert.ok(domains.includes("soldering"));
  assert.ok(!domains.includes("cad_3d"));
});

test("sanitizeTeacherNotesSourceText strips starter-template task scaffolding", () => {
  const cleaned = sanitizeTeacherNotesSourceText(
    "Use the sections below as a starter template and replace the example content with real task instructions. " +
    "Learning Goal Describe what students are trying to build, test, or explain in Task A. " +
    "Materials [ADD MATERIAL] [ADD MATERIAL] [ADD MATERIAL] " +
    "Steps [ADD STEP] [ADD STEP] [ADD STEP] " +
    "Success Checklist I completed the core task. I tested my work safely. I can explain one thing I changed or learned. " +
    "Example Callouts Helpful context, teacher tips, or reminders can go here. " +
    "Background information or a concept explanation can go here. " +
    "Safety advice, fragile-step warnings, or equipment cautions can go here. " +
    "Reflection prompts or peer discussion questions can go here. " +
    "Helpful Link Add a supporting resource Optional Agent Brief"
  );

  assert.equal(cleaned, "");
});

test("detectTeacherNotesDomains ignores task-template theory leakage for Session 01", () => {
  const domains = detectTeacherNotesDomains([
    "Session 01 - Nexgen Zippy Demo",
    "Introduction: Nexgen Zippy Demo",
    "Use the sections below as a starter template and replace the example content with real task instructions. " +
      "Background information or a concept explanation can go here. " +
      "Optional Agent Brief"
  ]);

  assert.ok(domains.includes("demo_orientation"));
  assert.ok(!domains.includes("theory_concepts"));
});

test("detectTeacherNotesDomains keeps 3D routing but ignores task-template theory leakage for Session 02", () => {
  const domains = detectTeacherNotesDomains([
    "Session 02 - Customizing Zippy in 3D",
    "Introduction: Customizing Zippy in 3D",
    "Students customise Zippy in 3D using Tinkercad and check fit, clearance, and printability.",
    "Use the sections below as a starter template and replace the example content with real task instructions. " +
      "Background information or a concept explanation can go here. " +
      "Optional Agent Brief"
  ]);

  assert.ok(domains.includes("cad_3d"));
  assert.ok(!domains.includes("theory_concepts"));
});

test("detectTeacherNotesDomains does not treat Serial print output as 3D CAD evidence", () => {
  const domains = detectTeacherNotesDomains([
    "Session 03 - The LCD Screen & 3x4 Matrix Keypad",
    "Students wire the LCD screen from a diagram, upload code, and use Serial Monitor to check which keypad key prints the correct value.",
    "Create custom LCD characters and display them on the LCD."
  ]);

  assert.ok(domains.includes("wiring_electronics"));
  assert.ok(domains.includes("coding_debugging"));
  assert.ok(!domains.includes("cad_3d"));
});

test("detectTeacherNotesDomains prefers mechanical build over soldering for assembly-only evidence", () => {
  const domains = detectTeacherNotesDomains([
    "Session 06 - Assembling Zippy",
    "Students assemble the chassis, use a screwdriver and hex tool, fit the hinge, and follow the assembly order carefully.",
    "Which screwdriver is best for a Phillips screw?"
  ]);

  assert.ok(domains.includes("mechanical_build"));
  assert.ok(!domains.includes("soldering"));
});

test("detectTeacherNotesDomains activates coding and wiring together for code-and-test sessions", () => {
  const domains = detectTeacherNotesDomains([
    "Session 07 - Wiring, Coding + Testing Zippy",
    "Students wire the circuit, upload code, test behaviour, and debug one change at a time.",
    "When changing code, what is a good practice to avoid errors?"
  ]);

  assert.ok(domains.includes("wiring_electronics"));
  assert.ok(domains.includes("coding_debugging"));
});

test("buildTeacherNotesPromptGuidance includes domain-specific rules and generic rejects", () => {
  const guidance = buildTeacherNotesPromptGuidance(["cad_3d", "soldering"]);

  assert.ok(guidance.domainRules.some((line) => line.includes("3D Design / CAD")));
  assert.ok(guidance.domainRules.some((line) => line.includes("Soldering")));
  assert.ok(guidance.genericRejects.some((line) => line.includes("Tell students to solder carefully.")));
  assert.ok(guidance.globalRules.some((line) => line.includes("Teacher Notes are not a lesson summary.")));
});

test("validateTeacherNotesContent flags cross-domain leakage and generic filler", () => {
  const validation = validateTeacherNotesContent(
    {
      sessionObjective: [
        "Students will install the required software for the robot.",
        "Students will practise safe soldering checks before later build work."
      ],
      teacherFocus: "Encourage independence.",
      software: ["Arduino IDE"],
      hardware: ["Soldering iron"],
      highlightAreas: [
        "Check that students can justify what they are changing on Zippy, where it sits on the chassis, and why that choice improves the build.",
        "Anticipate upload and board-selection friction before students escalate."
      ],
      tasks: [
        {
          title: "Session 01: Task A",
          outcome: "Install Arduino IDE and confirm the board and port are ready.",
          reinforce: ["Check board and port before troubleshooting."],
          goldenNuggets: [],
          beginner: undefined,
          extension: undefined
        }
      ],
      commonIssues: [
        {
          issue: "Students cannot find the correct board or port.",
          teacherMove: "Run a short board-port checklist before deeper troubleshooting."
        },
        {
          issue: "Students bridge two solder pads.",
          teacherMove: "Inspect the joint and remove the bridge before moving on."
        }
      ]
    },
    { detectedDomains: ["demo_orientation", "software_setup", "soldering"] }
  );

  assert.ok(
    validation.errors.some((message) => message.includes("Generic output should be rejected"))
  );
  assert.ok(
    validation.errors.some((message) => message.includes("3D Design / CAD"))
  );
});

test("validateTeacherNotesContent treats plural concept language as theory leakage", () => {
  const validation = validateTeacherNotesContent(
    {
      sessionObjective: [
        "Students will explain what Nexgen Zippy can do.",
        "Students will complete Session 01: Task A/B/C."
      ],
      teacherFocus:
        "Watch for students who are passively observing the demo without understanding the underlying concepts.",
      software: [],
      hardware: [],
      highlightAreas: [
        "Pause and ask a student to predict what the robot will do next before continuing the demo.",
        "Explicitly point out the feature that later build sessions depend on, rather than assuming students noticed it."
      ],
      tasks: [],
      commonIssues: [
        {
          issue: "Students watch passively and cannot explain what the robot just did.",
          teacherMove: "Pause the demo and ask a student to predict the next robot behaviour before continuing."
        },
        {
          issue: "Students remember the exciting feature but miss the underlying purpose or system.",
          teacherMove: "Stop and point to the exact feature that later build sessions depend on."
        }
      ]
    },
    { detectedDomains: ["demo_orientation"] }
  );

  assert.ok(
    validation.errors.some((message) => message.includes("Theory / Concepts"))
  );
});
