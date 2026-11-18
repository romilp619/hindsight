# Devpost submission

**Project name:** Hindsight
**Elevator pitch (tagline):** Pre-mortems built from your organisation's own history: before new work starts, Hindsight shows what happened last time, and turns past mistakes into tasks.
**Category:** Apps for Software Teams
**Bonus prizes:** Best Agents (Rovo / assignable agents) · Best app with Atlassian MCP · Best apps with Teamwork Graph integration

---

## Inspiration
Every engineering organisation has the same story. A project slips or causes an incident, the retro captures exactly what to do differently,
and six months later another team repeats it. The knowledge already exists in Jira. It just isn't in front of the team at the moment they start new work.

## What it does
When an epic is created, Hindsight finds the most similar **finished** work on the site and measures what actually happened to it: planned vs actual time,
schedule slip, bugs, incidents and who fixed them, and the retro notes. Seconds later it comments on the new epic with an evidence-based pre-mortem:

- **Risk level and predicted slip**, computed from real outcomes, with a confidence level
- **What happened last time**: the comparable past projects, with links to their incidents
- **Lessons → tasks**: one click turns lessons from past retros into Jira tasks under the epic
- **People who've done this before**: who led similar work or fixed its incidents
- **A learning loop**: when the epic is done, Hindsight scores its own forecast and tracks accuracy

The same intelligence is available as a **Rovo agent** ("What went wrong last time we touched payments?") and through an **MCP server**, so AI assistants
such as Claude, Cursor or Codex can check the company's history before writing code.

## How we built it
A Forge app for Jira that **runs on Atlassian** (no external servers):

- **Jira surfaces:** `jira:issuePanel` and `jira:projectPage` (UI Kit), plus `trigger` modules on issue created/updated for the automatic pre-mortem and the accuracy loop
- **Rovo:** `rovo:agent` "Hindsight" with a reusable `rovo:skill` (`hindsight-premortem`) and 4 `action` modules (find similar work, get forecast, get experts, add lessons as tasks) that other agents can invoke
- **MCP:** `rovo:mcp` exposes the read-only tools (find-similar-work, get-forecast, get-experts) through Atlassian's MCP server; verified end to end from an external client
- **Teamwork Graph:** Teamwork Graph read scopes for users and teams, a persisted Cypher query to enrich experts with their Atlassian teams, and a `graph:connector` that writes each forecast into the graph as an object associated with the epic and the past work it cites (active once a site admin adds the connection)
- **AI:** Forge LLMs (`@forge/llm`, Atlassian-hosted Claude) re-ranks candidates and writes the lessons. Every number is computed in code from Jira data, every claim must cite a real issue key, and anything the model invents is dropped. If the model is unavailable, Hindsight still produces a full data-only forecast
- **Matching:** TF-IDF similarity with business-domain filtering, so payments work is compared with payments work rather than any project containing the word "migration"
- **Storage:** Forge KVS for forecasts, added-task tracking and accuracy

## Challenges we ran into
- **Making the forecast trustworthy.** Our first version let the model pick an unrelated "OAuth2 migration" as evidence for a payments epic. We fixed this in code with domain filtering and by never letting the model produce numbers.
- **Testing on an empty site.** Judges' sites have no history, so we built a one-click sample-history loader that creates 12 real finished epics with child issues, incidents and retro comments.
- **Rovo on developer sites.** Free developer sites don't include Rovo chat, so we tested the agent on a Forge demo site.

## Accomplishments that we're proud of
- A complete loop inside Jira: detect → explain with evidence → act (tasks) → learn (accuracy)
- The same forecast from three surfaces: the Jira panel, a Rovo agent and an MCP server
- Runs on Atlassian, with a deterministic fallback when the AI is unavailable

## What we learned
Teams don't need more dashboards. They need the right piece of history at the moment they make a decision, with evidence they can click.

## What's next for Hindsight
Confluence retro pages and JSM incidents as more memory sources, Bitbucket pull-request checks, per-team calibration from the accuracy loop, and a Marketplace listing.

---

## Testing instructions for judges
1. Install Hindsight with the installation link (see `INSTALL-LINK.txt`) on a Jira site where you're an admin.
2. Open any Jira **software** space → **Hindsight** tab → **Load sample history** (about 1 minute; creates 12 finished sample epics).
3. Create an **Epic** named "Move checkout card payments to Stripe Payment Intents".
4. Within about 20 seconds Hindsight comments on the epic. Open the full forecast with the **Apps (⬡) button under the title → Hindsight**.
5. Click **Add 5 lessons as tasks** → tasks appear under **Child work items** (refresh the page).
6. **Rovo** (sites with Rovo enabled): Ask Rovo → agent picker → **Hindsight** → "What went wrong last time we touched payments?"
7. **MCP:** admin.atlassian.com → Apps → Sites → your site → Connected apps → Hindsight → View app details → **Tools → Enable tools**. Endpoint: `https://mcp.atlassian.com/forge/c01bdc09-a28c-4c76-9751-a77dd264f422`
8. **Teamwork Graph (optional):** same app page → Connections → Teamwork Graph connectors → **Hindsight → Connect**.

**Built with:** atlassian-forge, jira, rovo, mcp, teamwork-graph, forge-llms, javascript, react, ui-kit, node.js
