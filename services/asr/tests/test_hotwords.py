import pytest

from app.hotwords import HotwordError, normalize_hotwords, parse_hotwords_field


def test_parse_accepts_json_string_array() -> None:
    assert parse_hotwords_field('["克拉黴素", "Metformin"]') == ["克拉黴素", "Metformin"]
    assert parse_hotwords_field(None) == []
    assert parse_hotwords_field("  ") == []


@pytest.mark.parametrize("raw", ["not json", '{"a": 1}', "[1, 2]", '"text"'])
def test_parse_rejects_other_shapes(raw: str) -> None:
    with pytest.raises(HotwordError):
        parse_hotwords_field(raw)


def test_normalize_trims_dedupes_and_strips_separators() -> None:
    terms = [" 克拉黴素 ", "阿莫西林", "克拉黴素", "", "[Metformin]", "新竹馬偕紀念醫院", "a,b", "x\u0000y", "長" * 65]
    assert normalize_hotwords(terms, 100) == ["克拉黴素", "阿莫西林", "Metformin", "新竹馬偕紀念醫院", "a b", "xy"]


def test_normalize_caps_the_count() -> None:
    assert normalize_hotwords([f"term{i}" for i in range(10)], 3) == ["term0", "term1", "term2"]
