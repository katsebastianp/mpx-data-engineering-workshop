import math

import pytest

from news_pipeline.contracts import reading_ratio


def test_reading_ratio_has_explicit_token_duration_and_cap_rules():
    assert reading_ratio("one two three four five six seven eight nine ten", 1.5) == 0.5
    assert reading_ratio("one", 0.5) == 0.5  # Minimum estimated duration: 1 second.
    assert reading_ratio("one two three four", 100) == 1.0
    assert reading_ratio("one", 0) == 0.0
    assert reading_ratio("", 15) == 0.0
    assert reading_ratio("... -- 中文", 15) == 0.0
    assert reading_ratio("a-b C_2!", 0.6) == 0.5  # Four ASCII tokens.


@pytest.mark.parametrize("duration", [None, -1, math.inf, -math.inf, math.nan, "2", True])
def test_reading_ratio_rejects_invalid_durations(duration):
    with pytest.raises(ValueError, match="reading_seconds"):
        reading_ratio("article text", duration)


def test_reading_ratio_rejects_null_text():
    with pytest.raises(ValueError, match="text"):
        reading_ratio(None, 1)
