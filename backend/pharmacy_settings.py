"""Pharmacy > Settings lists kept on the server (shared by every desk).

dosage_forms:    ["Tablets & Capsules", ...]
store_locations: [{"name": ..., "code": ..., "desc": ...}, ...]
Until a list is saved the built-in defaults are returned.
"""
import json

from legacy_sql import get_connection

DEFAULT_DOSAGE_FORMS = [
    "Tablets & Capsules", "Syrups & Oral Suspensions", "Injections & IV Fluids",
    "Topical Creams & Ointments", "Eye / Ear Drops", "Inhalers & Sprays",
]
DEFAULT_STORE_LOCATIONS = [
    {"name": "Main Central Pharmacy", "code": "PHARM-MAIN", "desc": "Ground floor outpatient & central dispensing"},
    {"name": "Emergency Fast-Rack", "code": "RACK-EMERGENCY", "desc": "Crash cart & acute emergency drugs"},
    {"name": "Cold Chain Storage (2°C - 8°C)", "code": "COLD-STORAGE", "desc": "Insulins, vaccines, and sera"},
    {"name": "IPD Floor 2 Storage Cabinet", "code": "CAB-IPD-2", "desc": "Inpatient routine ward stock"},
]
MAX_ITEMS = 200


def _clean_text(value, limit):
    return " ".join(str(value or "").split())[:limit]


def _clean_dosage_forms(value):
    if not isinstance(value, list):
        raise ValueError("dosage_forms must be a list.")
    out, seen = [], set()
    for item in value[:MAX_ITEMS]:
        name = _clean_text(item, 80)
        if name and name.lower() not in seen:
            seen.add(name.lower())
            out.append(name)
    return out


def _clean_store_locations(value):
    if not isinstance(value, list):
        raise ValueError("store_locations must be a list.")
    out, codes = [], set()
    for item in value[:MAX_ITEMS]:
        if not isinstance(item, dict):
            raise ValueError("Each store location must have a name and code.")
        name = _clean_text(item.get("name"), 80)
        code = _clean_text(item.get("code"), 40).upper().replace(" ", "-")
        if not name or not code:
            raise ValueError("Each store location needs a name and a code.")
        if code in codes:
            raise ValueError(f"Location code {code} is used twice.")
        codes.add(code)
        out.append({"name": name, "code": code, "desc": _clean_text(item.get("desc"), 200)})
    return out


def get_settings(db):
    with get_connection(db) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT key, value FROM pharmacy_settings WHERE key IN ('dosage_forms', 'store_locations')")
        stored = {r["key"]: r["value"] for r in cursor.fetchall()}

    def load(key, default):
        try:
            value = json.loads(stored[key]) if stored.get(key) is not None else None
        except (TypeError, ValueError):
            value = None
        return value if isinstance(value, list) else default

    return {
        "dosage_forms": load("dosage_forms", DEFAULT_DOSAGE_FORMS),
        "store_locations": load("store_locations", DEFAULT_STORE_LOCATIONS),
    }


def update_settings(db, payload, username):
    """Saves whichever lists are present in payload; returns the full settings."""
    updates = {}
    if "dosage_forms" in payload:
        updates["dosage_forms"] = _clean_dosage_forms(payload["dosage_forms"])
    if "store_locations" in payload:
        updates["store_locations"] = _clean_store_locations(payload["store_locations"])
    if not updates:
        raise ValueError("Nothing to save.")
    with get_connection(db) as conn:
        cursor = conn.cursor()
        for key, value in updates.items():
            cursor.execute(
                """
                INSERT INTO pharmacy_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP
                """,
                (key, json.dumps(value, ensure_ascii=False), username),
            )
        conn.commit()
    return get_settings(db)
