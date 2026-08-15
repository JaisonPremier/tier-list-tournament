#!/usr/bin/env python3
"""Generate data/characters.json from the tier-list spreadsheets.

Deterministic: re-running this script with unchanged spreadsheets produces
byte-identical output. All derived stats come from a character's position
in its franchise tier list plus a name-seeded PRNG (not session randomness),
so every stat is reproducible and inspectable.
"""
import json
import hashlib
import os

import openpyxl

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SOURCE_DIR = os.path.join(SCRIPT_DIR, "sources")
OUT_PATH = os.path.join(SCRIPT_DIR, "data", "characters.json")

SOURCES = [
    {
        "id": "naruto",
        "label": "Naruto",
        "file": os.path.join(SOURCE_DIR, "tier_list_naruto_2.xlsx"),
        "name_col": 2,
        "note_col": None,
        "tier_col": 1,
        "rank_col": 0,
        "pos_col": 3,
    },
    {
        "id": "onepiece",
        "label": "One Piece",
        "file": os.path.join(SOURCE_DIR, "tier_list_one_piece.xlsx"),
        "name_col": 2,
        "note_col": 3,
        "tier_col": 1,
        "rank_col": 0,
        "pos_col": 4,
    },
]

# Five sub-stats derived per character. Weights must sum to 1.0 and are
# used identically by the client when it recomputes "Character Power".
SUBSTATS = ["speed", "durability", "hax", "battleIQ"]


def seeded_unit(seed_str):
    """Deterministic pseudo-random float in [0, 1) from a string seed."""
    digest = hashlib.sha256(seed_str.encode("utf-8")).hexdigest()
    return int(digest[:8], 16) / 0xFFFFFFFF


def build_franchise(source):
    wb = openpyxl.load_workbook(source["file"], data_only=True)
    ws = wb["Tier List"]
    rows = list(ws.iter_rows(values_only=True))[1:]  # skip header

    entries = []
    for row in rows:
        if row is None:
            continue
        name = row[source["name_col"]]
        if not name:
            continue
        tier_rank = row[source["rank_col"]]
        tier_label = row[source["tier_col"]]
        position = row[source["pos_col"]] if source["pos_col"] is not None else 1
        note = row[source["note_col"]] if source["note_col"] is not None else None
        display_name = f"{name} ({note})" if note else str(name)
        entries.append({
            "name": str(name),
            "displayName": display_name,
            "tierRank": tier_rank,
            "tierLabel": str(tier_label) if tier_label else "",
            "position": position if position is not None else 1,
        })

    # Sort into canonical strongest-to-weakest order: lower tierRank = stronger,
    # lower position-within-tier = stronger.
    entries.sort(key=lambda e: (e["tierRank"], e["position"]))

    n = len(entries)
    characters = []
    for idx, e in enumerate(entries):
        # basePower: strongest character -> 99, weakest -> 40, linear by ordinal rank.
        if n > 1:
            base_power = 99 - round((idx / (n - 1)) * 59)
        else:
            base_power = 99

        seed_base = f"{source['id']}::{e['displayName']}"
        stats = {"power": base_power}
        for stat in SUBSTATS:
            # +/- 9 point deterministic spread around basePower, clamped 1-100.
            offset = round((seeded_unit(seed_base + "::" + stat) - 0.5) * 18)
            stats[stat] = max(1, min(100, base_power + offset))

        char_id = f"{source['id']}-{idx:03d}"
        characters.append({
            "id": char_id,
            "name": e["name"],
            "displayName": e["displayName"],
            "franchise": source["id"],
            "tierLabel": e["tierLabel"],
            "tierRank": e["tierRank"],
            "ordinal": idx + 1,
            "stats": stats,
        })

    return characters


def main():
    data = {"franchises": []}
    for source in SOURCES:
        chars = build_franchise(source)
        data["franchises"].append({
            "id": source["id"],
            "label": source["label"],
            "count": len(chars),
            "characters": chars,
        })

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    for fr in data["franchises"]:
        print(f"{fr['label']}: {fr['count']} characters -> {OUT_PATH}")


if __name__ == "__main__":
    main()
