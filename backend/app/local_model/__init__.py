"""A small feedback classifier trained on your own labelled feedback.

It predicts the same theme taxonomy as the keyword rules and the language model
(app/analysis/themes.py) plus a sentiment, runs entirely on this Mac, and costs
nothing per run. Its labels are stored with method 'local'.

Workflow (run from backend/ with the venv active, after
`pip install -r requirements-ml.txt`):

    python -m app.local_model.labels --scope real     # 1. export a labelling sheet
    #    open data/training/labels_real.csv, correct themes/sentiment, set reviewed=yes
    python -m app.local_model.train                   # 2. fine-tune xlm-roberta-base
    python -m app.local_model.predict --scope real    # 3. label all feedback with it

Only labels.py works without torch/transformers installed.
"""
from pathlib import Path

from app.config import get_settings

BASE_MODEL = "xlm-roberta-base"
SENTIMENTS = ("positive", "negative", "mixed", "neutral")


def training_dir() -> Path:
    """Labelling sheets. Under data/, so customer text is never committed."""
    return get_settings().data_dir / "training"


def model_dir() -> Path:
    return get_settings().data_dir / "models" / "feedback-classifier"
