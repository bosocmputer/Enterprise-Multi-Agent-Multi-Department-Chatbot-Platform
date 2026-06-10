#!/usr/bin/env python3
"""Evaluate Thai lookup query quality with PyThaiNLP.

This is an offline developer tool. It must not be imported by the Node.js
runtime or called from Telegram/LINE request handling.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Iterable, Optional


SUPPORTED_INPUT_SUFFIXES = {".json", ".jsonl", ".ndjson"}
CUSTOM_DICT_ENGINES = {"newmm", "newmm-safe", "longest"}
SENSITIVE_KEY_NAMES = {
    "accesstoken",
    "alerttelegrambottoken",
    "apikey",
    "authorization",
    "chatid",
    "cookie",
    "groupid",
    "linechannelaccesstoken",
    "linechannelsecret",
    "password",
    "payload",
    "rawpayload",
    "secret",
    "telegrambottoken",
    "token",
    "userid",
    "webhooksecret",
}
SECRET_PATTERNS = [
    re.compile(r"\b\d{8,12}:[A-Za-z0-9_-]{24,}\b"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b"),
    re.compile(r"Bearer\s+[A-Za-z0-9._~+/=-]{16,}", re.IGNORECASE),
]
GENERIC_CONTEXT_MARKERS = [
    "ตัวนี้",
    "อันนี้",
    "ชิ้นนี้",
    "รายการนี้",
    "รุ่นนี้",
    "อันที่แล้ว",
    "ตัวไหน",
    "อันไหน",
    "ถูกสุด",
    "แบบถูกสุด",
    "แพงสุด",
    "ตัวท็อป",
]
STOP_TOKENS = {
    " ",
    "\t",
    "\n",
    "มี",
    "ไหม",
    "มั้ย",
    "เหลือ",
    "เหลือไหม",
    "เหลือมั้ย",
    "ราคา",
    "เท่าไหร่",
    "เท่าไร",
    "เอา",
    "แบบ",
    "ของ",
    "ครับ",
    "ค่ะ",
    "คะ",
    "หน่อย",
}


def main() -> int:
    args = parse_args()
    profile = read_json(args.profile)
    records = load_records(args.input)
    custom_terms = collect_custom_terms(profile, args.catalog_terms)
    tokenizer = create_tokenizer(engine=args.engine, custom_terms=custom_terms)

    evaluated = [
        evaluate_record(
            record=record,
            profile=profile,
            tokenizer=tokenizer,
            include_text=args.include_text,
        )
        for record in records
    ]

    report = build_report(
        profile=profile,
        records=evaluated,
        custom_terms=custom_terms,
        engine=args.engine,
        min_token_count=args.min_token_count,
        pythainlp_version=getattr(tokenizer, "version", "unknown"),
    )

    rendered = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    else:
        print(rendered)
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True, type=Path, help="Business Profile JSON path.")
    parser.add_argument("--input", required=True, type=Path, help="Reviewed/redacted JSON or JSONL query examples.")
    parser.add_argument("--output", type=Path, help="Optional JSON report output path. Defaults to stdout.")
    parser.add_argument("--catalog-terms", type=Path, help="Optional newline or JSON list of catalog-derived terms.")
    parser.add_argument("--engine", default="newmm-safe", help="PyThaiNLP tokenization engine.")
    parser.add_argument("--include-text", action="store_true", help="Include reviewed query text in output.")
    parser.add_argument("--min-token-count", default=1, type=int, help="Minimum count for token group suggestions.")
    return parser.parse_args()


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SystemExit(f"File not found: {path}") from None
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON in {path}: {exc}") from None


def load_records(path: Path) -> list[dict[str, Any]]:
    if path.suffix.lower() not in SUPPORTED_INPUT_SUFFIXES:
        raise SystemExit(f"Unsupported input suffix {path.suffix}; use JSONL or JSON.")

    try:
        raw_text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise SystemExit(f"File not found: {path}") from None

    try:
        if path.suffix.lower() in {".jsonl", ".ndjson"}:
            records = [json.loads(line) for line in raw_text.splitlines() if line.strip()]
        else:
            decoded = json.loads(raw_text)
            records = decoded["records"] if isinstance(decoded, dict) and "records" in decoded else decoded
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid query fixture JSON in {path}: {exc}") from None

    if not isinstance(records, list):
        raise SystemExit("Input must be a JSON array or JSONL records.")

    cleaned: list[dict[str, Any]] = []
    for index, record in enumerate(records, start=1):
        if not isinstance(record, dict):
            raise SystemExit(f"Record {index} must be an object.")
        validate_record_is_redacted(record, index=index)
        text = record.get("text")
        if not isinstance(text, str) or not text.strip():
            raise SystemExit(f"Record {index} must include non-empty text.")
        cleaned.append(record)
    return cleaned


def validate_record_is_redacted(record: dict[str, Any], *, index: int) -> None:
    for key, value in walk_record(record):
        normalized_key = normalize_key(key)
        if normalized_key in SENSITIVE_KEY_NAMES:
            raise SystemExit(f"Record {index} contains sensitive key '{key}'. Use reviewed/redacted input only.")
        if isinstance(value, str) and contains_secret_like_value(value):
            raise SystemExit(f"Record {index} contains a secret-like value at key '{key}'.")


def walk_record(value: Any) -> Iterable[tuple[str, Any]]:
    if isinstance(value, dict):
        for key, child in value.items():
            yield str(key), child
            yield from walk_record(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_record(child)


def normalize_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def contains_secret_like_value(value: str) -> bool:
    return any(pattern.search(value) for pattern in SECRET_PATTERNS)


def collect_custom_terms(profile: dict[str, Any], catalog_terms_path: Optional[Path]) -> list[str]:
    terms: set[str] = set(GENERIC_CONTEXT_MARKERS)

    for example in profile.get("examples", []):
        if isinstance(example, dict):
            terms.add(str(example.get("keyword", "")).strip())

    for alias in profile.get("aliases", []):
        if not isinstance(alias, dict):
            continue
        terms.add(str(alias.get("from", "")).strip())
        for target in alias.get("to", []):
            terms.add(str(target).strip())
            for part in str(target).split():
                terms.add(part.strip())

    if catalog_terms_path:
        terms.update(load_catalog_terms(catalog_terms_path))

    return sorted(term for term in terms if term)


def load_catalog_terms(path: Path) -> list[str]:
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise SystemExit(f"Catalog terms file not found: {path}") from None

    if path.suffix.lower() == ".json":
        decoded = json.loads(text)
        if not isinstance(decoded, list):
            raise SystemExit("Catalog terms JSON must be a list of strings.")
        return [str(item).strip() for item in decoded if str(item).strip()]

    return [line.strip() for line in text.splitlines() if line.strip() and not line.strip().startswith("#")]


def create_tokenizer(*, engine: str, custom_terms: list[str]):
    try:
        import pythainlp
        from pythainlp.tokenize import word_tokenize
    except ImportError:
        raise SystemExit(
            "PyThaiNLP is required for Thai query evaluation. "
            "Install with: python3 -m pip install -r tools/thai-query-eval/requirements.txt"
        ) from None

    custom_dict = None
    if engine in CUSTOM_DICT_ENGINES:
        from pythainlp.corpus.common import thai_words
        from pythainlp.util import Trie

        dictionary_words = set(thai_words())
        dictionary_words.update(custom_terms)
        custom_dict = Trie(dictionary_words)

    def tokenize(text: str) -> list[str]:
        tokens = word_tokenize(text, engine=engine, keep_whitespace=False, custom_dict=custom_dict)
        return [token.strip() for token in tokens if token.strip()]

    tokenize.version = getattr(pythainlp, "__version__", "unknown")  # type: ignore[attr-defined]
    return tokenize


def evaluate_record(
    *,
    record: dict[str, Any],
    profile: dict[str, Any],
    tokenizer,
    include_text: bool,
) -> dict[str, Any]:
    text = record["text"].strip()
    tokens = tokenizer(text)
    alias_matches = find_alias_matches(text, profile.get("aliases", []))
    context_markers = [marker for marker in GENERIC_CONTEXT_MARKERS if marker in text]

    category = "baseline"
    if context_markers:
        category = "context_required_candidate"
    elif alias_matches:
        category = "profile_alias_candidate"
    elif record.get("outcome") in {"no_match", "unsupported"}:
        category = "no_match_regression"

    output: dict[str, Any] = {
        "aliasMatches": alias_matches,
        "category": category,
        "contextMarkers": context_markers,
        "expectedIntent": record.get("expectedIntent"),
        "id": str(record.get("id") or stable_id(text)),
        "outcome": record.get("outcome", "unknown"),
        "source": record.get("source", "reviewed"),
        "textHash": hash_text(text),
        "tokens": tokens,
    }
    if include_text:
        output["text"] = text
    return output


def find_alias_matches(text: str, aliases: Any) -> list[dict[str, Any]]:
    matches: list[dict[str, Any]] = []
    normalized_text = normalize_text(text)
    for alias in aliases:
        if not isinstance(alias, dict):
            continue
        alias_from = str(alias.get("from", "")).strip()
        targets = [str(target).strip() for target in alias.get("to", []) if str(target).strip()]
        if alias_from and normalize_text(alias_from) in normalized_text:
            matches.append({"from": alias_from, "to": targets})
    return matches


def build_report(
    *,
    profile: dict[str, Any],
    records: list[dict[str, Any]],
    custom_terms: list[str],
    engine: str,
    min_token_count: int,
    pythainlp_version: str,
) -> dict[str, Any]:
    poor_quality_outcomes = {"no_match", "unsupported"}
    token_counts = Counter(
        token
        for record in records
        if record["outcome"] in poor_quality_outcomes
        for token in record["tokens"]
        if is_meaningful_token(token)
    )
    alias_suggestions = unique_alias_suggestions(records)
    context_phrases = sorted({marker for record in records for marker in record["contextMarkers"]})

    return {
        "dictionary": {
            "customTermCount": len(custom_terms),
            "customTerms": custom_terms,
        },
        "profile": {
            "businessType": profile.get("businessType"),
            "tenantId": profile.get("tenantId"),
        },
        "records": records,
        "summary": {
            "byCategory": dict(sorted(Counter(record["category"] for record in records).items())),
            "byOutcome": dict(sorted(Counter(str(record["outcome"]) for record in records).items())),
            "totalRecords": len(records),
        },
        "suggestions": {
            "aliases": alias_suggestions,
            "contextRequiredPhrases": context_phrases,
            "noMatchTokenGroups": [
                {"count": count, "token": token}
                for token, count in token_counts.most_common()
                if count >= min_token_count
            ],
            "regressionFixtures": [
                {
                    "category": record["category"],
                    "expectedIntent": record["expectedIntent"],
                    "id": record["id"],
                    "outcome": record["outcome"],
                    "textHash": record["textHash"],
                    "tokens": record["tokens"],
                }
                for record in records
            ],
        },
        "tokenizer": {
            "engine": engine,
            "pythainlpVersion": pythainlp_version,
        },
    }


def unique_alias_suggestions(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    aliases: dict[str, dict[str, Any]] = {}
    for record in records:
        for match in record["aliasMatches"]:
            key = match["from"]
            aliases.setdefault(key, {"from": match["from"], "matchedRecordIds": [], "to": match["to"]})
            aliases[key]["matchedRecordIds"].append(record["id"])
    return sorted(aliases.values(), key=lambda item: item["from"])


def is_meaningful_token(token: str) -> bool:
    normalized = token.strip().lower()
    if not normalized or normalized in STOP_TOKENS:
        return False
    return len(normalized) >= 2 or bool(re.fullmatch(r"[A-Z0-9_-]+", normalized, re.IGNORECASE))


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.lower()).strip()


def stable_id(text: str) -> str:
    return f"query-{hash_text(text)}"


def hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


if __name__ == "__main__":
    raise SystemExit(main())
