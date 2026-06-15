# Teacher Notes Contract

Status: draft  
Owner: Nexgen curriculum / delivery  
Implementation target: `teacher-notes` command and `/teacher-notes` agent route

## Purpose

This document defines the fixed structure, meaning, and constraints for Nexgen Teacher Notes.

The goal is to make Teacher Notes:

- consistent in structure across sessions
- genuinely useful to a busy teacher mainly for prepartion for each session
- grounded in the real session content
- concise enough to read quickly
- specific enough to prevent wasted student time
- should contain any specific gotchas or general topic gotchas relevant to the session

This contract is the human-authored source of truth.

The agent should not invent its own structure.
The renderer should not infer meaning.
The CLI should validate output against this contract before publishing.

## Core Principles

Teacher Notes should ALWAYS inspire teachers to run a kick-arse club (excuse the French)
Kick-arse in this context means: Inspiring, Engaging and something you would bring your friends to
Therefore, teacher notes are not just about ticking boxes, it is about doing something so well that everyone wants to do it.

Teacher Notes are not a lesson summary.

They answer this question:

`How can the teacher maximise help to students to build an effective project in this session?`

That means the notes should bias toward:

- what to watch for
- what students are likely to get wrong
- what should be checked early
- what intervention saves the most time
- what exact move helps a stuck student without taking over the task

## Fixed Page Structure

The Teacher Notes page always uses this section order:

1. Main Session Objective
2. Components & Software Required
3. Teacher Highlight Areas
4. Task-by-Task Guidance
5. Most Common Issues

No extra top-level sections should be added by the agent.
Each section is an H3 HTML heading.

## Global Rules

These rules apply to the whole page.

### Must

- Use the fixed headings and section order.
- Stay grounded in the actual session pages and task structure.
- Prefer concrete checks over generic pedagogy.
- Prefer short, high-value lines over padded prose.
- Use teacher-facing wording everywhere except `Main Session Objective`.
- Make each line sound session-specific, not reusable boilerplate.
- Use horizontal rules between each logical section. Use them liberally to space out content.

### Must Not

- Echo source pages or review notes verbatim.
- Include meta commentary such as "the wording is wrong" or "the first point is fine".
- Pad with generic advice such as "encourage independence" unless tied to a specific classroom move.
- Introduce tools, components, or constraints not supported by the session evidence.
- Turn formatting instructions into page content.

### Preferred Tone

- direct
- practical
- classroom-aware
- specific
- low fluff

## Section Contract

### 1. Main Session Objective

#### Meaning

Defines what students should be able to do by the end of the session.

This section is student-outcome focused, not teacher-action focused.

#### Allowed Content

- student outcomes
- concrete capability statements
- task-relevant design/build/debug goals

#### Forbidden Content

- teacher instructions
- generic values language
- reminders about classroom management
- "guide students", "support students", "encourage students" phrasing

#### Format Rules

- No introductory line - should just be a list of bullets
- 2 to 3 bullet points
- every bullet starts with `Students will` or `Students can`
- each bullet is one sentence

#### Good Example

- Students will customise Zippy using Tinkercad.
- Students can test whether a design idea fits the usable chassis space.
- Students will refine a model so it is both printable and purposeful.

#### Bad Example

- Guide students in customising Zippy.
- Encourage creativity in 3D modelling.
- Support students in refining their designs.

### 2. Components & Software Required

#### Meaning

Lists only the software and hardware that matter for successful participation in this specific session.

#### Allowed Content

- named software used in the session
- named hardware used in the session
- `N/A` for software OR hardware when not required

#### Forbidden Content

- generic school equipment
- speculative components not present in the session
- long explanatory notes

#### Format Rules

- split into `Software` and `Hardware`
- software: 0 to 6 items
- hardware: 0 to 10 items
- if no software OR hardware is genuinely required, use `N/A`

#### Good Example

Software:

- Tinkercad

Hardware:

- N/A

### 3. Teacher Highlight Areas

#### Meaning

The 2 to 5 highest-value things a teacher should be paying attention to before and during the session.

These are not task steps.
They are leverage points.

#### Allowed Content

- design checks
- hidden misconceptions
- moments where students tend to drift or waste time
- behaviours that predict later failure
- pre-emptive teacher moves

#### Forbidden Content

- generic pedagogy
- repeated task bullets
- vague statements like "be supportive"
- restating the session title

#### Format Rules

- 2 to 5 bullet points
- each point should be teacher-facing
- each point should feel worth underlining before class starts

#### Good Example

- Make file naming explicit early so students can find the right Tinkercad version quickly during feedback.
- Use a quick sketch-and-explain checkpoint before modelling so weak ideas are corrected before students sink time into them.
- Check whether students are designing around actual chassis space rather than decorating by eye.
- Keep an eye out for unprintable designs ie. designs with large overhangs

#### Bad Example

- Encourage creativity and experimentation.
- Students should try their best.
- Discuss ideas as a class.

### 4. Task-by-Task Guidance

#### Meaning

Explains what matters most for each task header in the session.

Each task section should help the teacher decide:

- what this task is really for
- what to reinforce
- what warning sign matters
- how to pitch difficulty appropriately

#### Required Subsections Per Task

- Outcome
- Key points to reinforce
- Golden nuggets - only use these if they are truly 'golden' ie. one in a million piece of advice that will help immensely
- Differentiation - only use this if there is a clearly differentiated path between beginners and advanced students.

#### Task Outcome

Meaning:

What successful completion of the task looks like.

Rules:

- one short sentence
- should describe the purpose of the task, not just "complete page X"

Good Example:

- Students apply their design idea to the Zippy chassis and test whether the modification fits the available space.

#### Key Points To Reinforce

Meaning:

What the teacher should repeat, check, or bring students back to while they work.

Rules:

- 1 to 4 bullets
- concrete and task-specific
- may include checks, expectations, or design constraints

Good Example:

- Keep the design focused on the chassis rather than unrelated decorative features.
- Measure against the chassis before scaling or thickening any feature.

#### Golden Nuggets

Meaning:

Small, high-leverage teacher insights that prevent wasted time or reveal a hidden issue. Should truly be a 'golden' insight that other teachers need to know.

Rules:

- 0 to 3 bullets
- sharp and specific
- should feel like a teacher shortcut, not a task summary

Good Example:

- If a student understands the idea but cannot model the full form, allow a simpler version that keeps the key characteristics.
- Students who skip sketching usually commit too early to weak proportions.

Bad Example:

- This task is about design.
- Help students if they get stuck.

#### Differentiation

Meaning:

How to keep beginners moving and how to stretch confident students without changing the core purpose of the task.

Rules:

- two short lines only
- `Beginners (Year 7)`
- `Extension (confident students / Year 10)`

Good Example:

- Beginners (Year 7): Focus on one clear modification that fits the chassis cleanly.
- Extension (confident students / Year 10): Add a second feature only if it still preserves printability and clearance.

### 5. Most Common Issues

#### Meaning

The most likely failure patterns, misconceptions, or design mistakes that will block progress in this session.

Each issue must be paired with a fast teacher move.

#### Allowed Content

- observable failure patterns
- misconceptions
- practical mistakes
- teacher intervention moves

#### Forbidden Content

- vague risks
- emotional speculation
- generic troubleshooting advice with no session anchor

#### Format Rules

- 2 to 6 issue entries
- each entry has:
  - `Issue`
  - `Teacher move`
- issue should describe what the teacher will see
- teacher move should describe the fastest useful intervention

#### Good Example

Issue:

- Students size features by eye, so the model no longer fits the Zippy chassis cleanly.

Teacher move:

- Stop the design and have students measure against the chassis or sketch before they continue modelling in Tinkercad.

#### Bad Example

Issue:

- Wrong measurements.

Teacher move:

- Help them fix it.

## Session Specificity Standard

A Teacher Notes page should fail validation if most lines could be pasted into a different session without sounding wrong.

The notes should clearly change between:

- a 3D design session
- a soldering session
- a wiring/debugging session
- a theory/concept session

## Validation Heuristics

These should become code-level validation checks.

### Reject Or Flag

- student-objective bullets that do not start with `Students will` or `Students can`
- meta review text
- repeated lines across sections
- empty `Most Common Issues`
- hardware lists that should be `N/A`
- lines with no evidence overlap with the session context
- generic filler such as "encourage independence" with no classroom move

### Prefer

- references to concrete tools, parts, checks, constraints, or failure patterns
- teacher actions that are fast and diagnostic
- early-intervention checkpoints
- specific differentiation that preserves task purpose

## Domain Guidance

This remains one global contract.

We do NOT want separate contract files per session type.

Instead, we want this file to carry domain-specific guidance that helps the runtime layer:

- validate whether output matches the real session type
- steer prompts toward the right teacher moves
- reject cross-domain contamination
- accumulate better examples over time

The runtime should treat the following subsections as guidance and evidence standards, not as copyable output.

### Skillset Examples

This section should grow over time.

Initial domain skeleton:

#### Demo / Orientation

Good notes usually focus on:

- where students lose the thread of what the robot or project is actually doing
- which part of the demo should become interactive rather than passive watching
- what to explicitly point out so later sessions make sense

#### Software Setup / Installation

Good notes usually focus on:

- login friction
- board and port selection
- install order
- whether students can open and test the tool successfully before moving on

#### 3D Design / CAD

Good notes usually focus on:

- fit to chassis or usable space
- clearances
- scale
- attachment points
- printability
- design purpose vs decoration

#### Soldering

Good notes usually focus on:

- joint quality
- polarity
- bridges
- continuity checks
- heat discipline
- safety and bench workflow

#### Wiring / Electronics

Good notes usually focus on:

- pin mapping
- reading diagrams correctly
- tracing one connection at a time
- power and ground mistakes
- checking before power-on

#### Coding / Debugging

Good notes usually focus on:

- one-change-at-a-time testing
- visible debug loops
- verifying inputs/outputs
- matching code assumptions to wiring reality
- spotting whether students are guessing vs diagnosing

#### Mechanical Build / Assembly

Good notes usually focus on:

- orientation of parts
- build sequence
- fastening and strain relief
- alignment
- whether a rushed step creates hidden later problems

#### Theory / Concepts

Good notes usually focus on:

- the one or two ideas students must actually understand
- misconceptions that will later break practical work
- short checks that reveal whether understanding is real or memorised

### Failure Patterns By Domain

This section should capture the patterns teachers repeatedly see.

Initial skeleton:

#### Demo / Orientation

- Students watch passively and cannot explain what they just saw.
- Students remember the exciting feature but miss the underlying system or purpose.

#### Software Setup / Installation

- Students say the software is installed but cannot actually open or test it.
- Students get stuck on board/port/account setup and wait too long before asking.

#### 3D Design / CAD

- Students design by eye rather than by fit or measurement.
- Students add decorative features that reduce printability or function.
- Students ignore clearances and attachment logic.

#### Soldering

- Students produce dull or weak joints and think they are done.
- Students miss polarity or bridge errors until much later.
- Students skip continuity checks and only discover faults at power-on.

#### Wiring / Electronics

- Students misread the diagram and shift one or more wires.
- Students cannot systematically verify a circuit path.
- Students power the wrong rail or confuse signal and power pins.

#### Coding / Debugging

- Students change several things at once and lose the cause of the bug.
- Students read code without testing assumptions against outputs.
- Students ask for fixes before isolating the fault.

#### Mechanical Build / Assembly

- Students rush an early step and create alignment problems later.
- Students force-fit parts instead of checking orientation.

#### Theory / Concepts

- Students can repeat the term but cannot apply the idea.
- Students carry a misconception into the practical task without noticing.

### Strong Teacher Moves By Domain

This section should describe high-value teacher interventions that save time without taking over.

Initial skeleton:

#### Demo / Orientation

- Pause and ask a student to predict what the robot or system will do next.
- Turn one part of the demo into a student-controlled check rather than a teacher-only showcase.

#### Software Setup / Installation

- Run a quick success check before moving on: software open, board selected, port visible, first test complete.
- Use a short checklist before deeper troubleshooting.

#### 3D Design / CAD

- Ask students to point to the exact chassis space, clearance, or fixing point before approving the idea.
- Stop decorative drift by asking what the change improves: fit, function, attachment, or appearance.

#### Soldering

- Inspect joints before power-on.
- Ask students to justify polarity and then verify continuity before moving forward.

#### Wiring / Electronics

- Make students trace each connection aloud against the diagram one at a time.
- Verify power, ground, and signal separately instead of treating the wiring as one blob.

#### Coding / Debugging

- Force one change, one test, one explanation.
- Ask what evidence would prove the bug is in code, wiring, or hardware.

#### Mechanical Build / Assembly

- Stop the build when alignment looks wrong and re-check orientation before tightening or fixing parts permanently.

#### Theory / Concepts

- Use one short apply-it-now question to reveal whether the concept will transfer into the build.

### Common Generic Output To Reject

The runtime should flag or reject lines like these unless there is extremely strong session evidence:

- Encourage independence.
- Be supportive.
- Students should try their best.
- Check in with students regularly.
- Let students be creative.
- Support students if they get stuck.
- Help students troubleshoot.
- Discuss ideas as a class.
- Complete the task pages.
- Make sure students understand the content.

It should also reject cross-domain leakage, for example:

- soldering checks in a pure 3D design session
- printability advice in a pure software setup session
- board/port troubleshooting in a theory-only session
- CAD/chassis-fit advice in a demo or install-only session unless the session evidence clearly supports it

## Example Output Shape

This is the intended internal shape, regardless of how the markdown is authored.

```json
{
  "sessionObjective": [
    "Students will customize Zippy using Tinkercad.",
    "Students can test whether a design idea fits the usable chassis space."
  ],
  "software": ["Tinkercad"],
  "hardware": ["N/A"],
  "highlightAreas": [
    "Make file naming explicit early so students can find the right Tinkercad version quickly during feedback.",
    "Use a quick sketch-and-explain checkpoint before modelling so weak ideas are corrected before students sink time into them."
  ],
  "tasks": [
    {
      "title": "Session 02: Task A",
      "outcome": "Students apply an initial design idea to the Zippy chassis.",
      "reinforce": [
        "Keep the design focused on the chassis rather than unrelated decorative features."
      ],
      "goldenNuggets": [
        "Students who skip sketching usually commit too early to weak proportions."
      ],
      "beginner": "Focus on one clear modification that fits the chassis cleanly.",
      "extension": "Add a second feature only if it still preserves printability and clearance."
    }
  ],
  "commonIssues": [
    {
      "issue": "Students size features by eye, so the model no longer fits the Zippy chassis cleanly.",
      "teacherMove": "Stop the design and have students measure against the chassis or sketch before they continue modelling in Tinkercad."
    }
  ]
}
```

## Open Questions

These need your input before the contract is final.

1. Should `Teacher Focus` remain a rendered line, or should it be removed entirely from the canonical page?
Yes - Teacher focus should be one line after the the bullet list of Main Session Objectives
eg: Teacher focus: Encourage students to discuss their ideas/thoughts with their peers and explain their thinking instead of just asking for direct fixes.

2. Should `Golden nuggets` always appear for every task, or only when there is something genuinely high-value to say?
Golden nuggets by definition is scarce. How often do you find gold? Therefore they are 'invaluable' pieces of information that will occur 'some' of the time and refer to high-value info of interest to other teachers.

3. Should `Differentiation` always be rendered, or only when the task naturally supports it?
Only when the task supports it.

4. Do you want hard length limits per section in the final validation logic?
NO

5. Do you want different contract variants for different session types, or one global contract with session-specific evidence?
I think we can have one contract for the 8 session types but we should break out the following and add to it as we go - maybe put a skeleton set in to start with:
- Skillset Examples
- Failure Patterns By Domain
- Strong Teacher Moves By Domain
- Common Generic Output To Reject

## Recommendation

Keep this markdown file in the repo and treat it as the human contract.

Then implement a runtime layer that maps this contract into:

- validation rules
- prompt instructions
- renderer expectations
- test fixtures

YES I AGREE.
