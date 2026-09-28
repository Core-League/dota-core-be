#!/usr/bin/env python3
"""
Build the bundled location catalog for `LocationsService` from GeoNames dumps.

Output (committed, read at runtime by src/locations/locations.service.ts):
  src/locations/data/countries.json        -> [{ "code": "UA", "name": "Ukraine" }, ...]
  src/locations/data/cities/<CC>.json      -> ["Київ", "Львів", ...]  (Ukrainian name when GeoNames
                                              has one, otherwise the GeoNames default name)

Inputs (https://download.geonames.org/export/dump/, CC BY 4.0), downloaded into --src:
  countryInfo.txt         ISO codes + English names
  cities1000.zip          every populated place with population >= 1000
  alternateNamesV2.zip    localized names; we only keep isolanguage == "uk"

Usage:
  python scripts/build-locations.py --src /path/with/dumps [--out src/locations/data]

Stdlib only; runs in a couple of minutes (alternateNamesV2 is ~200 MB zipped and is streamed).
Re-run only when the dumps change — this is a one-off data step, not part of `npm run build`.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import zipfile

EXCLUDED = {"RU", "BY", "IR"}  # mirrors EXCLUDED_COUNTRY_CODES in locations.service.ts

# GeoNames feature codes we treat as "a city or town someone lives in".
PLACE_CODES = {"PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLC", "PPLG", "PPLS"}
MIN_POPULATION = 5000  # worldwide
MIN_POPULATION_BY_COUNTRY = {"UA": 1000}  # home audience: keep small Ukrainian towns
# Countries whose list must be fully Ukrainian: places without a `uk` name are dropped
# instead of falling back to the Latin GeoNames name (mixed scripts read as broken).
REQUIRE_UK_NAME = {"UA"}


def read_countries(path: str) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    with io.open(path, encoding="utf-8") as f:
        for line in f:
            if not line.strip() or line.startswith("#"):
                continue
            cols = line.rstrip("\n").split("\t")
            code, name = cols[0].strip().upper(), cols[4].strip()
            if len(code) != 2 or not name or code in EXCLUDED:
                continue
            out.append({"code": code, "name": name})
    out.sort(key=lambda c: c["name"])
    return out


def read_places(zip_path: str) -> dict[int, tuple[str, str]]:
    """geonameid -> (countryCode, defaultName) for places passing the population filter."""
    places: dict[int, tuple[str, str]] = {}
    with zipfile.ZipFile(zip_path) as zf:
        member = next(n for n in zf.namelist() if n.endswith(".txt"))
        with zf.open(member) as raw, io.TextIOWrapper(raw, encoding="utf-8") as f:
            for line in f:
                cols = line.rstrip("\n").split("\t")
                if len(cols) < 15:
                    continue
                geonameid, name, feature_class, feature_code = int(cols[0]), cols[1].strip(), cols[6], cols[7]
                country, population = cols[8].strip().upper(), int(cols[14] or 0)
                if feature_class != "P" or feature_code not in PLACE_CODES or not name:
                    continue
                if country in EXCLUDED or len(country) != 2:
                    continue
                if population < MIN_POPULATION_BY_COUNTRY.get(country, MIN_POPULATION):
                    continue
                places[geonameid] = (country, name)
    return places


def has_cyrillic(text: str) -> bool:
    return any("Ѐ" <= ch <= "ӿ" for ch in text)


def read_uk_names(zip_path: str, wanted: set[int]) -> dict[int, str]:
    """
    geonameid -> Ukrainian name (preferred one wins; historic/colloquial skipped).
    GeoNames tags some Latin transliterations as "uk" — those are not Ukrainian text and are ignored.
    """
    names: dict[int, str] = {}
    preferred: set[int] = set()
    with zipfile.ZipFile(zip_path) as zf:
        member = next(n for n in zf.namelist() if n.endswith("alternateNamesV2.txt"))
        with zf.open(member) as raw, io.TextIOWrapper(raw, encoding="utf-8") as f:
            for line in f:
                cols = line.rstrip("\n").split("\t")
                if len(cols) < 4 or cols[2] != "uk":
                    continue
                geonameid = int(cols[1])
                if geonameid not in wanted or geonameid in preferred:
                    continue
                name = cols[3].strip()
                if not name or not has_cyrillic(name):
                    continue
                is_preferred = len(cols) > 4 and cols[4] == "1"
                is_colloquial = len(cols) > 6 and cols[6] == "1"
                is_historic = len(cols) > 7 and cols[7] == "1"
                if is_colloquial or is_historic:
                    continue
                if is_preferred:
                    names[geonameid] = name
                    preferred.add(geonameid)
                elif geonameid not in names:
                    names[geonameid] = name
    return names


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="folder with countryInfo.txt, cities1000.zip, alternateNamesV2.zip")
    ap.add_argument("--out", default=os.path.join("src", "locations", "data"))
    args = ap.parse_args()

    countries = read_countries(os.path.join(args.src, "countryInfo.txt"))
    places = read_places(os.path.join(args.src, "cities1000.zip"))
    uk_names = read_uk_names(os.path.join(args.src, "alternateNamesV2.zip"), set(places))

    by_country: dict[str, set[str]] = {}
    for geonameid, (country, default_name) in places.items():
        uk_name = uk_names.get(geonameid)
        if uk_name is None and country in REQUIRE_UK_NAME:
            continue
        by_country.setdefault(country, set()).add(uk_name or default_name)

    cities_dir = os.path.join(args.out, "cities")
    os.makedirs(cities_dir, exist_ok=True)
    for old in os.listdir(cities_dir):
        if old.endswith(".json"):
            os.remove(os.path.join(cities_dir, old))

    known_codes = {c["code"] for c in countries}
    written = 0
    for country, names in sorted(by_country.items()):
        if country not in known_codes:
            continue
        with io.open(os.path.join(cities_dir, f"{country}.json"), "w", encoding="utf-8", newline="\n") as f:
            json.dump(sorted(names), f, ensure_ascii=False, separators=(",", ":"))
            f.write("\n")
        written += 1

    with io.open(os.path.join(args.out, "countries.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(countries, f, ensure_ascii=False, indent=2)
        f.write("\n")

    ua_total = sum(1 for cc, _ in places.values() if cc == "UA")
    print(f"countries: {len(countries)}; city files: {written}; places: {len(places)}; with uk name: {len(uk_names)}")
    print(f"UA: {ua_total} places in dump, {len(by_country.get('UA', set()))} kept with Ukrainian names")


if __name__ == "__main__":
    main()
