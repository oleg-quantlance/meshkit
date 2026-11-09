#!/usr/bin/env python3
"""Inspect or archive feedback messages submitted via meshkit.pro/about#feedback.

Maintainer tool — uses the local Firebase CLI login.

  python3 scripts/feedback.py list               # open feedback items
  python3 scripts/feedback.py list --all         # include archived items
  python3 scripts/feedback.py archive ID [ID…]   # mark archived
"""
import json, os, re, sys, urllib.parse, urllib.request
from datetime import datetime, timezone

sys.dont_write_bytecode = True

PROJECT = "meshkit-e1c10"
COLL = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents/feedbackSubmissions"
API_JS = os.path.expanduser("~/.npm/_npx/ba4f1959e38407b5/node_modules/firebase-tools/lib/api.js")
CFG = os.path.expanduser("~/.config/configstore/firebase-tools.json")


def token():
    src = open(API_JS, encoding="utf-8").read()
    cid = re.search(r'clientId = \(\) => utils\.envOverride\("[^"]+", "([^"]+)"\)', src).group(1)
    csec = re.search(r'clientSecret = \(\) => utils\.envOverride\("[^"]+", "([^"]+)"\)', src).group(1)
    refresh = json.load(open(CFG, encoding="utf-8"))["tokens"]["refresh_token"]
    body = urllib.parse.urlencode(
        {"grant_type": "refresh_token", "refresh_token": refresh, "client_id": cid, "client_secret": csec}
    ).encode()
    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=body,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())["access_token"]


def api(method, url, tok, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, method=method, headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
        return json.loads(raw) if raw.strip() else {}


def unwrap(fields):
    out = {}
    for k, v in (fields or {}).items():
        out[k] = v.get("stringValue", v.get("doubleValue", v.get("integerValue", v.get("booleanValue"))))
    return out


def main():
    args = sys.argv[1:] or ["list"]
    cmd = args[0]
    tok = token()
    if cmd == "list":
        show_all = "--all" in args
        res = api("GET", COLL + "?pageSize=200", tok)
        docs = res.get("documents") or []
        shown = 0
        for d in docs:
            doc_id = d["name"].rsplit("/", 1)[-1]
            f = unwrap(d.get("fields"))
            if not show_all and f.get("status") == "archived":
                continue
            shown += 1
            emailed = "emailed" if f.get("emailedAt") else "pending-email"
            reply = f.get("replyEmail") or "(anonymous)"
            print(f"[{doc_id}] {f.get('clientTime','')} | {f.get('topic','')} | {emailed} | from: {reply}")
            if f.get("toolRef"):
                print(f"  tool: {f['toolRef']}")
            print(f"  {f.get('message','')}\n")
        if shown == 0:
            print("No open feedback items.")
    elif cmd == "archive":
        now = datetime.now(timezone.utc).isoformat()
        for doc_id in args[1:]:
            if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", doc_id):
                raise SystemExit(f"Invalid document ID: {doc_id}")
            url = f"{COLL}/{doc_id}?updateMask.fieldPaths=status&updateMask.fieldPaths=archivedAt"
            api("PATCH", url, tok, {"fields": {"status": {"stringValue": "archived"}, "archivedAt": {"stringValue": now}}})
            print(f"Archived {doc_id}")
    else:
        raise SystemExit("Usage: feedback.py [list [--all] | archive ID ...]")


if __name__ == "__main__":
    main()
