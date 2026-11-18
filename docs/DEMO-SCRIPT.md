# Demo video script (target 4:15, hard limit 5:00)

Record at 1080p. Use a site that already has the sample history loaded, and pre-create nothing else.
Rehearse twice. The trigger comment takes a few seconds; cut the wait in editing.

| Time | Screen | Voice-over |
|---|---|---|
| 0:00–0:20 | Black slide: "Your company already paid for this lesson. Then it forgot." | "Last year our billing migration slipped four weeks and double-charged 1,140 customers. The retro said exactly what to do next time. Nobody read it." |
| 0:20–0:40 | Slide: who it's for | "Hindsight is for engineering managers and tech leads starting new work. It runs a pre-mortem using your organisation's own history: real slips, real incidents, real retros." |
| 0:40–1:30 | Jira: create Epic "Migrate card payments to Stripe Payment Intents API" → comment appears → open Hindsight panel | "I create an epic. Seconds later Hindsight comments: HIGH risk, about 18 days of slip. Here's why: three similar projects. The billing migration was 28 days late with a Sev-2. PayPal slipped 12 days on rounding bugs. Refunds v2 shipped early, because they wrote the test plan first." |
| 1:30–2:05 | Click into an incident link; back; tick lessons → "Add 4 lessons as tasks" → show tasks under epic | "Every claim links to the evidence. And it doesn't stop at a warning: one click turns lessons from past retros into tasks on this epic." |
| 2:05–2:20 | Experts section | "It also tells me who has done this before: Priya fixed the duplicate-charge incident, and her team comes from the Teamwork Graph." |
| 2:20–2:55 | Rovo chat → Hindsight agent: "What went wrong last time we touched payments?" then "add the lessons as tasks" | "The same intelligence is a Rovo agent, and its skill and actions can be reused by any other agent." |
| 2:55–3:30 | Claude Code / Cursor with MCP: "Before I write this PR, ask Hindsight about risks for webhook handling" | "And through MCP it reaches developers where they write code. The AI assistant checks the company's history before it suggests anything." |
| 3:30–3:50 | Project page: stats, "What would history say about…", accuracy column | "When an epic finishes, Hindsight scores its own forecast, so you can see whether to trust it." |
| 3:50–4:10 | Slide: architecture + 4 bonus badges | "Built entirely on Forge: Jira panel, triggers, Rovo agent, skill and actions, rovo:mcp, Forge LLMs, and the Teamwork Graph, read and write. Numbers come from data, never from the model." |
| 4:10–4:15 | Logo slide | "Hindsight: 20/20 vision, before you start." |

Tips
- Say the issue keys out loud; it proves it's real data.
- Show the "AI summary unavailable → data-only forecast" fallback in one quick cut if time allows. Judges value robustness.
- Upload to YouTube as **Public**, not Unlisted.
