"""Traditional Chinese normalization of ASR output.

Only conservative script conversion happens here. The default is OpenCC `s2tw`:
Simplified → Traditional characters using Taiwan-standard glyph variants (吃, 裡, 著,
為) but WITHOUT phrase/vocabulary substitution. Plain `s2t` would emit variants that
read as errors in Taiwan (喫, 裏, 着, 爲); `s2twp` would rewrite vocabulary
(軟件→軟體, 鼠標→滑鼠) and could alter software/medical terms, names and addresses.
Stylistic Taiwan localization belongs to the artifact generation step.
"""

from __future__ import annotations

import re
from typing import Protocol


class Converter(Protocol):
    def convert(self, text: str) -> str: ...


def create_converter(config: str = "s2tw") -> Converter:
    import opencc

    return opencc.OpenCC(config)


_SPACES = re.compile(r"[ \t　]+")


def normalize_transcript(text: str, converter: Converter) -> str:
    """Convert to Traditional Chinese and tidy whitespace without rewriting content."""
    converted = converter.convert(text)
    lines = [_SPACES.sub(" ", line).strip() for line in converted.splitlines()]
    return "\n".join(line for line in lines if line)
