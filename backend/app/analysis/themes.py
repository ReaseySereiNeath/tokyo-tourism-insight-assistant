"""Feedback themes.

One fixed taxonomy is shared by:
- the keyword classifier below (works offline, no API key, transparent but crude)
- the language-model classifier (app/ai/classify.py), which may only choose from it

Labels are stored with their method ('keyword' or 'llm') so the UI never
presents keyword matches as AI analysis.
"""
import re
import sqlite3

from app.db import utcnow

THEMES: dict[str, str] = {
    "guide_quality": "Guide knowledge, friendliness, storytelling",
    "food_and_drink": "Food quality, quantity, variety of tastings",
    "dietary_needs": "Vegetarian, vegan, halal, allergies, gluten-free",
    "pace_and_walking": "Walking distance, pace, physical effort",
    "group_size": "Group too big/small, private tour requests",
    "price_and_value": "Price, value for money, hidden costs",
    "booking_and_logistics": "Booking, meeting point, communication before the tour, timing",
    "language_and_communication": "Language level, translation, understanding",
    "cultural_insight": "Learning about culture, history, local life",
    "local_authenticity": "Hidden spots, non-touristy places, locals' venues",
    "crowding": "Crowds, queues, busy places",
    "weather_and_comfort": "Heat, rain, comfort, rest stops",
    "accessibility": "Mobility, children, elderly, stairs",
    "duration_and_schedule": "Tour length, start time, schedule",
    "other": "Anything not covered above",
}

# Deliberately simple keyword lists (English + a few Japanese terms).
KEYWORDS: dict[str, list[str]] = {
    "guide_quality": ["guide", "knowledgeable", "friendly", "funny", "storyteller", "host", "ガイド"],
    "food_and_drink": ["food", "tasting", "tastings", "ramen", "sushi", "izakaya", "yakitori", "snack", "drink",
                       "sake", "delicious", "portion", "hungry", "食べ"],
    "dietary_needs": ["vegetarian", "vegan", "halal", "allerg", "gluten", "pescatarian", "dietary", "kosher"],
    "pace_and_walking": ["walk", "walking", "pace", "too fast", "rushed", "tiring", "tired", "steps", "feet"],
    "group_size": ["group size", "big group", "large group", "small group", "smaller group", "group was", "group of", "private tour", "crowded group", "people in our group"],
    "price_and_value": ["price", "expensive", "value", "worth", "cheap", "cost", "overpriced", "money", "yen"],
    "booking_and_logistics": ["booking", "book", "meeting point", "find the", "email", "confirmation", "late", "refund",
                              "cancel", "reschedul", "whatsapp"],
    "language_and_communication": ["english", "understand", "accent", "translat", "language", "japanese"],
    "cultural_insight": ["culture", "history", "learn", "tradition", "etiquette", "insight", "explained"],
    "local_authenticity": ["local", "hidden", "authentic", "off the beaten", "non-touristy", "locals", "back street", "alley"],
    "crowding": ["crowd", "queue", "line", "busy", "packed"],
    "weather_and_comfort": ["rain", "hot", "heat", "humid", "cold", "umbrella", "weather", "sweat"],
    "accessibility": ["wheelchair", "stroller", "pram", "kids", "children", "elderly", "mobility", "stairs", "accessible"],
    "duration_and_schedule": ["hours", "too long", "too short", "start time", "schedule", "ended", "duration", "late night", "early"],
}


def keyword_themes(text: str) -> list[str]:
    lowered = text.lower()
    found = [theme for theme, words in KEYWORDS.items()
             if any(re.search(r"(?<![a-z])" + re.escape(w), lowered) for w in words)]
    return found or ["other"]


def classify_with_keywords(conn: sqlite3.Connection) -> dict:
    """(Re)label all feedback with keyword rules. Idempotent."""
    now = utcnow()
    items = conn.execute("SELECT evidence_id, text FROM feedback").fetchall()
    conn.execute("DELETE FROM feedback_themes WHERE method = 'keyword'")
    labels = 0
    for item in items:
        for theme in keyword_themes(item["text"]):
            conn.execute(
                "INSERT INTO feedback_themes (evidence_id, theme, method, model, sentiment, classified_at) "
                "VALUES (?, ?, 'keyword', NULL, NULL, ?)", (item["evidence_id"], theme, now))
            labels += 1
    conn.commit()
    return {"method": "keyword", "classified": len(items), "labels": labels}
