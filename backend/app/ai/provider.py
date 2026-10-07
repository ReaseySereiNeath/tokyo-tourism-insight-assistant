"""Language-model providers behind one small interface.

    LLMProvider
      ├── AnthropicProvider  real Claude API calls (needs ANTHROPIC_API_KEY)
      └── DemoProvider       fixed rules, no AI; output is always labeled as an EXAMPLE

Swapping in another vendor means writing one more class with the same two
methods. The rest of the app only sees plain dicts and ProviderError.
"""
import json
import logging
from typing import Protocol

import anthropic

from app.ai import prompts
from app.ai.schemas import ClassificationOutput, ReportOutput
from app.config import Settings

log = logging.getLogger(__name__)

FALLBACK_BETA = "server-side-fallback-2026-07-01"


class ProviderError(Exception):
    """A failure the UI can explain. `kind` is a short machine-readable category."""

    def __init__(self, kind: str, message: str):
        super().__init__(message)
        self.kind = kind
        self.message = message


class LLMProvider(Protocol):
    name: str
    model: str | None
    is_example: bool

    def generate_report(self, pack: dict) -> dict: ...

    def classify_feedback(self, items: list[dict]) -> dict: ...


class AnthropicProvider:
    name = "anthropic"
    is_example = False

    def __init__(self, settings: Settings, client: anthropic.Anthropic | None = None):
        self.settings = settings
        self.model = settings.anthropic_model
        # Timeouts and retries are bounded: the SDK retries 408/409/429/5xx and
        # connection errors up to `max_retries` times with backoff.
        self.client = client or anthropic.Anthropic(
            api_key=settings.anthropic_api_key,
            timeout=settings.ai_timeout_seconds,
            max_retries=settings.ai_max_retries,
        )
        self.last_served_model: str | None = None

    def _call(self, system: str, user: str, schema_model, effort: str, max_tokens: int) -> dict:
        kwargs = dict(
            model=self.model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
            output_config={
                "effort": effort,
                "format": {"type": "json_schema", "schema": anthropic.transform_schema(schema_model)},
            },
        )
        try:
            if self.settings.ai_enable_fallbacks:
                response = self.client.beta.messages.create(**kwargs, betas=[FALLBACK_BETA], fallbacks="default")
            else:
                response = self.client.messages.create(**kwargs)
        except anthropic.AuthenticationError as exc:
            raise ProviderError("auth", "The API key was rejected. Check ANTHROPIC_API_KEY in backend/.env.") from exc
        except anthropic.PermissionDeniedError as exc:
            raise ProviderError("permission", f"The API key lacks permission: {exc.message}") from exc
        except anthropic.NotFoundError as exc:
            raise ProviderError("model", f"Model '{self.model}' was not found. Check ANTHROPIC_MODEL.") from exc
        except anthropic.BadRequestError as exc:
            raise ProviderError("bad_request", f"The API rejected the request: {exc.message}") from exc
        except anthropic.RateLimitError as exc:
            raise ProviderError("rate_limit", "Rate limited by the API after retries. Try again in a minute.") from exc
        except anthropic.APITimeoutError as exc:
            raise ProviderError("timeout", f"The API did not answer within {self.settings.ai_timeout_seconds:.0f}s "
                                           "(after retries).") from exc
        except anthropic.APIConnectionError as exc:
            raise ProviderError("network", "Could not reach the API. Check your internet connection.") from exc
        except anthropic.APIStatusError as exc:
            raise ProviderError("api_error", f"API error {exc.status_code}: {exc.message}") from exc

        self.last_served_model = getattr(response, "model", self.model)
        if response.stop_reason == "refusal":
            raise ProviderError("refusal", "The model declined this request.")
        if response.stop_reason == "max_tokens":
            raise ProviderError("truncated", "The response hit the output-token limit and was cut off. "
                                             "Increase AI_MAX_OUTPUT_TOKENS or reduce the evidence size.")
        text = next((b.text for b in response.content if getattr(b, "type", None) == "text"), None)
        if text is None:
            raise ProviderError("invalid_response", "The response contained no text.")
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            raise ProviderError("invalid_response", "The response was not valid JSON.") from exc

    def generate_report(self, pack: dict) -> dict:
        return self._call(prompts.REPORT_SYSTEM, prompts.report_user_message(pack), ReportOutput,
                          self.settings.ai_effort_report, self.settings.ai_max_output_tokens)

    def classify_feedback(self, items: list[dict]) -> dict:
        return self._call(prompts.CLASSIFY_SYSTEM, prompts.classify_user_message(items), ClassificationOutput,
                          self.settings.ai_effort_classify, 8000)


class DemoProvider:
    """Builds an EXAMPLE opportunity report from the evidence pack with fixed rules. No AI is involved.

    It exists so the whole journey (report -> validation -> evidence links) can
    be explored without an API key. Every output is stored with is_example=1
    and the UI labels it as an example.
    """
    name = "demo"
    model = None
    is_example = True

    # Fixed wording per spending item: (business idea, business type). EXAMPLE text, not analysis.
    IDEAS = {
        "entertainment/local_tours_guides": ("Small-group neighbourhood walking tours", "tours_activities"),
        "entertainment/onsen_spa_relaxation": ("Drop-in relaxation or foot-spa studio", "wellness_beauty"),
        "shopping/crafts_traditional": ("Hands-on craft workshops", "tours_activities"),
        "shopping/clothing": ("Curated second-hand fashion pop-up", "retail_shopping"),
        "entertainment/stage_music": ("Evening live-music nights for visitors", "events_entertainment"),
        "transport/taxi": ("Private airport and day-trip transfers", "transport_mobility"),
    }

    @staticmethod
    def _opportunity(idea: str, kind: str, fact: dict, why: str, test: str, items: list[str]) -> dict:
        return {
            "business_idea": f"EXAMPLE: {idea}",
            "business_type": kind,
            "demand_evidence": f"EXAMPLE: {fact['statement']}",
            "evidence_ids": [fact["id"], *fact["evidence_ids"][:3]],
            "why_it_could_work": f"EXAMPLE TEXT (fixed template, not AI): {why}",
            "target_visitors": None,
            "target_support": None,
            "first_test": f"EXAMPLE: {test}",
            "success_measure": "EXAMPLE: at least 20 paid bookings in 6 weeks with an average rating of 4.5 or more.",
            "checks_before_starting": ["EXAMPLE: how many similar businesses already operate nearby, and their prices",
                                       "EXAMPLE: which permits or registrations this needs (ask the ward office)",
                                       "EXAMPLE: start-up and monthly running costs"],
            "risks": ["Example output generated by fixed rules from synthetic data.",
                      "Japan-wide spending does not show demand in one Tokyo neighbourhood."],
            "alternative_explanations": ["A one-off event or exchange-rate swing may explain the change."],
            "confidence": "low",
            "why_now": "EXAMPLE: the linked item's demand score is among the highest in the pack.",
            "fit_with_you": "unknown",
            "spending_items": items,
        }

    def generate_report(self, pack: dict) -> dict:
        by_kind: dict[str, list[dict]] = {}
        for f in pack["facts"]:
            by_kind.setdefault(f["kind"], []).append(f)
        opportunities = []
        for fact in by_kind.get("item_signal", []):
            key = fact["data"].get("key")
            if key in self.IDEAS:
                idea, kind = self.IDEAS[key]
                opportunities.append(self._opportunity(
                    idea, kind, fact, "this item has one of the stronger demand scorecards in the data.",
                    "sell a handful of trial sessions through an online booking page before renting anything.", [key]))
            if len(opportunities) == 3:
                break
        share = next((f for f in by_kind.get("tokyo_share", []) if "entertainment" in f["statement"]), None)
        if share:
            opportunities.append(self._opportunity(
                "Evening activity for visitors staying in Tokyo", "events_entertainment", share,
                "Tokyo's share of activity spending is in the data.",
                "run four pilot evenings in a rented space and sell tickets online.", []))
        weakest = by_kind.get("item_signal", [])[-1:] if by_kind.get("item_signal") else []
        return {
            "summary": "EXAMPLE REPORT — generated by fixed rules from synthetic demonstration data. "
                       "No AI model was called and no real market analysis took place. It shows how a report, "
                       "its evidence links and its validation look.",
            "data_sufficiency": "limited",
            "sufficiency_notes": ["Synthetic data only.", *pack["data_gaps"][:5]],
            "opportunities": opportunities,
            "questions_to_research": ["EXAMPLE: Would visitors book this before arriving in Japan, or on the day?"],
            "rejected_ideas": [{"idea": "EXAMPLE: a shop built on the weakest item in the data",
                                "reason": f"EXAMPLE: lowest demand score in the pack ({weakest[0]['statement'][:80]}…)"
                                if weakest else "EXAMPLE: no supporting evidence."}],
        }

    def classify_feedback(self, items: list[dict]) -> dict:
        raise ProviderError("not_supported", "The demo provider does not classify feedback. Use keyword rules.")


def get_provider(scope: str, requested: str | None, settings: Settings) -> LLMProvider:
    """Pick a provider, refusing combinations that could mislead.

    - real data + demo provider: refused (an example report must never look like analysis of real data)
    - live provider without an API key: refused with a clear message
    """
    choice = requested or ("anthropic" if scope == "real" else "demo")
    if choice == "demo":
        if scope != "demo":
            raise ProviderError("not_allowed", "Example reports are only available in demo mode.")
        return DemoProvider()
    if choice == "anthropic":
        if not settings.ai_configured:
            raise ProviderError("not_configured", "No ANTHROPIC_API_KEY is set, so live AI analysis is unavailable. "
                                                  "Imports, charts and the evidence preview still work.")
        return AnthropicProvider(settings)
    raise ProviderError("unknown_provider", f"Unknown provider '{choice}'.")
