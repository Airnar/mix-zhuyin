#!/usr/bin/env python3
"""Builds output/pime/lookup_dict.json, the 框選查詢 dictionary.

Source: CC-CEDICT (https://www.mdbg.net/chinese/dictionary?page=cc-cedict),
licensed under CC BY-SA 4.0, so the output is CC BY-SA 4.0 too.

Usage:
    curl -L -o cedict.txt.gz \
        https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz
    python3 tools/mixed/build_lookup_dict.py --cedict cedict.txt.gz \
        --webdata src/McBopomofo/WebData.ts --output output/pime/lookup_dict.json

Output: {"source": ..., "zh": {traditional: [English meanings]},
         "en": {english word: [traditional words, most common first]}}.
Chinese words are kept when McBopomofo's dictionary has them (or they are a
single character), so the file stays small and leans to Taiwan usage. The
English index is built from meanings that are one to three plain words.
"""

import argparse
import gzip
import json
import re

LINE = re.compile(r"^(\S+) (\S+) \[([^\]]*)\] /(.*)/\s*$")
HAN = re.compile(r"^[㐀-鿿豈-﫿\U00020000-\U0003ffff〇]+$")
PLAIN_ENGLISH = re.compile(r"^[a-z][a-z' -]*$")
SKIP_PREFIXES = (
    "cl:",
    "variant of",
    "old variant of",
    "japanese variant of",
    "see ",
    "see also",
    "used in ",
    "abbr. for",
    "erhua variant",
    "(old)",
    "(archaic)",
)


def read_webdata_scores(path):
    """Highest unigram score of each phrase in McBopomofo's dictionary."""
    text = open(path, encoding="utf-8").read()
    start = text.index("`") + 1
    end = text.rindex("`")
    data = json.loads(text[start:end].replace("\\`", "`"))
    scores = {}
    for key, value in data.items():
        if key.startswith("_"):
            continue
        parts = value.split(" ")
        for i in range(0, len(parts) - 1, 2):
            word, score = parts[i], float(parts[i + 1])
            if word not in scores or score > scores[word]:
                scores[word] = score
    return scores


def clean_meanings(raw):
    meanings = []
    for gloss in raw.split("/"):
        gloss = gloss.strip()
        lower = gloss.lower()
        if not gloss or lower.startswith(SKIP_PREFIXES):
            continue
        # Cross references (傳統|传统[chuan2 tong3]) mean little in a popup.
        if "|" in gloss or "[" in gloss:
            continue
        meanings.append(gloss)
    return meanings


def english_keys(meaning):
    """Index words for an English meaning: "to run (a business)" -> run."""
    key = re.sub(r"\([^)]*\)", "", meaning.lower()).strip()
    key = re.sub(r"^(to|a|an|the) ", "", key).strip()
    key = re.sub(r"\s+", " ", key)
    if PLAIN_ENGLISH.match(key) and 0 < len(key.split(" ")) <= 3:
        return [key]
    return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cedict", required=True)
    ap.add_argument("--webdata", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--meanings", type=int, default=3)
    ap.add_argument("--words-per-english", type=int, default=5)
    args = ap.parse_args()

    scores = read_webdata_scores(args.webdata)
    opener = gzip.open if args.cedict.endswith(".gz") else open
    zh = {}
    with opener(args.cedict, "rt", encoding="utf-8") as f:
        for line in f:
            if line.startswith("#"):
                continue
            m = LINE.match(line.strip())
            if not m:
                continue
            trad, _simp, _pinyin, raw = m.groups()
            if not HAN.match(trad) or len(trad) > 8:
                continue
            if trad not in scores and len(trad) > 1:
                continue
            meanings = clean_meanings(raw)
            if not meanings:
                continue
            kept = zh.setdefault(trad, [])
            for meaning in meanings:
                if meaning not in kept:
                    kept.append(meaning)

    en = {}
    for trad, meanings in zh.items():
        if trad not in scores:
            continue
        for meaning in meanings:
            for key in english_keys(meaning):
                en.setdefault(key, set()).add(trad)

    def rank(word):
        return (-scores.get(word, -99.0), len(word))

    out = {
        "source": "CC-CEDICT (CC BY-SA 4.0), filtered with McBopomofo's dictionary",
        "zh": {k: v[: args.meanings] for k, v in sorted(zh.items())},
        "en": {
            k: sorted(v, key=rank)[: args.words_per_english]
            for k, v in sorted(en.items())
        },
    }
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(out['zh'])} Chinese entries, {len(out['en'])} English entries")


if __name__ == "__main__":
    main()
