"""Generate the SYNTHETIC demonstration dataset (deterministic).

Run:  python -m demo_data.generate     (from backend/)

Everything produced here is invented for demonstration. Names, numbers,
reviews, and headlines are fictional and labeled 'synthetic'. These files
are only ever loaded into data/demo.db, never into the real database.
"""
import csv
import math
import random
from pathlib import Path

OUT = Path(__file__).parent
rng = random.Random(42)
COLLECTED = "2026-07-15"
SOURCE = "SYNTHETIC DEMO DATA"


def write(name: str, header: list[str], data: list[dict]) -> None:
    with open(OUT / name, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=header)
        w.writeheader()
        w.writerows(data)
    print(f"wrote {name}: {len(data)} rows")


def months(start: str, end: str) -> list[str]:
    y, m = map(int, start.split("-"))
    ey, em = map(int, end.split("-"))
    out = []
    while (y, m) <= (ey, em):
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def visitor_stats() -> list[dict]:
    # base monthly level, yearly growth, seasonal amplitude (all invented)
    origins = {
        "United States": (190_000, 0.14, 0.25), "Australia": (70_000, 0.10, 0.45),
        "United Kingdom": (35_000, 0.12, 0.30), "Canada": (40_000, 0.09, 0.25),
        "Singapore": (50_000, 0.05, 0.35), "Germany": (25_000, 0.11, 0.30),
        "France": (28_000, 0.08, 0.30), "South Korea": (750_000, 0.04, 0.15),
        "Taiwan": (500_000, 0.02, 0.15),
    }
    data = []
    grid = months("2024-01", "2026-06")
    for geography, scale in (("Japan (synthetic)", 1.0), ("Tokyo (synthetic)", 0.48)):
        totals = {m: 0.0 for m in grid}
        for origin, (base, growth, season) in origins.items():
            if geography.startswith("Tokyo") and origin not in ("United States", "Australia", "United Kingdom", "South Korea"):
                continue
            for i, month in enumerate(grid):
                # Deliberate gaps to demonstrate missing-data handling.
                if (origin, month) in {("Germany", "2025-03"), ("France", "2025-02"), ("Canada", "2024-06")}:
                    continue
                mm = int(month[5:])
                seasonal = 1 + season * math.sin((mm - 1) / 12 * 2 * math.pi + 0.6)
                value = base * scale * seasonal * (1 + growth) ** (i / 12) * rng.uniform(0.94, 1.06)
                totals[month] += value
                data.append({
                    "reporting_month": month, "geography": geography, "visitor_origin": origin,
                    "origin_level": "country", "metric": "visitor_arrivals" if scale == 1.0 else "visitors",
                    "value": round(value), "unit": "persons",
                    "value_status": "estimate" if month >= "2026-04" else "final",
                    "source": SOURCE, "original_label": "", "publication_date": "",
                    "collection_date": COLLECTED,
                })
        # A total that is NOT the sum of listed origins (other markets exist), like real data.
        for month in grid:
            data.append({
                "reporting_month": month, "geography": geography, "visitor_origin": "All origins",
                "origin_level": "total", "metric": "visitor_arrivals" if scale == 1.0 else "visitors",
                "value": round(totals[month] * 1.9), "unit": "persons",
                "value_status": "estimate" if month >= "2026-04" else "final",
                "source": SOURCE, "original_label": "", "publication_date": "", "collection_date": COLLECTED,
            })
    return data


def competitor_offers() -> list[dict]:
    rows = [
        ("Sample Lantern Tours", "Shinjuku Izakaya Evening (sample)", "Shinjuku", 13500, "3h", "English", "Max 8, 5 stops, drinks extra"),
        ("Sample Lantern Tours", "Shinjuku Izakaya Evening (sample)", "Shinjuku", 13500, "3h", "Spanish", "Monthly departures"),
        ("Demo Alley Walks", "Yanaka Old Town Morning Walk (sample)", "Yanaka", 7000, "2.5h", "English", "Max 10, no food"),
        ("Demo Alley Walks", "Asakusa Street Snack Crawl (sample)", "Asakusa", 11000, "3h", "English", "8 tastings"),
        ("Example Bites Japan", "Tsukiji Outer Market Breakfast (sample)", "Tsukiji", 16800, "3h30m", "English", "Vegetarian option on request"),
        ("Example Bites Japan", "Tsukiji Outer Market Breakfast (sample)", "Tsukiji", 16800, "3h30m", "Chinese", ""),
        ("Fictional Fox Guides", "Shibuya After Dark Food Tour (sample)", "Shibuya", 18500, "3h", "English", "Includes 3 drinks"),
        ("Fictional Fox Guides", "Harajuku Sweets Walk (sample)", "Harajuku", 9800, "2h", "English", "Family friendly"),
        ("Placeholder Paths", "Private Vegan Tokyo Tour (sample)", "Shibuya, Ebisu", 32000, "4h", "English", "Private, price per group of up to 4"),
        ("Placeholder Paths", "Ginza Depachika Tasting (sample)", "Ginza", "", "2h", "English", "Price on request"),
        ("Mock Matsuri Walks", "Kagurazaka Hidden Lanes (sample)", "Kagurazaka", 8500, "2h30m", "English", "Max 6"),
        ("Mock Matsuri Walks", "Kagurazaka Hidden Lanes (sample)", "Kagurazaka", 8500, "2h30m", "French", ""),
        ("Test Tanuki Tours", "Omoide Yokocho Night Walk (sample)", "Shinjuku", 12000, "", "English", "Duration not published"),
        ("Test Tanuki Tours", "Halal-Friendly Tokyo Food Walk (sample)", "Asakusa, Ueno", 14500, "3h", "English", "Halal-certified stops"),
    ]
    data = []
    for business, tour, area, price, duration, language, notes in rows:
        slug = tour.lower().replace(" (sample)", "").replace(" ", "-")
        data.append({"business": business, "tour_name": tour, "area": area, "price": price,
                     "currency": "JPY" if price != "" else "", "duration": duration, "language": language,
                     "url": f"https://example.com/{slug}", "date_observed": "2026-06-20",
                     "notes": notes, "source": SOURCE})
    # A second observation of one offer with a price change (price history).
    data.append({**data[0], "price": 14500, "date_observed": "2026-07-10"})
    return data


FEEDBACK = [
    ("Our guide was so knowledgeable and funny. Best food tour we've done anywhere.", 5),
    ("Loved the izakaya stops but we walked too fast between them, my parents struggled.", 4),
    ("Great food but I'm vegetarian and only two of the six tastings worked for me.", 3),
    ("The meeting point was hard to find, we were 10 minutes late and missed the first stop.", 3),
    ("Fantastic hidden alleys, felt like we saw where locals actually eat.", 5),
    ("A bit expensive for what was included, drinks should not be extra at this price.", 3),
    ("Group was 14 people, too big to hear the guide in the narrow lanes.", 2),
    ("Learned so much about Japanese etiquette and the history of the yokocho.", 5),
    ("It was extremely hot and humid in August, more water breaks would help.", 4),
    ("We have a toddler in a stroller and some stairs were difficult. Please say so when booking.", 3),
    ("Halal options were clearly explained, thank you for planning this so carefully.", 5),
    ("The tour ran 40 minutes over and we missed our dinner reservation.", 3),
    ("Guide's English was clear and she answered every question.", 5),
    ("Too crowded at the famous market, the quieter side streets were much better.", 4),
    ("Would love a private tour option for our family next time.", 5),
    ("Rain all evening but the guide had umbrellas for everyone. Great service.", 5),
    ("Portions were small, I was still hungry afterwards.", 3),
    ("Booking confirmation email never arrived, had to message on WhatsApp.", 3),
    ("Great value, more tastings than I expected.", 5),
    ("My wife has a shellfish allergy and the guide checked every dish. Very reassuring.", 5),
    ("Felt rushed at the end, three hours was not enough for all the stops.", 4),
    ("The sake tasting was the highlight, very well explained.", 5),
    ("Not suitable for someone with limited mobility, lots of walking and steps.", 2),
    ("A small group of six made it feel personal and relaxed.", 5),
    ("Expected more about the history of the area and less shopping.", 3),
    ("Start time of 5pm was perfect after a day of sightseeing.", 5),
    ("We booked the English tour but the guide often switched to Japanese with the shop owners without translating.", 3),
    ("Vegan friend had almost nothing to eat. Please offer a plant-based version.", 2),
    ("Would pay more for a smaller group.", 4),
    ("The ramen stop was incredible, we went back the next day.", 5),
    ("Guide recommended places for the rest of our trip, super helpful.", 5),
    ("Hard to find the start, the map in the email pointed to the wrong exit.", 2),
    ("Too much walking in the heat, would prefer fewer stops closer together.", 3),
    ("Great for first-time visitors, explained how to order and pay.", 5),
    ("Kids loved the sweets, but it was a long evening for them.", 4),
    ("Price seemed fair compared with other tours we looked at.", 4),
    ("ガイドさんがとても親切で、英語の説明も分かりやすかったです。", 5),
    ("La comida estaba deliciosa, pero el grupo era demasiado grande.", 4),
    ("Queue at the first stop took 25 minutes, that time could have been used better.", 3),
    ("Gluten-free options were limited but the guide tried hard.", 4),
]


def feedback() -> list[dict]:
    data = []
    for i, (text, rating) in enumerate(FEEDBACK):
        lang = "ja" if "ガイド" in text else ("es" if text.startswith("La ") else "en")
        pub = f"2026-{(i % 6) + 1:02d}-{(i * 3) % 27 + 1:02d}"
        data.append({"text": text, "language": lang, "source": "Synthetic demo survey",
                     "rating": rating if i % 7 else "", "permission_basis": "Synthetic text written for demonstration",
                     "publication_date": pub if i % 5 else "", "collection_date": COLLECTED})
    return data


def news() -> list[dict]:
    items = [
        ("(Synthetic) City announces extended evening hours for visitor information centres",
         "A fictional announcement used to demonstrate news import. Centres would stay open until 21:00.", "2026-05-12"),
        ("(Synthetic) Survey finds visitors want more plant-based options at food stalls",
         "Invented survey summary for demonstration; no real survey exists.", "2026-04-03"),
        ("(Synthetic) Summer heat advisory issued for central Tokyo wards",
         "Fictional heat advisory used to demonstrate how news can provide context for feedback.", "2026-07-02"),
        ("(Synthetic) New direct flights announced between Tokyo and a European hub",
         "Demonstration headline. Route announcements may affect arrivals but are not demand evidence.", "2026-03-20"),
        ("(Synthetic) Popular market street introduces crowd management at weekends",
         "Fictional item about queue management at a busy market street.", "2026-06-15"),
    ]
    return [{"title": t, "excerpt": e, "url": f"https://example.com/demo-news/{i + 1}",
             "publisher": "Demo News (synthetic)", "publication_date": d, "collection_date": COLLECTED}
            for i, (t, e, d) in enumerate(items)]


if __name__ == "__main__":
    vs_header = ["reporting_month", "geography", "visitor_origin", "origin_level", "metric", "value", "unit",
                 "value_status", "source", "original_label", "publication_date", "collection_date"]
    write("demo_visitor_stats.csv", vs_header, visitor_stats())
    write("demo_competitor_offers.csv", ["business", "tour_name", "area", "price", "currency", "duration", "language",
                                         "url", "date_observed", "notes", "source"], competitor_offers())
    write("demo_feedback.csv", ["text", "language", "source", "rating", "permission_basis", "publication_date",
                                "collection_date"], feedback())
    write("demo_news.csv", ["title", "excerpt", "url", "publisher", "publication_date", "collection_date"], news())
