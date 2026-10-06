"""Adapter for the Japan Tourism Agency's visitor spending workbooks
(インバウンド消費動向調査, formerly 訪日外国人消費動向調査).

Source page: https://www.mlit.go.jp/kankocho/tokei_hakusyo/gaikokujinshohidoko.html

Two kinds of workbook are published each quarter (checked against the
2025-Q2 and 2026-Q2 files, published as .xls and .xlsx respectively):

1. 集計表 (national tables). We read
   - 参考2  spend per visitor by category and item, per nationality
            (package-tour fees broken down into their parts)
   - 表2-1  share of visitors who bought each item (購入率) and what buyers
            spent on it (購入者単価), per nationality
2. 都道府県別集計表 (prefecture tables). We read
   - 表1-1  visitors, visit rate and spend per visitor, per prefecture
   - 表1-3  total visitor spending by category, per prefecture

Rules:
- Values are stored in base units: yen, persons, percent. 億円, 万人 and
  万円 are converted on import, after checking the unit text in the sheet.
- The header line says whether figures are preliminary (速報) or final (確報).
- A blank cell is not published: no record (missing, not zero).
- These are survey estimates. The respondent count behind each figure is
  stored so small samples can be flagged.
- The nationality groups changed in 2026 (21 -> 24 groups: Mexico, the Nordic
  countries and the Middle East left 'Other'), so 'Other' is not comparable
  across those years.
"""
import io
import re
import unicodedata
from datetime import date
from pathlib import Path

from app.importers.service import ParsedFile, RowError

SEGMENTS: dict[str, str] = {
    "全国籍・地域": "All nationalities",
    "韓国": "South Korea", "台湾": "Taiwan", "香港": "Hong Kong", "中国": "China", "タイ": "Thailand",
    "シンガポール": "Singapore", "マレーシア": "Malaysia", "インドネシア": "Indonesia", "フィリピン": "Philippines",
    "ベトナム": "Vietnam", "インド": "India", "英国": "United Kingdom", "ドイツ": "Germany", "フランス": "France",
    "イタリア": "Italy", "スペイン": "Spain", "ロシア": "Russia", "米国": "United States", "カナダ": "Canada",
    "メキシコ": "Mexico", "オーストラリア": "Australia", "北欧": "Nordic countries", "中東": "Middle East",
    "その他": "Other",
}

# Category rows (column C in the sheets) and item rows (column D) -> stable keys.
CATEGORIES: dict[str, str] = {
    "団体パッケージツアー": "group_package_tour",
    "個人旅行向けパッケージ商品": "individual_package",
    "往復航空(船舶)運賃": "international_fares",
    "宿泊費": "lodging",
    "飲食費": "food_drink",
    "交通費": "transport",
    "娯楽等サービス費": "entertainment",
    "買物代": "shopping",
    "その他": "other",
}
ITEMS: dict[str, str] = {
    "航空(日本国内移動のみ)": "domestic_flights",
    "Japan Rail Pass": "japan_rail_pass",
    "新幹線・鉄道・地下鉄・モノレール": "rail",
    "バス": "bus",
    "タクシー": "taxi",
    "レンタカー": "car_rental",
    "船舶(日本国内移動のみ)": "domestic_ferries",
    "その他交通費": "other_transport",
    "現地ツアー・観光ガイド": "local_tours_guides",
    "ゴルフ場・スポーツ施設利用料": "golf_sports_facilities",
    "テーマパーク": "theme_parks",
    "舞台・音楽鑑賞": "stage_music",
    "スポーツ観戦": "spectator_sports",
    "美術館・博物館・動植物園・水族館": "museums_zoos_aquariums",
    "スキー場リフト": "ski_lifts",
    "温泉・温浴施設・エステ・リラクゼーション": "onsen_spa_relaxation",
    "マッサージ・医療費": "massage_medical",
    "展示会・コンベンション参加費": "exhibitions_conventions",
    "レンタル料(レンタカーを除く)": "rentals",
    "その他娯楽等サービス費": "other_entertainment",
    "菓子類": "sweets_snacks",
    "酒類": "alcohol",
    "生鮮農産物": "fresh_produce",
    "その他食料品・飲料・たばこ": "other_food_tobacco",
    "化粧品・香水": "cosmetics_perfume",
    "医薬品": "medicines",
    "健康グッズ・トイレタリー": "health_toiletries",
    "衣類": "clothing",
    "靴・かばん・革製品": "shoes_bags_leather",
    "電気製品(デジタルカメラ/PC/家電等)": "electronics",
    "時計・フィルムカメラ": "watches_cameras",
    "宝石・貴金属": "jewellery",
    "民芸品・伝統工芸品": "crafts_traditional",
    "本・雑誌・ガイドブックなど": "books_magazines",
    "音楽・映像・ゲームなどソフトウェア": "music_video_games",
    "その他買物代": "other_shopping",
}
# Column order of the prefecture spending table (表1-3), after the total.
PREFECTURE_CATEGORIES = ["package_tours", "lodging", "food_drink", "transport", "entertainment", "shopping", "other"]
PREFECTURE_CATEGORY_LABELS = ["団体・パック", "宿泊費", "飲食費", "交通費", "娯楽等", "買物代", "その他"]

PREFECTURES: dict[str, str] = {
    "北海道": "Hokkaido", "青森県": "Aomori", "岩手県": "Iwate", "宮城県": "Miyagi", "秋田県": "Akita",
    "山形県": "Yamagata", "福島県": "Fukushima", "茨城県": "Ibaraki", "栃木県": "Tochigi", "群馬県": "Gunma",
    "埼玉県": "Saitama", "千葉県": "Chiba", "東京都": "Tokyo", "神奈川県": "Kanagawa", "新潟県": "Niigata",
    "富山県": "Toyama", "石川県": "Ishikawa", "福井県": "Fukui", "山梨県": "Yamanashi", "長野県": "Nagano",
    "岐阜県": "Gifu", "静岡県": "Shizuoka", "愛知県": "Aichi", "三重県": "Mie", "滋賀県": "Shiga",
    "京都府": "Kyoto", "大阪府": "Osaka", "兵庫県": "Hyogo", "奈良県": "Nara", "和歌山県": "Wakayama",
    "鳥取県": "Tottori", "島根県": "Shimane", "岡山県": "Okayama", "広島県": "Hiroshima", "山口県": "Yamaguchi",
    "徳島県": "Tokushima", "香川県": "Kagawa", "愛媛県": "Ehime", "高知県": "Kochi", "福岡県": "Fukuoka",
    "佐賀県": "Saga", "長崎県": "Nagasaki", "熊本県": "Kumamoto", "大分県": "Oita", "宮崎県": "Miyazaki",
    "鹿児島県": "Kagoshima", "沖縄県": "Okinawa",
}

PERIOD = re.compile(r"(\d{4})年(?:\(令和\d+年\))?\s*(?:(\d{1,2})-(\d{1,2})月期|(暦年))")
QUARTER_BY_START = {1: 1, 4: 2, 7: 3, 10: 4}


def _n(value) -> str:
    """NFKC-normalized text: full-width brackets, half-width katakana and ･ become standard forms."""
    return unicodedata.normalize("NFKC", str(value)).strip() if value not in (None, "") else ""


def _num(value) -> float | None:
    if value is None or value == "" or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = _n(value).replace(",", "")
    if text in ("", "-", "‐", "―", "—", "*", "x", "X"):
        return None
    try:
        return float(text)
    except ValueError:
        return None


def read_sheets(content: bytes, filename: str) -> dict[str, list[list]]:
    """All sheets as lists of rows. .xlsx via openpyxl, legacy .xls via xlrd."""
    if Path(filename).suffix.lower() == ".xls":
        import xlrd
        book = xlrd.open_workbook(file_contents=content)
        return {s.name: [s.row_values(i) for i in range(s.nrows)] for s in book.sheets()}
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    try:
        return {ws.title: [list(r) for r in ws.iter_rows(values_only=True)] for ws in wb.worksheets}
    finally:
        wb.close()


def _cell(rows: list[list], r: int, c: int):
    return rows[r][c] if r < len(rows) and c < len(rows[r]) else None


def find_period(sheets: dict[str, list[list]]) -> tuple[str, str, str] | None:
    """(reporting_period, period_type, value_status) from the first header that names a period."""
    status = "unknown"
    found = None
    for rows in sheets.values():
        for row in rows[:12]:
            for value in row:
                text = _n(value)
                if not text:
                    continue
                if "確報" in text:
                    status = "final"
                elif "速報" in text and status == "unknown":
                    status = "preliminary"
                m = PERIOD.search(text)
                if m and found is None:
                    year = int(m.group(1))
                    if m.group(4):
                        found = (f"{year}", "year")
                    elif int(m.group(2)) in QUARTER_BY_START:
                        found = (f"{year}-Q{QUARTER_BY_START[int(m.group(2))]}", "quarter")
        if found and status != "unknown":
            break
    return (*found, status) if found else None


def detect_kind(sheets: dict[str, list[list]]) -> str | None:
    def title(name: str) -> str:
        return " ".join(_n(c) for row in sheets.get(name, [])[:4] for c in row if c not in (None, ""))
    if "参考2" in sheets and "費目別" in title("参考2") and "国籍" in title("参考2"):
        return "national"
    if "表1-3" in sheets and "都道府県" in title("表1-3") and "旅行消費額" in title("表1-3"):
        return "prefecture"
    return None


def parse_jta_spending_workbook(content: bytes, filename: str, collection_date: str | None = None,
                                publication_date: str | None = None) -> ParsedFile:
    result = ParsedFile(importer="jta_spending_xlsx")
    try:
        sheets = read_sheets(content, filename)
    except Exception as exc:
        result.errors.append(RowError(None, None, f"Could not open the workbook: {exc}"))
        return result

    kind = detect_kind(sheets)
    if kind is None:
        result.errors.append(RowError(None, None,
                                      "This doesn't look like a Japan Tourism Agency spending workbook. Expected the "
                                      "集計表 (with sheet 参考2) or the 都道府県別集計表 (with sheet 表1-3)."))
        return result
    period = find_period(sheets)
    if period is None:
        result.errors.append(RowError(None, None, "Could not find the period (e.g. 2026年4-6月期) in the sheet headers."))
        return result
    reporting_period, period_type, status = period
    base = {"reporting_period": reporting_period, "period_type": period_type, "purpose": "all",
            "value_status": status, "source": "JTA", "publication_date": publication_date,
            "collection_date": collection_date or date.today().isoformat()}

    unknown: set[str] = set()
    if kind == "national":
        _parse_national(sheets, "参考2", base, result, unknown)
        if "表2-1" in sheets:
            _parse_national(sheets, "表2-1", base, result, unknown)
        else:
            result.warnings.append("Sheet 表2-1 (purchase rates) was not found; only spend per visitor was imported.")
    else:
        _parse_prefecture_visitors(sheets, base, result)
        _parse_prefecture_spending(sheets, base, result)

    if unknown:
        result.warnings.append("Labels without a translation were kept as-is: " + ", ".join(sorted(unknown)))
    if status == "preliminary":
        result.warnings.append("These figures are preliminary (速報). Import the final (確報) release later to "
                               "update them; old values are kept in the revision history.")
    if not result.records and not result.errors:
        result.errors.append(RowError(None, None, "No figures were found in the expected tables."))
    return result


METRICS = {"消費単価": ("spend_per_person", "JPY per person"),
           "購入率": ("purchase_rate", "%"),
           "購入者単価": ("spend_per_purchaser", "JPY per person")}


def _parse_national(sheets, sheet: str, base: dict, result: ParsedFile, unknown: set[str]) -> None:
    """Blocks start with a '調査項目' header row (segment names), followed by a row naming the metric per column."""
    rows = sheets[sheet]
    columns: dict[int, tuple[str, str, str, int | None]] = {}  # value col -> (segment, metric, unit, respondents col)
    category = None
    for r, row in enumerate(rows):
        cells = [_n(c) for c in row]
        if "調査項目" in cells:
            columns, category = {}, None
            metric_row = [_n(c) for c in rows[r + 1]] if r + 1 < len(rows) else []
            for c, name in enumerate(cells):
                if c < 3 or not name:
                    continue
                segment = SEGMENTS.get(name)
                if segment is None:
                    unknown.add(name)
                    segment = name
                # A segment spans two columns: (回答数 | value) in 表2-1, (消費単価 | 構成比) in 参考2.
                for vc in (c, c + 1):
                    label = metric_row[vc] if vc < len(metric_row) else ""
                    if label in METRICS:
                        resp = c if vc == c + 1 and (metric_row[c] if c < len(metric_row) else "") == "回答数" else None
                        columns[vc] = (segment, *METRICS[label], resp)
                        break
            continue
        if not columns:
            continue
        label_cat, label_item = cells[2] if len(cells) > 2 else "", cells[3] if len(cells) > 3 else ""
        group = cells[1] if len(cells) > 1 else ""
        if group.startswith(("注", "※")):
            columns = {}
            continue
        if group.startswith("全体"):
            key_cat, key_item, original = "total", "", "全体"
        elif label_cat:
            key_cat = CATEGORIES.get(label_cat)
            if key_cat is None:
                unknown.add(label_cat)
                key_cat = label_cat
            category, key_item, original = key_cat, "", label_cat
        elif label_item and category:
            key_item = ITEMS.get(label_item)
            if key_item is None:
                unknown.add(label_item)
                key_item = label_item
            key_cat, original = category, label_item
        else:
            continue
        for vc, (segment, metric, unit, resp_col) in columns.items():
            value = _num(_cell(rows, r, vc))
            if value is None:
                continue
            respondents = _num(_cell(rows, r, resp_col)) if resp_col is not None else None
            result.records.append({**base, "geography": "Japan", "segment": segment, "category": key_cat,
                                   "item": key_item, "metric": metric, "value": value, "unit": unit,
                                   "respondents": None if respondents is None else int(respondents),
                                   "original_label": f"{sheet} {original}", "_row": r + 1})


def _prefecture_rows(rows: list[list]):
    for r, row in enumerate(rows):
        name = _n(_cell(rows, r, 1))
        if name in PREFECTURES and isinstance(_num(_cell(rows, r, 0)), float):
            yield r, PREFECTURES[name], name


def _unit_text(rows: list[list]) -> str:
    return " ".join(_n(c) for row in rows[:8] for c in row if c not in (None, ""))


def _parse_prefecture_visitors(sheets, base: dict, result: ParsedFile) -> None:
    rows = sheets.get("表1-1")
    if not rows:
        result.warnings.append("Sheet 表1-1 (visitors per prefecture) was not found.")
        return
    units = _unit_text(rows)
    if "万人" not in units or "万円" not in units:
        result.errors.append(RowError(None, "表1-1", "Unexpected units in 表1-1 (expected 万人 and 万円/人)."))
        return
    for r, pref, original in _prefecture_rows(rows):
        sample = _num(_cell(rows, r, 2))
        for col, metric, factor, unit in ((3, "visit_rate", 100, "%"), (4, "visitors", 10_000, "persons"),
                                          (6, "spend_per_person", 10_000, "JPY per person")):
            value = _num(_cell(rows, r, col))
            if value is None:
                continue
            respondents = _num(_cell(rows, r, 5)) if col == 6 else sample
            result.records.append({**base, "geography": pref, "segment": "All nationalities", "category": "total",
                                   "item": "", "metric": metric, "value": value * factor, "unit": unit,
                                   "respondents": None if respondents is None else int(respondents),
                                   "original_label": f"表1-1 {original}", "_row": r + 1})


def _parse_prefecture_spending(sheets, base: dict, result: ParsedFile) -> None:
    rows = sheets["表1-3"]
    units = _unit_text(rows)
    if "億円" not in units:
        result.errors.append(RowError(None, "表1-3", "Unexpected units in 表1-3 (expected 億円)."))
        return
    header = " ".join(_n(c) for row in rows[4:9] for c in row if c not in (None, ""))
    missing = [label for label in PREFECTURE_CATEGORY_LABELS if label not in header]
    if missing:
        result.errors.append(RowError(None, "表1-3", f"Category columns not where expected (missing {', '.join(missing)})."))
        return
    for r, pref, original in _prefecture_rows(rows):
        for col, category in [(2, "total"), *((3 + i, c) for i, c in enumerate(PREFECTURE_CATEGORIES))]:
            value = _num(_cell(rows, r, col))
            if value is None:
                continue
            result.records.append({**base, "geography": pref, "segment": "All nationalities", "category": category,
                                   "item": "", "metric": "total_spend", "value": value * 100_000_000, "unit": "JPY",
                                   "respondents": None, "original_label": f"表1-3 {original}", "_row": r + 1})
