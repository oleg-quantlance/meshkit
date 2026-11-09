#!/usr/bin/env python3
"""Moderate community spool submissions and merge approved ones into
src/data/spools.json, then regenerate the brand pages.

Maintainer tool — uses the local Firebase CLI login (oleg@quantlance.com).

  python3 scripts/import-spool-submissions.py list              # pending submissions
  python3 scripts/import-spool-submissions.py approve ID [ID…]  # mark approved + merge
  python3 scripts/import-spool-submissions.py reject ID [ID…]   # mark rejected
  python3 scripts/import-spool-submissions.py sync              # merge everything already approved

Approved docs get `status: approved`, `spoolId` (matched or new) and
`importedAt`; they are never deleted so the audit trail stays in Firestore.
"""
import json, os, re, statistics, subprocess, sys, urllib.parse, urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECT = "meshkit-e1c10"
COLL = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents/spoolSubmissions"
API_JS = os.path.expanduser("~/.npm/_npx/ba4f1959e38407b5/node_modules/firebase-tools/lib/api.js")
CFG = os.path.expanduser("~/.config/configstore/firebase-tools.json")


def token():
    src = open(API_JS).read()
    cid = re.search(r'clientId = \(\) => utils\.envOverride\("[^"]+", "([^"]+)"\)', src).group(1)
    csec = re.search(r'clientSecret = \(\) => utils\.envOverride\("[^"]+", "([^"]+)"\)', src).group(1)
    refresh = json.load(open(CFG))["tokens"]["refresh_token"]
    body = urllib.parse.urlencode({"grant_type": "refresh_token", "refresh_token": refresh, "client_id": cid, "client_secret": csec}).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body, method="POST", headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())["access_token"]


def api(method, url, tok, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            t = r.read()
            return r.status, (json.loads(t) if t.strip() else {})
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def unwrap(fields):
    out = {}
    for k, v in (fields or {}).items():
        out[k] = v.get("stringValue", v.get("doubleValue", v.get("integerValue", v.get("booleanValue"))))
        if "integerValue" in v:
            out[k] = int(v["integerValue"])
    return out


def list_docs(tok):
    docs, page = [], None
    while True:
        url = COLL + "?pageSize=300" + (f"&pageToken={page}" if page else "")
        st, r = api("GET", url, tok)
        if st != 200:
            sys.exit(f"list failed: {st} {json.dumps(r)[:200]}")
        for d in r.get("documents", []):
            row = unwrap(d.get("fields"))
            row["_id"] = d["name"].split("/")[-1]
            row["_created"] = d.get("createTime", "")
            docs.append(row)
        page = r.get("nextPageToken")
        if not page:
            break
    return docs


def set_status(tok, doc_id, status, extra=None):
    fields = {"status": {"stringValue": status}, "importedAt": {"stringValue": date.today().isoformat()}}
    for k, v in (extra or {}).items():
        fields[k] = {"stringValue": str(v)}
    mask = "&".join(f"updateMask.fieldPaths={k}" for k in fields)
    st, r = api("PATCH", f"{COLL}/{doc_id}?{mask}", tok, {"fields": fields})
    if st != 200:
        sys.exit(f"update {doc_id} failed: {st} {json.dumps(r)[:200]}")


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def merge(sub, data):
    """Attach a measurement to the best-matching spool or create a new row."""
    brand = sub["brand"].strip()
    line = (sub.get("line") or "").strip()
    mat = {"plastic": "Plastic", "cardboard": "Cardboard"}.get(sub.get("spoolMaterial"), "Other")
    net = int(float(sub.get("netG") or 1000))
    maker = next((m for m in data["makers"] if m["name"].lower().split(" (")[0] in brand.lower() or brand.lower() in m["name"].lower()), None)
    measurement = {"tareG": float(sub["tareG"]), "source": "community", "date": (sub.get("_created") or date.today().isoformat())[:10]}
    if sub.get("credit"):
        measurement["credit"] = sub["credit"][:40]
    if sub.get("note"):
        measurement["note"] = sub["note"][:280]

    # Match: same maker (or brand text), same core material, same net weight, and line keyword overlap.
    candidates = [s for s in data["spools"] if s.get("material") == mat and int(s.get("netG", 1000)) == net and ((maker and s.get("maker") == maker["slug"]) or brand.lower() in s["brand"].lower())]
    if line and candidates:
        kw = set(re.findall(r"[a-z0-9+]+", line.lower()))
        scored = sorted(candidates, key=lambda s: -len(kw & set(re.findall(r"[a-z0-9+]+", (s["line"] + " " + s["brand"]).lower()))))
        candidates = scored[:1]
    if candidates:
        target = candidates[0]
    else:
        slug_base = slugify(f"{brand} {line or mat} {net}")
        target = {
            "id": slug_base,
            "maker": maker["slug"] if maker else None,
            "brand": f"{brand}{' ' + line if line else ''}"[:80],
            "line": line or f"{mat} spool {net} g",
            "material": mat,
            "netG": net,
            "tareG": 0,
            "measurements": [],
        }
        data["spools"].append(target)
        if not maker:
            data["makers"].append({"slug": slugify(brand), "name": brand, "note": "Community-submitted brand; details pending."})
            target["maker"] = slugify(brand)
    target.setdefault("measurements", []).append(measurement)
    target["tareG"] = round(statistics.median([m["tareG"] for m in target["measurements"]]))
    return target["id"]


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "list"
    tok = token()
    docs = list_docs(tok)
    pending = [d for d in docs if not d.get("status")]
    if cmd == "list":
        print(f"{len(docs)} total, {len(pending)} pending")
        for d in pending:
            print(f"  {d['_id']}  {d['_created'][:16]}  {d['brand']} | {d.get('line','')} | {d['spoolMaterial']} | tare {d['tareG']} g / net {d['netG']} g | scale: {d.get('scale','')} | {d.get('credit','')} | {d.get('note','')[:60]}")
        return
    if cmd == "reject":
        for i in sys.argv[2:]:
            set_status(tok, i, "rejected")
            print("rejected", i)
        return
    data = json.loads((ROOT / "src/data/spools.json").read_text())
    if cmd == "approve":
        ids = set(sys.argv[2:])
        chosen = [d for d in pending if d["_id"] in ids]
    elif cmd == "sync":
        chosen = [d for d in docs if d.get("status") == "approved" and not d.get("spoolId")]
    else:
        sys.exit(__doc__)
    if not chosen:
        print("nothing to merge")
        return
    for d in chosen:
        sid = merge(d, data)
        set_status(tok, d["_id"], "approved", {"spoolId": sid})
        print(f"merged {d['_id']} → {sid}")
    data["lastVerified"] = date.today().isoformat()
    (ROOT / "src/data/spools.json").write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    subprocess.run([sys.executable, str(ROOT / "scripts/gen-spool-pages.py")], check=True)
    print("spools.json updated and pages regenerated — review `git diff`, then commit.")


if __name__ == "__main__":
    main()
