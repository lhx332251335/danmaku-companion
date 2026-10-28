import json, sys
logs = json.load(open(sys.argv[1]))
if isinstance(logs, dict):
    logs = logs.get("entries", [])
for e in sorted(logs, key=lambda e: e["startedAt"]):
    comp = ";".join(f"{c['trigger']}/{c['reason']}:-{c['droppedImages']}" for c in e.get("compaction") or []) or "-"
    s = e["screen"]
    print(e["cycle"], e["status"], f"{e['durationMs']}ms", "req=", e.get("requestBytes"), "hist=", e.get("historyRoundsUsed"), "imgs=", e.get("historyImagesSent"),
          "compact=", comp, "prompt/cached=", e.get("promptTokens"), e.get("cachedInputTokens"), "screen=", s.get("width"), s.get("height"), s.get("sourceName"),
          "|", " / ".join(e["comments"])[:70], (e.get("error") or "")[:160])
