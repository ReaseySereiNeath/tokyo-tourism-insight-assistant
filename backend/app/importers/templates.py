"""Import templates, generated from the dataset definitions so they never drift.

Run:  python -m app.importers.templates    (writes backend/templates/*.csv)
"""
import csv
import io

from app.config import BACKEND_DIR
from app.importers.datasets import DATASETS


def template_csv(dataset_name: str, with_example: bool = False) -> str:
    dataset = DATASETS[dataset_name]
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([c.name for c in dataset.columns])
    if with_example:
        writer.writerow([c.example for c in dataset.columns])
    return buf.getvalue()


def column_guide(dataset_name: str) -> dict:
    d = DATASETS[dataset_name]
    return {
        "dataset": d.name, "label": d.label, "notes": d.notes, "key_fields": d.key_fields,
        "columns": [{"name": c.name, "required": c.required, "description": c.description, "example": c.example}
                    for c in d.columns],
    }


if __name__ == "__main__":
    out = BACKEND_DIR / "templates"
    out.mkdir(exist_ok=True)
    for name in DATASETS:
        (out / f"{name}_template.csv").write_text(template_csv(name), encoding="utf-8")
        (out / f"{name}_example.csv").write_text(template_csv(name, with_example=True), encoding="utf-8")
        print(f"wrote templates/{name}_template.csv and {name}_example.csv")
