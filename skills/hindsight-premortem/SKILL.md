---
name: hindsight-premortem
description: Run an evidence-based pre-mortem for planned work using the organisation's own delivery history. Finds similar finished projects, reports their measured outcomes (schedule slip, incidents, bugs, retro notes), forecasts risk, lists lessons as actionable tasks, and names people who have done the work before. Use before kickoff, during planning, sprint or PI planning, or whenever someone asks "have we done this before?" or "what could go wrong?".
allowed-tools: find-similar-work get-forecast get-experts
---

# Hindsight pre-mortem

Use this skill to answer "what will probably go wrong with this work, based on what happened last time?".

## Steps

1. Identify the work.
   - Existing Jira work item (key such as `PAY-123`, or the issue in context): call `get-forecast`.
   - Work described in words: call `find-similar-work` with a one or two sentence description.
2. Read the result:
   - `risk` (HIGH / MEDIUM / LOW / UNKNOWN), `predictedSlipDays`, `confidence`, `basedOnPastProjects`
   - `similarPastWork[]` with measured `outcome` (verdict, slipDays, bugs, incidents, retro)
   - `lessons[]` and `peopleWhoHaveDoneThisBefore[]`
3. If the user wants owners or advisors, call `get-experts` with the topic.

## Output format

- **Verdict**: one sentence with risk, predicted slip and confidence.
- **Last time**: up to three bullets: `KEY – summary – what happened` (numbers and incidents).
- **Do this differently**: three to five imperative lessons, each citing the issue key it came from.
- **Ask**: people who led or fixed similar work.

## Guardrails

- Only report facts returned by the tools. Cite issue keys for every claim.
- If `confidence` is low or `basedOnPastProjects` < 2, say the forecast is tentative.
- Never create tasks from this skill; the agent's `add-lessons-as-tasks` action does that, and only with user consent.
