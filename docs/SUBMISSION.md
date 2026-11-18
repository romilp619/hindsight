# Devpost submission draft

**Name:** Hindsight
**Tagline:** Pre-mortems built from your organisation's own history.
**Category:** Apps for Software Teams
**Bonus prizes:** Best Agents (Rovo), Best app with Atlassian MCP, Best apps with Teamwork Graph integration, Best Marketplace published app

## Inspiration
Every engineering org has the same story: a project slips or causes an incident, the retro captures exactly what to do differently,
and six months later another team repeats it. The knowledge exists in Jira and Confluence. It's just never in front of the team at the moment they start.

## What it does
When an Epic is created, Hindsight finds the most similar *finished* work across the site, measures what actually happened to it
(planned vs actual time, slip, bugs, incidents and who fixed them, retro notes) and posts an evidence-based pre-mortem:
risk level, predicted slip, the comparable projects with links, lessons as one-click Jira tasks, and the people who've done it before.
When the epic finishes, Hindsight scores its own forecast.

## How we built it (main technology requirement)
Forge app on Jira:
- `jira:issuePanel` + `jira:projectPage` (UI Kit), `trigger` on issue created/updated
- `rovo:agent` "Hindsight" with a reusable `rovo:skill` (hindsight-premortem) and 4 `action` modules that other agents can invoke
- `rovo:mcp` exposing find-similar-work, get-forecast and get-experts to external AI clients
- Teamwork Graph: reads experts' teams with a persisted Cypher query via `requestTeamworkGraph`, and writes every forecast into the graph with a `graph:connector` (`setObjects`), associated with the epic and the past work it cites
- Forge LLMs (`@forge/llm`, Claude) for re-ranking and lesson writing. Risk numbers are computed in code from Jira data, and anything the model invents is dropped
- Forge KVS for forecasts and accuracy tracking

## Challenges
Making the forecast trustworthy: the LLM only judges relevance and phrasing, while every number is computed from data, and every claim must cite an issue key that we verify.
Making it testable on an empty site: a one-click sample history loader creates real epics, child issues, incidents and retros.

## What's next
Confluence retro pages and JSM incidents as additional memory sources, Bitbucket PR checks, and calibrating the risk model per team using the accuracy loop.

## Testing instructions for judges
1. Install via the installation link: <LINK>
2. Open any Jira software project → sidebar → Hindsight → **Load sample history** (about 1 minute).
3. Create an Epic named "Migrate card payments to Stripe Payment Intents API".
4. Within seconds, see the comment; open the **Hindsight** panel on the epic.
5. Rovo chat → Agents → **Hindsight** → "What went wrong last time we touched payments?"
6. MCP: admin enables Hindsight under Connected apps; endpoint https://mcp.atlassian.com/forge/<APP_ID>

**Video:** <YOUTUBE LINK>
**Marketplace:** <LISTING OR REVIEW TICKET LINK>
