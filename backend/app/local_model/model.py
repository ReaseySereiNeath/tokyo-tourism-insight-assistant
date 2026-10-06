"""The classifier: one multilingual encoder with two small heads.

- themes:    multi-label (an item can mention food AND pace), sigmoid per theme
- sentiment: single label over SENTIMENTS, softmax

A saved model folder holds the fine-tuned encoder and tokenizer (so prediction
works offline), the head weights, and meta.json (theme order, threshold,
validation metrics).
"""
import json
from pathlib import Path

import torch
from torch import nn
from transformers import AutoModel, AutoTokenizer
from transformers.utils import logging as hf_logging

# The base checkpoint's unused language-model head triggers a long, harmless load report.
hf_logging.set_verbosity_error()
hf_logging.disable_progress_bar()

MAX_LENGTH = 128  # tokens; feedback beyond this is truncated


def pick_device() -> torch.device:
    if torch.backends.mps.is_available():  # Apple silicon GPU
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


class FeedbackClassifier(nn.Module):
    def __init__(self, encoder: nn.Module, n_themes: int, n_sentiments: int):
        super().__init__()
        self.encoder = encoder
        hidden = encoder.config.hidden_size
        self.dropout = nn.Dropout(0.1)
        self.theme_head = nn.Linear(hidden, n_themes)
        self.sentiment_head = nn.Linear(hidden, n_sentiments)

    def forward(self, input_ids, attention_mask):
        cls = self.encoder(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state[:, 0]
        cls = self.dropout(cls)
        return self.theme_head(cls), self.sentiment_head(cls)


def build(base_model: str, n_themes: int, n_sentiments: int):
    tokenizer = AutoTokenizer.from_pretrained(base_model)
    model = FeedbackClassifier(AutoModel.from_pretrained(base_model), n_themes, n_sentiments)
    return tokenizer, model


def save(path: Path, tokenizer, model: FeedbackClassifier, meta: dict) -> None:
    path.mkdir(parents=True, exist_ok=True)
    model.encoder.save_pretrained(path / "encoder")
    tokenizer.save_pretrained(path / "encoder")
    torch.save({"theme_head": model.theme_head.state_dict(),
                "sentiment_head": model.sentiment_head.state_dict()}, path / "heads.pt")
    (path / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))


def load(path: Path):
    meta = json.loads((path / "meta.json").read_text())
    tokenizer = AutoTokenizer.from_pretrained(path / "encoder")
    model = FeedbackClassifier(AutoModel.from_pretrained(path / "encoder"),
                               len(meta["themes"]), len(meta["sentiments"]))
    heads = torch.load(path / "heads.pt", map_location="cpu")
    model.theme_head.load_state_dict(heads["theme_head"])
    model.sentiment_head.load_state_dict(heads["sentiment_head"])
    model.eval()
    return tokenizer, model, meta


@torch.no_grad()
def predict_probs(tokenizer, model: FeedbackClassifier, texts: list[str], device: torch.device,
                  batch_size: int = 32) -> tuple[torch.Tensor, torch.Tensor]:
    """Theme probabilities (n, n_themes) and sentiment probabilities (n, n_sentiments), on CPU."""
    model.eval()
    theme_probs, sentiment_probs = [], []
    for start in range(0, len(texts), batch_size):
        enc = tokenizer(texts[start:start + batch_size], padding=True, truncation=True,
                        max_length=MAX_LENGTH, return_tensors="pt").to(device)
        theme_logits, sentiment_logits = model(enc["input_ids"], enc["attention_mask"])
        theme_probs.append(torch.sigmoid(theme_logits).float().cpu())
        sentiment_probs.append(torch.softmax(sentiment_logits, dim=-1).float().cpu())
    return torch.cat(theme_probs), torch.cat(sentiment_probs)
