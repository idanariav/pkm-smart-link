"""Scores the installed Smart Link plugin against eval/queries.json via `obsidian eval`.
Requires Obsidian running with the plugin enabled (build + copy main.js, then plugin:reload).
Usage: python3 -I eval/run_eval.py [--k 10] [--save eval/baseline.json] [--compare eval/baseline.json]"""
import argparse, json, os, subprocess

ap = argparse.ArgumentParser()
ap.add_argument("--k", type=int, default=10)
ap.add_argument("--save"); ap.add_argument("--compare")
ap.add_argument("--collection", default="claims", help="collection filter, as in the modal (default: claims)")
ap.add_argument("--tuning", default="{}", help="JSON of Tuning overrides, e.g. '{\"expandFactor\":0}'")
ap.add_argument("--quiet", action="store_true")
ap.add_argument("--set", default="queries.json", help="query set file in eval/ (queries.json or nouns.json)")
a = ap.parse_args()
here = os.path.dirname(os.path.abspath(__file__))
cases = json.load(open(os.path.join(here, a.set)))

def search(q):
    code = f"JSON.stringify(app.plugins.plugins['pkm-smart-link'].search({json.dumps(q)}, {json.dumps(a.collection)}, {a.tuning}))"
    r = subprocess.run(["obsidian", "eval", f"code={code}"], capture_output=True, text=True)
    line = next(l for l in r.stdout.splitlines() if l.startswith("=>"))
    return json.loads(line[2:].strip())

rows = []
for c in cases:
    res = search(c["query"]); exp = set(c["expected"]); top = res[:a.k]
    hits = [i for i, t in enumerate(res) if t in exp]
    blind = set(c["lexically_blind"])
    rows.append({
        "query": c["query"], "returned": len(res),
        "recall": len(exp & set(top)) / len(exp),
        "precision": len(exp & set(top)) / a.k,
        "blind_recall": len(blind & set(top)) / len(blind) if blind else None,
        "first_hit": hits[0] + 1 if hits else None,
        "found_any_rank": len(hits),
    })
avg = lambda k: sum(r[k] for r in rows if r[k] is not None) / max(1, sum(r[k] is not None for r in rows))
summary = {"k": a.k, "recall": avg("recall"), "precision": avg("precision"),
           "blind_recall": avg("blind_recall"), "mrr": sum(1 / r["first_hit"] for r in rows if r["first_hit"]) / len(rows),
           "avg_returned": avg("returned")}
base = json.load(open(a.compare))["summary"] if a.compare else None
if not a.quiet: print(f"{'query':22} {'ret':>4} {'R@k':>5} {'P@k':>5} {'blindR':>6} {'1st':>4}")
for r in ([] if a.quiet else rows):
    br = "-" if r["blind_recall"] is None else f"{r['blind_recall']:.2f}"
    print(f"{r['query']:22} {r['returned']:>4} {r['recall']:>5.2f} {r['precision']:>5.2f} {br:>6} {str(r['first_hit'] or '-'):>4}")
print("\nSUMMARY", {k: round(v, 3) for k, v in summary.items()})
if base: print("BASELINE", {k: round(v, 3) for k, v in base.items()})
if a.save: json.dump({"summary": summary, "rows": rows}, open(a.save, "w"), indent=1)
