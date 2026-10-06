"""Fine-tune xlm-roberta-base on your reviewed labelling sheet.

Run:  python -m app.local_model.train                      (uses data/training/labels_real.csv)
      python -m app.local_model.train --labels a.csv b.csv --epochs 10

A share of the reviewed rows is held back for validation. The report compares
the trained model against the keyword rules on those same held-back rows, so
you can see whether it is actually better before using it. The first run
downloads the base model (about 1 GB) from Hugging Face.
"""
import argparse
import random
import sys
from datetime import datetime, timezone
from pathlib import Path

import torch
from torch import nn
from transformers import get_linear_schedule_with_warmup

from app.analysis.themes import THEMES, keyword_themes
from app.local_model import BASE_MODEL, SENTIMENTS, model_dir
from app.local_model import model as m
from app.local_model.labels import LabelError, LabelledItem, load_reviewed, sheet_path

MIN_ITEMS = 20         # below this there is nothing meaningful to validate on
RECOMMENDED_ITEMS = 300
THEME_KEYS = list(THEMES)


def encode_targets(items: list[LabelledItem]) -> tuple[torch.Tensor, torch.Tensor]:
    themes = torch.zeros(len(items), len(THEME_KEYS))
    sentiments = torch.full((len(items),), -100, dtype=torch.long)  # -100 = not labelled, ignored by the loss
    for i, item in enumerate(items):
        for t in item.themes:
            themes[i, THEME_KEYS.index(t)] = 1.0
        if item.sentiment:
            sentiments[i] = SENTIMENTS.index(item.sentiment)
    return themes, sentiments


def decide_themes(probs: torch.Tensor, threshold: float) -> torch.Tensor:
    """Themes above the threshold; an item with none gets its single most likely theme."""
    chosen = probs >= threshold
    empty = (~chosen.any(dim=1)).nonzero().squeeze(1)
    chosen[empty, probs[empty].argmax(dim=1)] = True
    return chosen


def f1_scores(pred: torch.Tensor, gold: torch.Tensor) -> dict:
    pred, gold = pred.bool(), gold.bool()
    tp = (pred & gold).sum(0).float()
    fp = (pred & ~gold).sum(0).float()
    fn = (~pred & gold).sum(0).float()
    micro = (2 * tp.sum() / (2 * tp.sum() + fp.sum() + fn.sum()).clamp(min=1)).item()
    per_theme = (2 * tp / (2 * tp + fp + fn).clamp(min=1)).tolist()
    support = gold.sum(0).tolist()
    present = [f for f, s in zip(per_theme, support) if s > 0]
    return {"micro_f1": round(micro, 3),
            "macro_f1": round(sum(present) / len(present), 3) if present else 0.0,
            "per_theme": {k: {"f1": round(f, 3), "support": int(s)}
                          for k, f, s in zip(THEME_KEYS, per_theme, support)}}


def sentiment_accuracy(probs: torch.Tensor, gold: torch.Tensor) -> float | None:
    mask = gold != -100
    if not mask.any():
        return None
    return round((probs.argmax(1)[mask] == gold[mask]).float().mean().item(), 3)


def keyword_baseline(items: list[LabelledItem]) -> dict:
    pred = torch.zeros(len(items), len(THEME_KEYS))
    for i, item in enumerate(items):
        for t in keyword_themes(item.text):
            pred[i, THEME_KEYS.index(t)] = 1.0
    return f1_scores(pred, encode_targets(items)[0])


def train(items: list[LabelledItem], out: Path, epochs: int, batch_size: int, lr: float,
          val_fraction: float, seed: int) -> dict:
    random.Random(seed).shuffle(items)
    torch.manual_seed(seed)
    n_val = max(4, round(len(items) * val_fraction))
    val, tr = items[:n_val], items[n_val:]
    device = m.pick_device()
    print(f"{len(tr)} training / {len(val)} validation items · device: {device}")

    tokenizer, model = m.build(BASE_MODEL, len(THEME_KEYS), len(SENTIMENTS))
    model.to(device)
    tr_themes, tr_sent = encode_targets(tr)
    val_themes, val_sent = encode_targets(val)
    enc = tokenizer([i.text for i in tr], padding=True, truncation=True, max_length=m.MAX_LENGTH,
                    return_tensors="pt")

    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=0.01)
    steps = epochs * ((len(tr) + batch_size - 1) // batch_size)
    scheduler = get_linear_schedule_with_warmup(optimizer, int(0.1 * steps), steps)
    theme_loss = nn.BCEWithLogitsLoss()
    sentiment_loss = nn.CrossEntropyLoss(ignore_index=-100)

    best = {"score": -1.0}
    for epoch in range(1, epochs + 1):
        model.train()
        order = torch.randperm(len(tr))
        total = 0.0
        for start in range(0, len(tr), batch_size):
            idx = order[start:start + batch_size]
            theme_logits, sentiment_logits = model(enc["input_ids"][idx].to(device),
                                                   enc["attention_mask"][idx].to(device))
            loss = theme_loss(theme_logits, tr_themes[idx].to(device))
            if (tr_sent[idx] != -100).any():  # CE over an all-ignored batch would be NaN
                loss = loss + sentiment_loss(sentiment_logits, tr_sent[idx].to(device))
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()
            optimizer.zero_grad()
            total += loss.item() * len(idx)

        theme_probs, sent_probs = m.predict_probs(tokenizer, model, [i.text for i in val], device)
        micro = f1_scores(decide_themes(theme_probs, 0.5), val_themes)["micro_f1"]
        acc = sentiment_accuracy(sent_probs, val_sent)
        score = micro if acc is None else (micro + acc) / 2
        print(f"epoch {epoch:>2}: loss {total / len(tr):.4f} · val theme micro-F1 {micro:.3f}"
              + ("" if acc is None else f" · val sentiment accuracy {acc:.3f}"))
        if score > best["score"]:
            best = {"score": score, "epoch": epoch,
                    "state": {k: v.detach().to("cpu", copy=True) for k, v in model.state_dict().items()}}

    model.load_state_dict(best["state"])
    theme_probs, sent_probs = m.predict_probs(tokenizer, model, [i.text for i in val], device)
    threshold = max((t / 20 for t in range(4, 15)),  # 0.20 .. 0.70
                    key=lambda t: f1_scores(decide_themes(theme_probs, t), val_themes)["micro_f1"])
    trained_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    meta = {
        "base_model": BASE_MODEL,
        "label": f"{BASE_MODEL} fine-tuned {trained_at[:10]}",
        "trained_at": trained_at,
        "themes": THEME_KEYS,
        "sentiments": list(SENTIMENTS),
        "threshold": threshold,
        "best_epoch": best["epoch"],
        "train_items": len(tr),
        "validation_items": len(val),
        "validation": {
            "note": "Held-back rows, also used to pick the epoch and threshold, so slightly optimistic.",
            "themes": f1_scores(decide_themes(theme_probs, threshold), val_themes),
            "sentiment_accuracy": sentiment_accuracy(sent_probs, val_sent),
            "keyword_rules_themes": keyword_baseline(val),
        },
    }
    m.save(out, tokenizer, model, meta)
    return meta


def main() -> None:
    parser = argparse.ArgumentParser(description="Fine-tune the local feedback classifier.")
    parser.add_argument("--labels", type=Path, nargs="+", default=[sheet_path("real")])
    parser.add_argument("--out", type=Path, default=None, help="model folder (default data/models/feedback-classifier)")
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--lr", type=float, default=3e-5)
    parser.add_argument("--val-fraction", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=13)
    args = parser.parse_args()

    missing = [str(p) for p in args.labels if not p.exists()]
    if missing:
        sys.exit(f"Labelling sheet not found: {', '.join(missing)}\n"
                 "Create it first: python -m app.local_model.labels --scope real")
    try:
        items = load_reviewed(args.labels)
    except LabelError as exc:
        sys.exit(str(exc))
    if len(items) < MIN_ITEMS:
        sys.exit(f"Only {len(items)} reviewed rows; at least {MIN_ITEMS} are needed "
                 f"(about {RECOMMENDED_ITEMS}+ for useful results). Set reviewed=yes on checked rows.")
    if len(items) < RECOMMENDED_ITEMS:
        print(f"Note: {len(items)} reviewed rows. Expect rough results below about {RECOMMENDED_ITEMS}.")

    meta = train(items, args.out or model_dir(), args.epochs, args.batch_size, args.lr,
                 args.val_fraction, args.seed)
    v = meta["validation"]
    print(f"\nSaved to {args.out or model_dir()} (best epoch {meta['best_epoch']}, threshold {meta['threshold']})")
    print(f"Validation on {meta['validation_items']} held-back items:")
    print(f"  trained model  theme micro-F1 {v['themes']['micro_f1']:.3f}  macro-F1 {v['themes']['macro_f1']:.3f}")
    print(f"  keyword rules  theme micro-F1 {v['keyword_rules_themes']['micro_f1']:.3f}  "
          f"macro-F1 {v['keyword_rules_themes']['macro_f1']:.3f}")
    if v["sentiment_accuracy"] is not None:
        print(f"  sentiment accuracy {v['sentiment_accuracy']:.3f}")
    print("Per-theme scores are in meta.json. Next: python -m app.local_model.predict --scope real")


if __name__ == "__main__":
    main()
