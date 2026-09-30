from app.text import create_converter, normalize_transcript


def test_default_converts_to_taiwan_standard_characters() -> None:
    converter = create_converter()
    text = normalize_transcript("这颗抗生素一天三次，饭后吃，克拉霉素 500 mg，里面，着急，为什么。", converter)
    # Plain s2t would produce 喫 / 裏 / 着 / 爲, which read as errors in Taiwan.
    assert text == "這顆抗生素一天三次，飯後吃，克拉黴素 500 mg，裡面，著急，為什麼。"


def test_does_not_apply_taiwan_vocabulary_substitutions() -> None:
    converter = create_converter()
    # s2twp would turn 软件→軟體 and 鼠标→滑鼠; the ASR layer must not do that.
    assert normalize_transcript("软件和鼠标", converter) == "軟件和鼠標"


def test_plain_s2t_remains_available() -> None:
    assert normalize_transcript("饭后吃", create_converter("s2t")) == "飯後喫"


def test_traditional_input_and_english_terms_are_preserved() -> None:
    converter = create_converter()
    source = "請服用 Acetaminophen 與 Metformin，地址是新竹市東區。"
    assert normalize_transcript(source, converter) == source


def test_whitespace_is_tidied_without_touching_content() -> None:
    class Identity:
        def convert(self, text: str) -> str:
            return text

    assert normalize_transcript("  第一行　　內容 \n\n  第二行  ", Identity()) == "第一行 內容\n第二行"
