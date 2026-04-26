# Teacher Notes Contract

Status: draft  
Owner: Nexgen curriculum / delivery  
Implementation target: `teacher-notes` command and `/teacher-notes` agent route

## Purpose

This document defines the fixed structure, meaning, and constraints for Nexgen Teacher Notes.

The goal is to make Teacher Notes:

- consistent in structure across sessions
- genuinely useful to a busy teacher in class
- grounded in the real session content
- concise enough to read quickly
- specific enough to prevent wasted student time

This contract is the human-authored source of truth.

The agent should not invent its own structure.
The renderer should not infer meaning.
The CLI should validate output against this contract before publishing.

## Core Principle

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

## Global Rules

These rules apply to the whole page.

### Must

- Use the fixed headings and section order.
- Stay grounded in the actual session pages and task structure.
- Prefer concrete checks over generic pedagogy.
- Prefer short, high-value lines over padded prose.
- Use teacher-facing wording everywhere except `Main Session Objective`.
- Make each line sound session-specific, not reusable boilerplate.

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
- `N/A` for hardware when the session is purely digital or conceptual

#### Forbidden Content

- generic school equipment
- speculative components not present in the session
- long explanatory notes

#### Format Rules

- split into `Software` and `Hardware`
- software: 0 to 6 items
- hardware: 0 to 10 items
- if no hardware is genuinely required, use `N/A`

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
- Golden nuggets
- Differentiation

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

Small, high-leverage teacher insights that prevent wasted time or reveal a hidden issue.

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
2. Should `Golden nuggets` always appear for every task, or only when there is something genuinely high-value to say?
3. Should `Differentiation` always be rendered, or only when the task naturally supports it?
4. Do you want hard length limits per section in the final validation logic?
5. Do you want different contract variants for different session types, or one global contract with session-specific evidence?

## Recommendation

Keep this markdown file in the repo and treat it as the human contract.

Then implement a runtime layer that maps this contract into:

- validation rules
- prompt instructions
- renderer expectations
- test fixtures
