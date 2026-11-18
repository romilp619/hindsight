#!/usr/bin/env python3
"""Call Hindsight's MCP server (Forge rovo:mcp on mcp.atlassian.com) straight from a terminal.

Uses the OAuth sign-in that Claude Code stored when you ran /mcp -> hindsight -> Authenticate,
so there is no separate login. The token is read locally and never printed.

  hindsight tools                              list the MCP tools Hindsight exposes
  hindsight similar "Add Stripe webhooks"      find similar past work + forecast
  hindsight forecast PAYM-51                   pre-mortem for a Jira work item
  hindsight experts "payment webhooks"         who has done this before
  add --json to any command for the raw MCP response
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

CREDS = os.path.expanduser(os.environ.get("CLAUDE_CONFIG_DIR", "~/.claude-account2")) + "/.credentials.json"
SERVER_NAME = "hindsight"
TOOL_SUFFIX = "_development"  # tool names carry the Forge environment

B, D, R, Y, G, C, X = "\033[1m", "\033[2m", "\033[31m", "\033[33m", "\033[32m", "\033[36m", "\033[0m"


def die(msg):
    print(f"{R}error:{X} {msg}", file=sys.stderr)
    sys.exit(1)


def load_auth():
    try:
        entries = json.load(open(CREDS)).get("mcpOAuth", {})
    except FileNotFoundError:
        die(f"{CREDS} not found. Sign in first: run claude2, then /mcp -> hindsight -> Authenticate.")
    for v in entries.values():
        if v.get("serverName") == SERVER_NAME and v.get("accessToken"):
            if v.get("expiresAt", 0) / 1000 < time.time() + 30:
                die("Hindsight sign-in expired. Run claude2, then /mcp -> hindsight -> Authenticate again.")
            return v["serverUrl"], v["accessToken"]
    die("No Hindsight sign-in found. Run claude2, then /mcp -> hindsight -> Authenticate.")


class Mcp:
    """Minimal MCP Streamable HTTP client (JSON-RPC over POST, JSON or SSE responses)."""

    def __init__(self, url, token):
        self.url, self.token, self.session, self.n = url, token, None, 0

    def _post(self, payload):
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": "2025-06-18",
        }
        if self.session:
            headers["Mcp-Session-Id"] = self.session
        req = urllib.request.Request(self.url, data=json.dumps(payload).encode(), headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                self.session = res.headers.get("Mcp-Session-Id") or self.session
                body = res.read().decode()
                ctype = res.headers.get("Content-Type", "")
        except urllib.error.HTTPError as e:
            if e.code == 401:
                die("Hindsight rejected the sign-in (401). Re-authenticate: claude2 -> /mcp -> hindsight.")
            die(f"HTTP {e.code}: {e.read().decode()[:300]}")
        if not body.strip() or "id" not in payload:
            return None  # notifications get a bare 202 "Accepted"
        if "text/event-stream" in ctype:
            msgs = [json.loads(l[5:]) for l in body.splitlines() if l.startswith("data:") and l[5:].strip()]
            msgs = [m for m in msgs if m.get("id") == payload.get("id")] or msgs
            return msgs[-1] if msgs else None
        return json.loads(body)

    def request(self, method, params=None):
        self.n += 1
        msg = self._post({"jsonrpc": "2.0", "id": self.n, "method": method, "params": params or {}})
        if msg and "error" in msg:
            die(f"{method}: {msg['error'].get('message')}")
        return (msg or {}).get("result")

    def start(self):
        self.request("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "hindsight-cli", "version": "1.0"}})
        self._post({"jsonrpc": "2.0", "method": "notifications/initialized"})
        return self

    def call(self, tool, args):
        res = self.request("tools/call", {"name": tool, "arguments": args})
        text = "".join(c.get("text", "") for c in (res or {}).get("content", []) if c.get("type") == "text")
        if (res or {}).get("isError"):
            die(text)
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return text


def show(r):
    if isinstance(r, str):
        print(r)
        return
    if "error" in r:
        die(r["error"])
    risk = r.get("risk")
    if risk:
        col = {"HIGH": R, "MEDIUM": Y, "LOW": G}.get(risk, "")
        slip = r.get("predictedSlipDays")
        title = f"{r['issueKey']} {r.get('issueSummary', '')}" if r.get("issueKey") else "planned work"
        print(f"\n{B}Hindsight pre-mortem{X} {D}for {title}{X}")
        print(f"{col}{B}{risk} RISK{X}" + (f"  ~{slip} days of slip predicted" if slip else "") +
              f"  {D}({r.get('confidence')} confidence, {r.get('basedOnPastProjects')} past projects){X}")
        if r.get("headline"):
            print(f"\n{r['headline']}")
    if r.get("similarPastWork"):
        print(f"\n{B}What happened last time{X}")
        for s in r["similarPastWork"]:
            o = s["outcome"]
            slip = o.get("slipDays")
            when = f"+{slip}d late" if slip and slip > 0 else "on time"
            inc = f", {len(o['incidents'])} incident(s)" if o.get("incidents") else ""
            print(f"  {C}{s['key']}{X} {s['summary']}  {D}[{o['verdict']}: {when}{inc}]{X}")
            for i in o.get("incidents", []):
                print(f"      {R}!{X} {i}")
    if r.get("lessons"):
        print(f"\n{B}Do this differently{X}")
        for l in r["lessons"]:
            ev = f" {D}({l['evidence']}){X}" if l.get("evidence") else ""
            print(f"  -> {l['title']}{ev}")
    people = r.get("peopleWhoHaveDoneThisBefore") or r.get("experts")
    if people:
        print(f"\n{B}People who've done this before{X}")
        for p in people:
            print(f"  {B}{p['name']}{X} {D}- {p['why']}{X}")
    if r.get("note"):
        print(f"\n{Y}{r['note']}{X}")
    print()


def main(argv):
    raw = "--json" in argv
    argv = [a for a in argv if a != "--json"]
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(__doc__)
        return
    cmd, rest = argv[0], " ".join(argv[1:]).strip()
    url, token = load_auth()
    mcp = Mcp(url, token).start()
    if cmd == "tools":
        for t in (mcp.request("tools/list") or {}).get("tools", []):
            print(f"{B}{t['name']}{X}\n  {D}{t.get('description', '')}{X}")
        return
    if not rest:
        die(f'"{cmd}" needs an argument, e.g. hindsight {cmd} "..."')
    tool, args = {
        "similar": ("find-similar-work", {"description": rest}),
        "forecast": ("get-forecast", {"issueKey": rest}),
        "experts": ("get-experts", {"topic": rest}),
    }.get(cmd, (None, None))
    if not tool:
        die(f"unknown command {cmd!r}. Try: tools, similar, forecast, experts")
    print(f"{D}Calling Hindsight MCP: {tool} ...{X}", file=sys.stderr, flush=True)
    result = mcp.call(tool + TOOL_SUFFIX, args)
    print(json.dumps(result, indent=2)) if raw else show(result)


if __name__ == "__main__":
    main(sys.argv[1:])
