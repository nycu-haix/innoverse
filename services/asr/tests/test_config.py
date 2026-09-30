import pytest

from app.config import ConfigError, load_settings


def test_defaults_use_fun_asr_nano() -> None:
    settings = load_settings({})
    assert settings.provider == "funasr"
    assert settings.model == "FunAudioLLM/Fun-ASR-Nano-2512"
    assert settings.language == "zh"
    assert settings.device == "cuda"
    assert settings.max_concurrency == 2
    assert settings.opencc_config == "s2tw"
    assert settings.max_audio_ms == 60 * 60_000


def test_reads_environment_values() -> None:
    settings = load_settings(
        {
            "ASR_PROVIDER": "FunASR",
            "ASR_MAX_CONCURRENCY": "4",
            "ASR_LANGUAGE": "auto",
            "ASR_ITN": "false",
            "MAX_AUDIO_MINUTES": "30",
            "UNRELATED": "x",
        }
    )
    assert settings.provider == "funasr"
    assert settings.max_concurrency == 4
    assert settings.language == "auto"
    assert settings.itn is False
    assert settings.max_audio_ms == 30 * 60_000


@pytest.mark.parametrize(
    "env",
    [
        {"ASR_MAX_CONCURRENCY": "0"},
        {"ASR_MAX_CONCURRENCY": "many"},
        {"ASR_LANGUAGE": "klingon"},
        {"ASR_MODEL_HUB": "s3"},
    ],
)
def test_rejects_invalid_values(env: dict[str, str]) -> None:
    with pytest.raises(ConfigError):
        load_settings(env)


def test_unknown_provider_is_rejected() -> None:
    from app.providers import create_backend

    with pytest.raises(ValueError, match="unknown ASR_PROVIDER"):
        create_backend(load_settings({"ASR_PROVIDER": "whisper-cloud"}))
