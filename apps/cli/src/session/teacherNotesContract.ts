export type TeacherNotesDomainKey =
  | "demo_orientation"
  | "software_setup"
  | "cad_3d"
  | "soldering"
  | "wiring_electronics"
  | "coding_debugging"
  | "mechanical_build"
  | "theory_concepts";

export type TeacherNotesValidationTask = {
  title: string;
  outcome?: string;
  reinforce: string[];
  goldenNuggets: string[];
  beginner?: string;
  extension?: string;
};

export type TeacherNotesValidationContent = {
  sessionObjective: string[];
  teacherFocus?: string;
  software: string[];
  hardware: string[];
  highlightAreas: string[];
  tasks: TeacherNotesValidationTask[];
  commonIssues: Array<{ issue: string; teacherMove: string }>;
};

type TeacherNotesDomainGuidance = {
  label: string;
  minSignals: number;
  detectionPatterns: RegExp[];
  leakageSignals: RegExp[];
  skillsetExamples: string[];
  failurePatterns: string[];
  strongTeacherMoves: string[];
  genericRejects: string[];
};

const GLOBAL_GENERIC_REJECTS = [
  "Encourage independence.",
  "Be supportive.",
  "Students should try their best.",
  "Check in with students regularly.",
  "Let students be creative.",
  "Support students if they get stuck.",
  "Help students troubleshoot.",
  "Discuss ideas as a class.",
  "Complete the task pages.",
  "Make sure students understand the content."
] as const;

const DOMAIN_GUIDANCE: Record<TeacherNotesDomainKey, TeacherNotesDomainGuidance> = {
  demo_orientation: {
    label: "Demo / Orientation",
    minSignals: 1,
    detectionPatterns: [
      /\bdemo\b/i,
      /\bshowcase\b/i,
      /\bwhat zippy can do\b/i,
      /\bfunctionalit(?:y|ies)\b/i
    ],
    leakageSignals: [/\bwatch passively\b/i, /\bdemo\b/i, /\bshowcase\b/i],
    skillsetExamples: [
      "Call out the one or two robot behaviours students need to remember for later sessions.",
      "Turn part of the demo into a prediction or hands-on moment rather than passive watching."
    ],
    failurePatterns: [
      "Students watch passively and cannot explain what the robot just did.",
      "Students remember the exciting feature but miss the underlying purpose or system."
    ],
    strongTeacherMoves: [
      "Pause and ask a student to predict what the robot will do next before continuing the demo.",
      "Explicitly point out the feature that later build sessions depend on, rather than assuming students noticed it."
    ],
    genericRejects: [
      "Show the demo and let students watch.",
      "Ask students if they have questions."
    ]
  },
  software_setup: {
    label: "Software Setup / Installation",
    minSignals: 2,
    detectionPatterns: [
      /\binstall\b/i,
      /\bsetup\b/i,
      /\blog ?in\b/i,
      /\baccount\b/i,
      /\barduino ide\b/i,
      /\bboard\b/i,
      /\bport\b/i,
      /\bdriver\b/i
    ],
    leakageSignals: [
      /\barduino ide\b/i,
      /\bboard\b/i,
      /\bport\b/i,
      /\binstall\b/i,
      /\bsetup\b/i
    ],
    skillsetExamples: [
      "Run a short success check before moving on: software opens, board is selected, port appears, first upload or check works.",
      "Have a rapid board/port/login checklist ready before troubleshooting gets expensive."
    ],
    failurePatterns: [
      "Students say the software is installed but cannot open or test it successfully.",
      "Students get stuck on board, port, or account setup and wait too long before asking."
    ],
    strongTeacherMoves: [
      "Check install order and confirm a first successful tool test before students move into the practical task.",
      "Use a short checklist for board, port, and account issues before doing deeper troubleshooting."
    ],
    genericRejects: [
      "Make sure the software is installed.",
      "Help students set things up."
    ]
  },
  cad_3d: {
    label: "3D Design / CAD",
    minSignals: 1,
    detectionPatterns: [
      /\btinkercad\b/i,
      /\b3d\b/i,
      /\bmodel(?:ling)?\b/i,
      /\bprintability\b/i,
      /\bclearance\b/i,
      /\bprint(?:ing)?\b/i,
      /\boverhang\b/i,
      /\bwall thickness\b/i
    ],
    leakageSignals: [
      /\btinkercad\b/i,
      /\bprintability\b/i,
      /\bchassis space\b/i,
      /\bsits on the chassis\b/i,
      /\bchanging on zippy\b/i,
      /\boverhang\b/i,
      /\bwall thickness\b/i
    ],
    skillsetExamples: [
      "Check fit, clearance, and attachment logic before students commit to detailed features.",
      "Push students to explain what the design change improves: fit, function, attachment, or appearance."
    ],
    failurePatterns: [
      "Students design by eye rather than by fit or measurement.",
      "Students add decorative features that reduce printability or function.",
      "Students ignore clearances and attachment logic."
    ],
    strongTeacherMoves: [
      "Ask students to point to the exact chassis space, clearance, or fixing point before approving the idea.",
      "Stop decorative drift by asking what the change improves and how it will still print or fit."
    ],
    genericRejects: [
      "Encourage creativity in the design.",
      "Let students experiment with their model."
    ]
  },
  soldering: {
    label: "Soldering",
    minSignals: 2,
    detectionPatterns: [
      /\bsolder(?:ing)?\b/i,
      /\biron\b/i,
      /\bflux\b/i,
      /\bcontinuity\b/i,
      /\bbridge\b/i,
      /\bcold joint\b/i
    ],
    leakageSignals: [
      /\bsolder(?:ing)?\b/i,
      /\bcontinuity\b/i,
      /\bcold joint\b/i,
      /\bbridge\b/i
    ],
    skillsetExamples: [
      "Inspect joints before power-on and make continuity checks explicit.",
      "Pause students on polarity and bridge risk before they solder themselves into a corner."
    ],
    failurePatterns: [
      "Students produce dull or weak joints and think they are finished.",
      "Students miss polarity or bridge errors until much later.",
      "Students skip continuity checks and only discover faults at power-on."
    ],
    strongTeacherMoves: [
      "Inspect joint quality before power-on rather than waiting for full circuit failure.",
      "Ask students to justify polarity, then verify continuity before moving on."
    ],
    genericRejects: [
      "Tell students to solder carefully.",
      "Remind students to be safe."
    ]
  },
  wiring_electronics: {
    label: "Wiring / Electronics",
    minSignals: 1,
    detectionPatterns: [
      /\bwiring\b/i,
      /\bpin\b/i,
      /\bdiagram\b/i,
      /\bground\b/i,
      /\bpower rail\b/i,
      /\bbreadboard\b/i
    ],
    leakageSignals: [
      /\bwiring\b/i,
      /\bpin\b/i,
      /\bdiagram\b/i,
      /\bbreadboard\b/i
    ],
    skillsetExamples: [
      "Make students trace one connection at a time against the diagram.",
      "Separate power, ground, and signal checks instead of treating the whole circuit as one mystery."
    ],
    failurePatterns: [
      "Students misread the diagram and shift one or more wires.",
      "Students cannot systematically verify a circuit path.",
      "Students power the wrong rail or confuse signal and power pins."
    ],
    strongTeacherMoves: [
      "Make students trace each connection aloud against the diagram one at a time.",
      "Verify power, ground, and signal separately before debugging anything else."
    ],
    genericRejects: [
      "Check the wiring.",
      "Have students compare it to the diagram."
    ]
  },
  coding_debugging: {
    label: "Coding / Debugging",
    minSignals: 2,
    detectionPatterns: [
      /\bserial monitor\b/i,
      /\bcode\b/i,
      /\bprogram(?:ming)?\b/i,
      /\bdebug\b/i,
      /\bcompile\b/i,
      /\btest(?:ing)?\b/i,
      /\bupload\b/i,
      /\bsketch\b/i,
      /\bvariable\b/i
    ],
    leakageSignals: [
      /\bserial monitor\b/i,
      /\bcompile\b/i,
      /\bupload\b/i,
      /\bvariable\b/i
    ],
    skillsetExamples: [
      "Force one change, one test, one explanation.",
      "Make students explain what evidence would prove the bug is in code, wiring, or hardware."
    ],
    failurePatterns: [
      "Students change several things at once and lose the cause of the bug.",
      "Students read code without testing assumptions against outputs.",
      "Students ask for fixes before isolating the fault."
    ],
    strongTeacherMoves: [
      "Force one change, one test, one explanation.",
      "Ask what evidence would prove the issue is in code, wiring, or hardware before offering a fix."
    ],
    genericRejects: [
      "Tell students to debug carefully.",
      "Help students fix the code."
    ]
  },
  mechanical_build: {
    label: "Mechanical Build / Assembly",
    minSignals: 2,
    detectionPatterns: [
      /\bassemble\b/i,
      /\bassembly\b/i,
      /\balignment\b/i,
      /\bmount\b/i,
      /\bfasten(?:ing)?\b/i,
      /\bscrew(?:driver|s)?\b/i,
      /\bhex\b/i,
      /\bhinge\b/i,
      /\borientation\b/i,
      /\ballen key\b/i,
      /\bstrain relief\b/i,
      /\bchassis\b/i
    ],
    leakageSignals: [
      /\balignment\b/i,
      /\bmount\b/i,
      /\borientation\b/i,
      /\bstrain relief\b/i
    ],
    skillsetExamples: [
      "Stop the build when alignment looks wrong and check orientation before anything is tightened permanently.",
      "Treat build order as part of success, not a cosmetic detail."
    ],
    failurePatterns: [
      "Students rush an early step and create alignment problems later.",
      "Students force-fit parts instead of checking orientation."
    ],
    strongTeacherMoves: [
      "Stop the build when alignment looks wrong and re-check orientation before parts are fixed permanently.",
      "Check build order before students lock in a part that blocks later assembly."
    ],
    genericRejects: [
      "Help students build the project.",
      "Make sure everything fits together."
    ]
  },
  theory_concepts: {
    label: "Theory / Concepts",
    minSignals: 1,
    detectionPatterns: [
      /\btheory\b/i,
      /\bconcepts?\b/i,
      /\bhow .* works\b/i,
      /\bmisconception\b/i
    ],
    leakageSignals: [
      /\bconcepts?\b/i,
      /\bmisconception\b/i,
      /\bexplain why\b/i
    ],
    skillsetExamples: [
      "Use one short apply-it-now question to reveal whether understanding will transfer into the build.",
      "Focus on the one or two concepts that later practical work depends on."
    ],
    failurePatterns: [
      "Students can repeat the term but cannot apply the idea.",
      "Students carry a misconception into the practical task without noticing."
    ],
    strongTeacherMoves: [
      "Use one short apply-it-now question to reveal whether the concept will transfer into the build.",
      "Check whether students can explain the idea in their own words before moving on."
    ],
    genericRejects: [
      "Explain the concept clearly.",
      "Make sure students understand the theory."
    ]
  }
};

export const TEACHER_NOTES_CONTRACT = {
  structure: {
    useHrBetweenSections: true
  },
  mainSessionObjective: {
    minEntries: 2,
    maxEntries: 3,
    renderIntroLine: false,
    validPrefixes: ["Students will", "Students can"]
  },
  teacherFocus: {
    render: true
  },
  teacherHighlightAreas: {
    minEntries: 2,
    maxEntries: 5
  },
  taskGuidance: {
    renderGoldenNuggetsOnlyWhenPresent: true,
    renderDifferentiationOnlyWhenPresent: true
  },
  mostCommonIssues: {
    minEntries: 2,
    maxEntries: 6
  },
  renderer: {
    sectionOrder: [
      "Main Session Objective",
      "Components & Software Required",
      "Teacher Highlight Areas",
      "Task-by-Task Guidance",
      "Most Common Issues"
    ],
    renderTeacherFocusAfterObjectives: true,
    renderGoldenNuggetsOnlyWhenPresent: true,
    renderDifferentiationOnlyWhenPresent: true
  },
  prompt: {
    globalRules: [
      "Use the fixed top-level sections and do not invent extra top-level headings.",
      "Teacher Notes are not a lesson summary. They exist to help a teacher make fast, high-value interventions.",
      "Prefer concrete checks, hidden failure patterns, and fast teacher moves over generic pedagogy.",
      "Stay grounded in the actual session evidence and task order.",
      "Reject cross-domain leakage when the session evidence does not support it."
    ],
    genericOutputRejects: [...GLOBAL_GENERIC_REJECTS]
  },
  validation: {
    rejectGenericOutput: true,
    rejectCrossDomainLeakage: true
  },
  domains: DOMAIN_GUIDANCE
} as const;

export type TeacherNotesPromptGuidance = {
  domains: TeacherNotesDomainKey[];
  globalRules: string[];
  domainRules: string[];
  genericRejects: string[];
};

export type TeacherNotesValidationResult = {
  errors: string[];
  warnings: string[];
};

const SOURCE_SCAFFOLD_PATTERNS = [
  /Use the sections below as a starter template and replace the example content with real task instructions\./i,
  /Learning Goal Describe what students are trying to build, test, or explain in Task [A-Za-z0-9]+\./i,
  /Materials(?:\s+\[ADD MATERIAL\]){3}/i,
  /Steps(?:\s+\[ADD STEP\]){3}/i,
  /Success Checklist I completed the core task\. I tested my work safely\. I can explain one thing I changed or learned\./i,
  /Example Local Image Store local images in the images\/ folder and reference them like this:\s*Missing image asset:\s*images\/example\.jpg/i,
  /Example Video Paste a YouTube, Vimeo, or direct video link on its own line:/i,
  /Example Table Item Purpose Status Example component What it is used for Ready Example tool How it helps Needed/i,
  /Example Callouts/i,
  /Helpful context, teacher tips, or reminders can go here\./i,
  /Background information or a concept explanation can go here\./i,
  /Safety advice, fragile-step warnings, or equipment cautions can go here\./i,
  /Reflection prompts or peer discussion questions can go here\./i,
  /Example Callouts Helpful context, teacher tips, or reminders can go here\. Background information or a concept explanation can go here\. Safety advice, fragile-step warnings, or equipment cautions can go here\. Reflection prompts or peer discussion questions can go here\./i,
  /Describe what a successful result looks like here\./i,
  /Helpful Link Add a supporting resource/i,
  /Optional Agent Brief/i
] as const;

function normalizeLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function countMatchingPatterns(value: string, patterns: RegExp[]): number {
  let hits = 0;
  for (const pattern of patterns) {
    if (pattern.test(value)) hits += 1;
  }
  return hits;
}

function collectContentLines(content: TeacherNotesValidationContent): string[] {
  return [
    ...content.sessionObjective,
    ...(content.teacherFocus ? [content.teacherFocus] : []),
    ...content.software,
    ...content.hardware,
    ...content.highlightAreas,
    ...content.tasks.flatMap((task) => [
      task.title,
      ...(task.outcome ? [task.outcome] : []),
      ...task.reinforce,
      ...task.goldenNuggets,
      ...(task.beginner ? [task.beginner] : []),
      ...(task.extension ? [task.extension] : [])
    ]),
    ...content.commonIssues.flatMap((item) => [item.issue, item.teacherMove])
  ].map(normalizeLine).filter(Boolean);
}

export function hasTeacherNotesObjectivePrefix(value: string): boolean {
  return TEACHER_NOTES_CONTRACT.mainSessionObjective.validPrefixes.some((prefix) =>
    value.startsWith(prefix)
  );
}

export function sanitizeTeacherNotesSourceText(value: string): string {
  let cleaned = normalizeLine(value);
  for (const pattern of SOURCE_SCAFFOLD_PATTERNS) {
    cleaned = cleaned.replace(pattern, " ");
    cleaned = normalizeLine(cleaned);
  }
  return cleaned;
}

export function detectTeacherNotesDomains(parts: string[]): TeacherNotesDomainKey[] {
  const source = parts
    .map(sanitizeTeacherNotesSourceText)
    .filter(Boolean)
    .join("\n");
  const domains = (Object.entries(DOMAIN_GUIDANCE) as Array<
    [TeacherNotesDomainKey, TeacherNotesDomainGuidance]
  >)
    .filter(([, domain]) => countMatchingPatterns(source, domain.detectionPatterns) >= domain.minSignals)
    .map(([key]) => key);

  return domains;
}

export function buildTeacherNotesPromptGuidance(
  domains: TeacherNotesDomainKey[]
): TeacherNotesPromptGuidance {
  const uniqueDomains = Array.from(new Set(domains));
  const domainRules = uniqueDomains.flatMap((domainKey) => {
    const domain = DOMAIN_GUIDANCE[domainKey];
    return [
      `Active domain: ${domain.label}.`,
      `Failure patterns to recognise: ${domain.failurePatterns.join(" ")}`,
      `Strong teacher moves to prefer: ${domain.strongTeacherMoves.join(" ")}`
    ];
  });

  const genericRejects = Array.from(
    new Set([
      ...TEACHER_NOTES_CONTRACT.prompt.genericOutputRejects,
      ...uniqueDomains.flatMap((domainKey) => DOMAIN_GUIDANCE[domainKey].genericRejects)
    ])
  );

  return {
    domains: uniqueDomains,
    globalRules: [...TEACHER_NOTES_CONTRACT.prompt.globalRules],
    domainRules,
    genericRejects
  };
}

export function validateTeacherNotesContent(
  content: TeacherNotesValidationContent,
  input: { detectedDomains?: TeacherNotesDomainKey[] }
): TeacherNotesValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const lines = collectContentLines(content);
  const combined = lines.join("\n");
  const detectedDomains = input.detectedDomains ?? [];

  if (
    content.sessionObjective.length < TEACHER_NOTES_CONTRACT.mainSessionObjective.minEntries ||
    content.sessionObjective.length > TEACHER_NOTES_CONTRACT.mainSessionObjective.maxEntries
  ) {
    errors.push("Main Session Objective must contain 2 to 3 bullets.");
  }

  for (const objective of content.sessionObjective) {
    if (!hasTeacherNotesObjectivePrefix(objective)) {
      errors.push(`Objective does not start with an allowed prefix: "${objective}"`);
    }
  }

  if (TEACHER_NOTES_CONTRACT.teacherFocus.render && !content.teacherFocus) {
    errors.push("Teacher Focus is required.");
  }

  if (
    content.highlightAreas.length < TEACHER_NOTES_CONTRACT.teacherHighlightAreas.minEntries ||
    content.highlightAreas.length > TEACHER_NOTES_CONTRACT.teacherHighlightAreas.maxEntries
  ) {
    errors.push("Teacher Highlight Areas must contain 2 to 5 entries.");
  }

  if (
    content.commonIssues.length < TEACHER_NOTES_CONTRACT.mostCommonIssues.minEntries ||
    content.commonIssues.length > TEACHER_NOTES_CONTRACT.mostCommonIssues.maxEntries
  ) {
    errors.push("Most Common Issues must contain 2 to 6 entries.");
  }

  if (TEACHER_NOTES_CONTRACT.validation.rejectGenericOutput) {
    for (const line of lines) {
      const normalized = normalizeLine(line).toLowerCase();
      const matchedGenericReject = [...GLOBAL_GENERIC_REJECTS].find(
        (candidate) => normalizeLine(candidate).toLowerCase() === normalized
      );
      if (matchedGenericReject) {
        errors.push(`Generic output should be rejected: "${line}"`);
      }
    }
  }

  if (
    TEACHER_NOTES_CONTRACT.validation.rejectCrossDomainLeakage &&
    detectedDomains.length > 0
  ) {
    const active = new Set(detectedDomains);
    for (const [domainKey, domain] of Object.entries(DOMAIN_GUIDANCE) as Array<
      [TeacherNotesDomainKey, TeacherNotesDomainGuidance]
    >) {
      if (active.has(domainKey)) continue;
      if (domain.leakageSignals.some((pattern) => pattern.test(combined))) {
        errors.push(
          `Output contains ${domain.label} language but the session evidence does not mark that domain as active.`
        );
      }
    }
  }

  if (content.tasks.length === 0) {
    warnings.push("No task guidance was generated.");
  }

  return { errors, warnings };
}
