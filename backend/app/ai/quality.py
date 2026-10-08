"""Quality checks on a validated report, applied to every provider.

Smaller local models in particular tend to: write fact IDs instead of sentences,
state numbers that aren't in the evidence, sound too sure, and suggest a "test"
that is really a full launch. Each check either repairs the text from the
evidence (never from imagination) or flags it on the idea, and every action is
recorded in validation["quality"] so the page can say what was changed.
"""
import re

ID_ONLY = re.compile(r"^[\s,;.]*((F\d+|(DEMO-)?(VS|SP|CO|FB|NW)-[0-9A-F]{12})[\s,;.]*)+$")
NUMBER = re.compile(r"(¥\s?)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s?(%|/5| billion| million)?")
BIG_COMMITMENT = re.compile(r"\b(open (a|an|your)|rent(ing)? (a|an)|lease|sign (a|the)|buy (a|an)|hire staff|"
                            r"set up (a|an) (shop|store|office|restaurant))\b", re.I)
# Business types that make sense for ideas resting on items of one spending category (first = default).
TYPES_FOR_CATEGORY = {
    "shopping": ["retail_shopping", "food_drink", "services_other"],
    "entertainment": ["tours_activities", "events_entertainment", "wellness_beauty"],
    "food_drink": ["food_drink"],
    "lodging": ["accommodation"],
    "transport": ["transport_mobility", "tours_activities"],
}
FOOD_ITEMS = {"sweets_snacks", "alcohol", "fresh_produce", "other_food_tobacco"}
SMALL_TEST = re.compile(r"\b(pop-?up|trial|pilot|pre-?order|online|market stall|one-off|weekend|test (run|event))\b", re.I)


def _numbers(text: str) -> list[tuple[str, float, int]]:
    """Numbers worth checking: with a unit (%, ¥, /5, billion) or a decimal, or at least 100."""
    out = []
    for m in NUMBER.finditer(text):
        yen, whole, frac, unit = m.groups()
        value = float(whole.replace(",", "") + (frac or ""))
        if not (yen or unit or frac or value >= 100):
            continue  # small counts ("3 ideas", "4 of 5") are not checked
        if 1900 <= value <= 2100 and not (yen or unit or frac):
            continue  # years
        out.append((m.group(0).strip(), value, len(frac) - 1 if frac else 0))
    return out


def _known_numbers(pack: dict) -> list[float]:
    text = " ".join(f["statement"] for f in pack["facts"]) + " " + " ".join(str(v) for v in pack.get("founder_profile", {}).values())
    return [v for _, v, _ in _numbers(text)]


def _verified(value: float, decimals: int, known: list[float]) -> bool:
    return any(round(k, decimals) == round(value, decimals) for k in known)


ITEM_FACT_KINDS = {"item_signal", "spend_item_largest"}


def _fix_item_citations(opp: dict, facts: dict, signal_for: dict[str, str], labels: dict[str, str]) -> list[str] | None:
    """An idea linked to item X must not lean on facts about item Y. Returns the removed IDs, if any."""
    linked = [labels[k] for k in opp.get("spending_items", []) if k in labels]
    if not linked:
        return None
    wrong = [e for e in opp["evidence_ids"]
             if e in facts and facts[e]["kind"] in ITEM_FACT_KINDS
             and not any(f"] {lab} (" in facts[e]["statement"] for lab in linked)]
    if not wrong:
        return None
    keep = [e for e in opp["evidence_ids"] if e not in wrong]
    for key in opp["spending_items"]:
        if key in signal_for and signal_for[key] not in keep:
            keep.insert(0, signal_for[key])
    opp["evidence_ids"] = keep
    return wrong


def check(result: dict, pack: dict) -> dict:
    facts = {f["id"]: f for f in pack["facts"]}
    signal_for = {f["data"]["key"]: f["id"] for f in pack["facts"] if f["kind"] == "item_signal" and "key" in f.get("data", {})}
    labels = {i["key"]: i["label"] for i in pack.get("spending_items", [])}
    known = _known_numbers(pack)
    profile_empty = not any(str(v).strip() for v in pack.get("founder_profile", {}).values())
    preliminary = any("preliminary" in g for g in pack.get("data_gaps", []))
    actions: list[dict] = []

    for i, opp in enumerate(result.get("opportunities", [])):
        wrong = _fix_item_citations(opp, facts, signal_for, labels)
        if wrong:
            actions.append({"index": i, "check": "citations_fixed", "removed": wrong,
                            "note": "Cited facts about a different item were replaced by the linked item's scorecard."})
        if ID_ONLY.match(opp["demand_evidence"] or ""):
            cited = [facts[e]["statement"] for e in opp["evidence_ids"] if e in facts]
            if cited:
                opp["demand_evidence"] = " ".join(cited)
                actions.append({"index": i, "check": "evidence_filled",
                                "note": "The AI listed only fact IDs; the cited facts are shown instead."})
        unverified = sorted({raw for field in ("demand_evidence", "why_now", "why_it_could_work")
                             for raw, v, d in _numbers(opp.get(field) or "") if not _verified(v, d, known)})
        if unverified:
            opp["risks"].append(f"Contains numbers not found in the evidence: {', '.join(unverified)}. Check them.")
            actions.append({"index": i, "check": "unverified_numbers", "numbers": unverified})
        if opp["confidence"] == "high" and (profile_empty or preliminary):
            opp["confidence"] = "medium"
            actions.append({"index": i, "check": "confidence_capped",
                            "note": "Lowered to medium: " + ("About you is empty" if profile_empty else
                                                             "the latest figures are preliminary") + "."})
        cats = {k.split("/")[0] for k in opp.get("spending_items", [])}
        items = {k.split("/")[-1] for k in opp.get("spending_items", [])}
        if len(cats) == 1:
            allowed = TYPES_FOR_CATEGORY.get(next(iter(cats)), [])
            if cats == {"shopping"} and not items & FOOD_ITEMS:
                allowed = [t for t in allowed if t != "food_drink"]  # food types only for food items
            if allowed and opp["business_type"] not in allowed:
                actions.append({"index": i, "check": "type_corrected", "note": f"{opp['business_type']} -> {allowed[0]}"})
                opp["business_type"] = allowed[0]
        if BIG_COMMITMENT.search(opp["first_test"]) and not SMALL_TEST.search(opp["first_test"]):
            opp["risks"].append("The suggested first test is a big commitment. Try something cheaper and reversible "
                                "first, such as a few paid trial sessions, a pop-up or a pre-order page.")
            actions.append({"index": i, "check": "big_first_test"})

    for j, rej in enumerate(result.get("rejected_ideas", [])):
        bad = sorted({raw for raw, v, d in _numbers(rej["reason"]) if not _verified(v, d, known)})
        if bad:
            rej["reason"] += f" (Numbers not found in the evidence: {', '.join(bad)}.)"
            actions.append({"rejected_index": j, "check": "unverified_numbers", "numbers": bad})

    if result.get("data_sufficiency") == "sufficient" and profile_empty:
        result["data_sufficiency"] = "limited"
        result["sufficiency_notes"].append("About you is empty, so ideas can't be matched to your budget and skills.")
        actions.append({"check": "sufficiency_lowered"})
    return {"actions": actions}
