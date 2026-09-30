"""Hotword (domain term) handling for the ASR prompt."""

from __future__ import annotations

import json
import re
import unicodedata

MAX_HOTWORD_LENGTH = 64

# Fun-ASR-Nano joins hotwords as "[a, b, c]" inside its prompt, so separators and
# brackets inside a term would corrupt the list.
_FORBIDDEN = re.compile(r"[\[\]【】,，、;；\n\r\t]")


class HotwordError(ValueError):
    pass


def parse_hotwords_field(raw: str | None) -> list[str]:
    """Parse the multipart `hotwords` field: a JSON array of strings (or empty)."""
    if raw is None or raw.strip() == "":
        return []
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise HotwordError("hotwords must be a JSON array of strings") from error
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise HotwordError("hotwords must be a JSON array of strings")
    return value


def normalize_hotwords(terms: list[str], max_count: int) -> list[str]:
    """Trim, strip control/separator characters, drop duplicates and cap the list.

    Terms keep their script and spelling: Traditional Chinese, English drug names and
    proper nouns are passed to the model as written.
    """
    seen: set[str] = set()
    result: list[str] = []
    for raw in terms:
        term = "".join(ch for ch in raw if unicodedata.category(ch)[0] != "C")
        term = _FORBIDDEN.sub(" ", term)
        term = re.sub(r"\s+", " ", term).strip()
        if not term or len(term) > MAX_HOTWORD_LENGTH or term in seen:
            continue
        seen.add(term)
        result.append(term)
        if len(result) >= max_count:
            break
    return result
