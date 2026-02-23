#!/usr/bin/env python3
"""
Optimize location score (입지점수) weights via OLS regression.
Target: R² >= 0.75 against log(price per m²) for 84m² type apartments.

Key insight: household_score is only available for ~6K apts (7.5%),
so we run two tracks:
  Part A: 수도권 only (경기/서울/인천) with commute features (~1.7K with household_score)
  Part B: All sidos, excluding household_score (~23K apts)
"""

import json
import os
import numpy as np

# ── Paths ──────────────────────────────────────────────────────────────
BASE = "/Users/hanjin/landprice/docs/data/apt_trade"
GEO_PATH = os.path.join(BASE, "valuation_geo.json")
SEARCH_DIR = os.path.join(BASE, "search")

# ── 1. Load data ──────────────────────────────────────────────────────
print("=" * 72)
print("  LOCATION SCORE OPTIMIZATION — OLS Regression Analysis")
print("=" * 72)

with open(GEO_PATH) as f:
    geo_data = json.load(f)
print(f"\n  valuation_geo.json: {len(geo_data):,} apartments")

# Load all search files, filter 84-type (80-90 m²)
all_records = []
for fn in sorted(os.listdir(SEARCH_DIR)):
    if not fn.endswith(".json"):
        continue
    sido = fn.replace(".json", "")
    with open(os.path.join(SEARCH_DIR, fn)) as f:
        data = json.load(f)
    items = data.get("items", data if isinstance(data, list) else [])
    for it in items:
        area = it.get("area_m2", 0)
        if 80 <= area <= 90:
            apt_id = it["id"]
            if apt_id in geo_data:
                price = it["latest_price"]
                price_per_m2 = price / area
                if price_per_m2 > 0:
                    all_records.append({
                        "apt_id": apt_id,
                        "sido": sido,
                        "sigungu": it.get("sigungu", it.get("district", "")),
                        "price_per_m2": price_per_m2,
                        "area_m2": area,
                    })

print(f"  84-type matched records: {len(all_records):,}")
print(f"  Sido distribution:")
from collections import Counter
sido_counts = Counter(r["sido"] for r in all_records)
for s in sorted(sido_counts):
    print(f"    {s}: {sido_counts[s]:,}")


# ── OLS helper ────────────────────────────────────────────────────────
def ols(X, y, names):
    """OLS with intercept. Returns dict with beta, r2, adj_r2, se, t_stats."""
    n, k = X.shape
    X1 = np.hstack([np.ones((n, 1)), X])
    try:
        XtX = X1.T @ X1
        beta = np.linalg.solve(XtX, X1.T @ y)
    except np.linalg.LinAlgError:
        return None
    y_hat = X1 @ beta
    ss_res = np.sum((y - y_hat) ** 2)
    ss_tot = np.sum((y - np.mean(y)) ** 2)
    r2 = 1 - ss_res / ss_tot
    adj_r2 = 1 - (1 - r2) * (n - 1) / (n - k - 1)
    sigma2 = ss_res / (n - k - 1)
    try:
        se = np.sqrt(np.diag(sigma2 * np.linalg.inv(XtX)))
    except:
        se = np.full(k + 1, np.nan)
    t_stats = beta / se
    return {
        "beta": beta, "r2": r2, "adj_r2": adj_r2, "se": se,
        "t_stats": t_stats, "n": n, "k": k,
        "names": ["intercept"] + list(names),
    }

def show(res, title="", max_features=None):
    """Pretty-print regression."""
    if title:
        print(f"\n{'─' * 72}")
        print(f"  {title}")
        print(f"{'─' * 72}")
    print(f"  N = {res['n']:,}  |  k = {res['k']}  |  R² = {res['r2']:.4f}  |  Adj R² = {res['adj_r2']:.4f}")
    print(f"  {'Feature':<28s} {'Coeff':>10s} {'SE':>10s} {'t':>8s}")
    print(f"  {'─'*28} {'─'*10} {'─'*10} {'─'*8}")
    limit = max_features + 1 if max_features else len(res["names"])
    for i in range(min(limit, len(res["names"]))):
        name = res["names"][i]
        t = res["t_stats"][i]
        sig = "***" if abs(t) > 2.576 else "**" if abs(t) > 1.96 else "*" if abs(t) > 1.645 else ""
        print(f"  {name:<28s} {res['beta'][i]:>10.4f} {res['se'][i]:>10.4f} {t:>7.2f} {sig}")
    if max_features and limit < len(res["names"]):
        print(f"  ... ({len(res['names']) - limit} more dummy variables omitted)")

def make_dummies(labels):
    """Create dummy variables, dropping first category."""
    unique = sorted(set(labels))
    D = np.zeros((len(labels), len(unique) - 1))
    for i, s in enumerate(labels):
        idx = unique.index(s)
        if idx > 0:
            D[i, idx - 1] = 1.0
    names = [f"d_{s}" for s in unique[1:]]
    return D, names, unique[0]


# ══════════════════════════════════════════════════════════════════════
# PART B: Full dataset (all sidos, no household_score / commute)
# ══════════════════════════════════════════════════════════════════════
print()
print("=" * 72)
print("  PART B: FULL DATASET (all 9 sidos)")
print("=" * 72)

CORE_FEATURES = [
    "subway_dist", "subway_walk_min",
    "infra_score", "academy_score",
    "brand_score", "age_score",
    "liquidity_score", "livability_score",
]

def get_core(apt_id):
    g = geo_data[apt_id]
    vals = []
    for f in CORE_FEATURES:
        v = g.get(f)
        if v is None:
            return None
        vals.append(float(v))
    return vals

y_list, X_list, sido_list, sigungu_list = [], [], [], []
for rec in all_records:
    vals = get_core(rec["apt_id"])
    if vals is None:
        continue
    y_list.append(np.log(rec["price_per_m2"]))
    X_list.append(vals)
    sido_list.append(rec["sido"])
    sigungu_list.append(rec["sigungu"])

y = np.array(y_list)
X = np.array(X_list)
print(f"  Valid samples: {len(y):,}")
print(f"  Core features: {CORE_FEATURES}")

sido_D, sido_Dnames, sido_ref = make_dummies(sido_list)
sigungu_D, sigungu_Dnames, sigungu_ref = make_dummies(sigungu_list)
print(f"  Sido ref: {sido_ref} | Sigungu ref: {sigungu_ref}")

# --- B0: Baseline — current loc_score only ---
loc_scores = np.array([geo_data[r["apt_id"]].get("loc_score", 50) for r in all_records
                        if get_core(r["apt_id"]) is not None])
res_b0 = ols(loc_scores.reshape(-1, 1), y, ["loc_score_current"])
show(res_b0, "B0: Current loc_score only")

# --- B1: Core features + sido ---
X_b1 = np.hstack([X, sido_D])
res_b1 = ols(X_b1, y, CORE_FEATURES + sido_Dnames)
show(res_b1, "B1: Core features + sido dummies")

# --- B2: Log transforms + quadratic + interactions ---
sw_dist = X[:, 0]
sw_walk = X[:, 1]
infra   = X[:, 2]
acad    = X[:, 3]
brand   = X[:, 4]
age     = X[:, 5]
liq     = X[:, 6]
liv     = X[:, 7]

X_nl = np.column_stack([
    np.log1p(sw_dist),       # log subway distance
    np.log1p(sw_walk),       # log subway walk minutes
    infra,                    # infra score
    acad,                     # academy score
    acad ** 2 / 100,          # academy quadratic
    brand,
    age,
    age ** 2 / 100,           # age quadratic
    liq,
    liv,
    acad * infra / 100,       # academy × infra interaction
])
nl_names = [
    "log_subway_dist", "log_subway_walk",
    "infra_score", "academy_score", "academy_sq",
    "brand_score", "age_score", "age_sq",
    "liquidity_score", "livability_score",
    "acad_x_infra",
]

X_b2 = np.hstack([X_nl, sido_D])
res_b2 = ols(X_b2, y, nl_names + sido_Dnames)
show(res_b2, "B2: Nonlinear features + sido dummies")

# --- B3: Extended nonlinear ---
X_nl2 = np.column_stack([
    np.log1p(sw_dist),
    np.log1p(sw_walk),
    sw_walk ** 2 / 100,       # walk quadratic
    infra,
    infra ** 2 / 100,
    acad,
    acad ** 2 / 100,
    brand,
    brand ** 2 / 100,
    age,
    age ** 2 / 100,
    liq,
    liq ** 2 / 100,
    liv,
    acad * infra / 100,
    acad * np.log1p(sw_walk),
    age * brand / 100,
    infra * np.log1p(sw_dist),
])
nl2_names = [
    "log_subway_dist", "log_subway_walk", "walk_sq",
    "infra_score", "infra_sq",
    "academy_score", "academy_sq",
    "brand_score", "brand_sq",
    "age_score", "age_sq",
    "liquidity_score", "liquidity_sq",
    "livability_score",
    "acad_x_infra", "acad_x_log_walk",
    "age_x_brand", "infra_x_log_dist",
]

X_b3 = np.hstack([X_nl2, sido_D])
res_b3 = ols(X_b3, y, nl2_names + sido_Dnames)
show(res_b3, "B3: Extended nonlinear + sido dummies")

# --- B4: Sigungu dummies instead of sido ---
X_b4 = np.hstack([X_nl, sigungu_D])
res_b4 = ols(X_b4, y, nl_names + sigungu_Dnames)
show(res_b4, "B4: Nonlinear features + SIGUNGU dummies", max_features=len(nl_names))

# --- B5: Extended nonlinear + sigungu ---
X_b5 = np.hstack([X_nl2, sigungu_D])
res_b5 = ols(X_b5, y, nl2_names + sigungu_Dnames)
show(res_b5, "B5: Extended nonlinear + SIGUNGU dummies", max_features=len(nl2_names))

# --- B6: Forward selection with sido dummies ---
print(f"\n{'=' * 72}")
print("  Forward Selection (with sido dummies always included)")
print("=" * 72)

available = list(range(X_nl2.shape[1]))
selected = []
for step in range(len(available)):
    best_adj_r2 = -np.inf
    best_f = None
    for f in [x for x in available if x not in selected]:
        trial = selected + [f]
        X_trial = np.hstack([X_nl2[:, trial], sido_D])
        trial_names = [nl2_names[i] for i in trial] + sido_Dnames
        res = ols(X_trial, y, trial_names)
        if res and res["adj_r2"] > best_adj_r2:
            best_adj_r2 = res["adj_r2"]
            best_f = f
            best_res = res
    if best_f is not None:
        selected.append(best_f)
        marker = " ** R² >= 0.75" if best_res["r2"] >= 0.75 else ""
        print(f"  Step {step+1:2d}: + {nl2_names[best_f]:<22s} R²={best_res['r2']:.4f}  Adj R²={best_res['adj_r2']:.4f}{marker}")
        if len(selected) >= 12 and best_adj_r2 - (best_adj_r2 if step == 0 else 0) < 0.0001:
            break  # diminishing returns

# Print selected model
X_sel = np.hstack([X_nl2[:, selected], sido_D])
sel_names = [nl2_names[i] for i in selected] + sido_Dnames
res_sel = ols(X_sel, y, sel_names)
show(res_sel, "Forward Selection Best Model + sido")


# ══════════════════════════════════════════════════════════════════════
# PART A: 수도권 with commute features
# ══════════════════════════════════════════════════════════════════════
print()
print("=" * 72)
print("  PART A: 수도권 (경기/서울/인천) WITH COMMUTE FEATURES")
print("=" * 72)

FULL_FEATURES = CORE_FEATURES + [
    "biz_gangnam", "biz_gwanghwamun", "biz_yeouido",
    "commute_gangnam", "commute_gwanghwamun", "commute_yeouido",
    "household_score",
]

def get_full(apt_id):
    g = geo_data[apt_id]
    vals = []
    for f in CORE_FEATURES:
        v = g.get(f)
        if v is None:
            return None
        vals.append(float(v))
    for f in ["biz_gangnam", "biz_gwanghwamun", "biz_yeouido"]:
        v = g.get(f)
        if v is None:
            return None
        vals.append(float(v))
    commute = g.get("commute", {})
    for c in ["gangnam", "gwanghwamun", "yeouido"]:
        v = commute.get(c)
        if v is None:
            return None
        vals.append(float(v))
    v = g.get("household_score")
    if v is None:
        return None
    vals.append(float(v))
    return vals

ya_list, Xa_list, sidoa_list = [], [], []
metro_sidos = {"경기", "서울", "인천"}
for rec in all_records:
    if rec["sido"] not in metro_sidos:
        continue
    vals = get_full(rec["apt_id"])
    if vals is None:
        continue
    ya_list.append(np.log(rec["price_per_m2"]))
    Xa_list.append(vals)
    sidoa_list.append(rec["sido"])

ya = np.array(ya_list)
Xa = np.array(Xa_list)
print(f"  Valid samples: {len(ya):,}")
sidoa_D, sidoa_Dnames, sidoa_ref = make_dummies(sidoa_list)

# A1: All features + sido
X_a1 = np.hstack([Xa, sidoa_D])
res_a1 = ols(X_a1, ya, FULL_FEATURES + sidoa_Dnames)
show(res_a1, "A1: All features + sido dummies")

# A2: Full kitchen sink
sw_dist_a = Xa[:, 0]; sw_walk_a = Xa[:, 1]
infra_a = Xa[:, 2]; acad_a = Xa[:, 3]
brand_a = Xa[:, 4]; age_a = Xa[:, 5]
liq_a = Xa[:, 6]; liv_a = Xa[:, 7]
biz_gn_a = Xa[:, 8]; biz_gw_a = Xa[:, 9]; biz_yo_a = Xa[:, 10]
com_gn_a = Xa[:, 11]; com_gw_a = Xa[:, 12]; com_yo_a = Xa[:, 13]
hh_a = Xa[:, 14]
min_com_a = np.minimum(np.minimum(com_gn_a, com_gw_a), com_yo_a)

Xa_nl = np.column_stack([
    np.log1p(sw_dist_a), np.log1p(sw_walk_a),
    np.log1p(biz_gn_a), np.log1p(biz_gw_a), np.log1p(biz_yo_a),
    np.log1p(com_gn_a), np.log1p(com_gw_a), np.log1p(com_yo_a),
    np.log1p(min_com_a),
    infra_a, infra_a ** 2 / 100,
    acad_a, acad_a ** 2 / 100,
    brand_a, age_a, age_a ** 2 / 100,
    hh_a, liq_a, liv_a,
    acad_a * infra_a / 100,
    min_com_a * acad_a / 100,
])
Xa_nl_names = [
    "log_sw_dist", "log_sw_walk",
    "log_biz_gn", "log_biz_gw", "log_biz_yo",
    "log_com_gn", "log_com_gw", "log_com_yo", "log_min_com",
    "infra", "infra_sq",
    "acad", "acad_sq",
    "brand", "age", "age_sq",
    "household", "liquidity", "livability",
    "acad_x_infra", "min_com_x_acad",
]

X_a2 = np.hstack([Xa_nl, sidoa_D])
res_a2 = ols(X_a2, ya, Xa_nl_names + sidoa_Dnames)
show(res_a2, "A2: Kitchen sink + sido dummies")


# ══════════════════════════════════════════════════════════════════════
# PART C: 수도권 WITHOUT household_score (larger sample)
# ══════════════════════════════════════════════════════════════════════
print()
print("=" * 72)
print("  PART C: 수도권 WITHOUT household_score (larger sample)")
print("=" * 72)

METRO_FEATURES = CORE_FEATURES + [
    "biz_gangnam", "biz_gwanghwamun", "biz_yeouido",
    "commute_gangnam", "commute_gwanghwamun", "commute_yeouido",
]

def get_metro(apt_id):
    g = geo_data[apt_id]
    vals = []
    for f in CORE_FEATURES:
        v = g.get(f)
        if v is None:
            return None
        vals.append(float(v))
    for f in ["biz_gangnam", "biz_gwanghwamun", "biz_yeouido"]:
        v = g.get(f)
        if v is None:
            return None
        vals.append(float(v))
    commute = g.get("commute", {})
    for c in ["gangnam", "gwanghwamun", "yeouido"]:
        v = commute.get(c)
        if v is None:
            return None
        vals.append(float(v))
    return vals

yc_list, Xc_list, sidoc_list, sigunguc_list = [], [], [], []
for rec in all_records:
    if rec["sido"] not in metro_sidos:
        continue
    vals = get_metro(rec["apt_id"])
    if vals is None:
        continue
    yc_list.append(np.log(rec["price_per_m2"]))
    Xc_list.append(vals)
    sidoc_list.append(rec["sido"])
    sigunguc_list.append(rec["sigungu"])

yc = np.array(yc_list)
Xc = np.array(Xc_list)
print(f"  Valid samples: {len(yc):,}")

sidoc_D, sidoc_Dnames, sidoc_ref = make_dummies(sidoc_list)
sigunguc_D, sigunguc_Dnames, sigunguc_ref = make_dummies(sigunguc_list)

# C1: Linear + sido
X_c1 = np.hstack([Xc, sidoc_D])
res_c1 = ols(X_c1, yc, METRO_FEATURES + sidoc_Dnames)
show(res_c1, "C1: Metro features + sido dummies")

# C2: Nonlinear + sido
sw_dist_c = Xc[:, 0]; sw_walk_c = Xc[:, 1]
infra_c = Xc[:, 2]; acad_c = Xc[:, 3]
brand_c = Xc[:, 4]; age_c = Xc[:, 5]
liq_c = Xc[:, 6]; liv_c = Xc[:, 7]
biz_gn_c = Xc[:, 8]; biz_gw_c = Xc[:, 9]; biz_yo_c = Xc[:, 10]
com_gn_c = Xc[:, 11]; com_gw_c = Xc[:, 12]; com_yo_c = Xc[:, 13]
min_com_c = np.minimum(np.minimum(com_gn_c, com_gw_c), com_yo_c)

Xc_nl = np.column_stack([
    np.log1p(sw_dist_c), np.log1p(sw_walk_c),
    np.log1p(biz_gn_c), np.log1p(biz_gw_c), np.log1p(biz_yo_c),
    np.log1p(com_gn_c), np.log1p(com_gw_c), np.log1p(com_yo_c),
    np.log1p(min_com_c),
    infra_c, infra_c ** 2 / 100,
    acad_c, acad_c ** 2 / 100,
    brand_c, age_c, age_c ** 2 / 100,
    liq_c, liv_c,
    acad_c * infra_c / 100,
    min_com_c * acad_c / 100,
])
Xc_nl_names = [
    "log_sw_dist", "log_sw_walk",
    "log_biz_gn", "log_biz_gw", "log_biz_yo",
    "log_com_gn", "log_com_gw", "log_com_yo", "log_min_com",
    "infra", "infra_sq",
    "acad", "acad_sq",
    "brand", "age", "age_sq",
    "liquidity", "livability",
    "acad_x_infra", "min_com_x_acad",
]

X_c2 = np.hstack([Xc_nl, sidoc_D])
res_c2 = ols(X_c2, yc, Xc_nl_names + sidoc_Dnames)
show(res_c2, "C2: Nonlinear metro features + sido")

# C3: Nonlinear + sigungu
X_c3 = np.hstack([Xc_nl, sigunguc_D])
res_c3 = ols(X_c3, yc, Xc_nl_names + sigunguc_Dnames)
show(res_c3, "C3: Nonlinear metro features + SIGUNGU dummies", max_features=len(Xc_nl_names))


# ══════════════════════════════════════════════════════════════════════
# GRAND SUMMARY
# ══════════════════════════════════════════════════════════════════════
print()
print("=" * 72)
print("  GRAND SUMMARY — ALL MODELS")
print("=" * 72)

all_models = [
    ("B0: loc_score baseline", res_b0),
    ("B1: Core + sido", res_b1),
    ("B2: Nonlinear + sido", res_b2),
    ("B3: Extended NL + sido", res_b3),
    ("B4: Nonlinear + sigungu", res_b4),
    ("B5: Extended NL + sigungu", res_b5),
    ("A1: 수도권 all feats + sido", res_a1),
    ("A2: 수도권 kitchen sink + sido", res_a2),
    ("C1: 수도권 metro linear + sido", res_c1),
    ("C2: 수도권 metro NL + sido", res_c2),
    ("C3: 수도권 metro NL + sigungu", res_c3),
]

print(f"  {'Model':<40s} {'N':>7s} {'R²':>8s} {'Adj R²':>8s} {'k':>4s} {'>=0.75':>6s}")
print(f"  {'─'*40} {'─'*7} {'─'*8} {'─'*8} {'─'*4} {'─'*6}")
for name, res in all_models:
    if res:
        mark = " YES" if res["r2"] >= 0.75 else ""
        print(f"  {name:<40s} {res['n']:>7,} {res['r2']:>8.4f} {res['adj_r2']:>8.4f} {res['k']:>4d}{mark:>6s}")


# ══════════════════════════════════════════════════════════════════════
# RECOMMENDED WEIGHTS
# ══════════════════════════════════════════════════════════════════════
print()
print("=" * 72)
print("  RECOMMENDED NEW LOC_SCORE WEIGHTS")
print("=" * 72)

# Use B2 (Nonlinear + sido) as the recommended model for all-Korea
# because it has R² >= 0.75, uses all sidos, and has interpretable features
rec_model = res_b2
rec_X = X_nl
rec_names = nl_names
print(f"\n  Reference model: B2 (R² = {rec_model['r2']:.4f}, N = {rec_model['n']:,})")

# Standardized betas (excluding sido dummies and intercept)
std_y = np.std(y)
print(f"\n  Standardized coefficients (|beta * std(X) / std(y)|):")
print(f"  {'Feature':<28s} {'|Std Beta|':>10s} {'Weight':>8s} {'Dir':>5s} {'Raw Beta':>10s}")
print(f"  {'─'*28} {'─'*10} {'─'*8} {'─'*5} {'─'*10}")

std_betas = []
for i, name in enumerate(rec_names):
    col = rec_X[:, i]
    std_x = np.std(col)
    beta = rec_model["beta"][i + 1]  # +1 for intercept
    std_beta = beta * std_x / std_y
    std_betas.append((name, abs(std_beta), std_beta, beta))

std_betas.sort(key=lambda x: x[1], reverse=True)
total = sum(b[1] for b in std_betas)

for name, absb, signedb, rawb in std_betas:
    d = "+" if signedb > 0 else "-"
    w = absb / total * 100
    print(f"  {name:<28s} {absb:>10.4f} {w:>7.1f}% {d:>5s} {rawb:>10.4f}")

# Compute proposed weights for pure location features
print()
print("  PROPOSED LOC_SCORE FORMULA (0-100 scale):")
print("  ─────────────────────────────────────────")
loc_vars = {
    "log_subway_dist": ("subway proximity", "-"),
    "log_subway_walk": ("walk to station", "-"),
    "infra_score": ("infra convenience", "+"),
    "academy_score": ("school quality", "+"),
    "academy_sq": ("school quality (quad)", "+"),
    "acad_x_infra": ("school x infra synergy", "+"),
}

loc_betas = [(n, absb, signedb) for n, absb, signedb, _ in std_betas if n in loc_vars]
loc_total = sum(b[1] for b in loc_betas)
print()
for name, absb, signedb in loc_betas:
    desc, _ = loc_vars[name]
    norm_w = absb / loc_total * 100
    d = "+" if signedb > 0 else "-"
    print(f"    {desc:<30s} ({name}): {norm_w:>5.1f}%  [{d}]")

print()
print("  Apartment-quality features (separate from loc_score):")
apt_vars = ["brand_score", "age_score", "age_sq", "liquidity_score", "livability_score"]
for name, absb, signedb, rawb in std_betas:
    if name in apt_vars:
        w = absb / total * 100
        d = "+" if signedb > 0 else "-"
        print(f"    {name:<28s} {w:>5.1f}%  [{d}]")

print()
print("  NOTE: The sido/sigungu dummies capture regional price levels that")
print("  should NOT be in loc_score (they are fixed effects per city).")
print("  The loc_score should capture within-region location quality.")
print()
print("Done.")
