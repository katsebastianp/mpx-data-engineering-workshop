"""Business rules shared by the pipeline and its independent checks."""

import math
import re

WORDS_PER_MINUTE = 200
WORD_PATTERN = re.compile(r"[A-Za-z0-9]+")


def reading_ratio(text: str, reading_seconds: float) -> float:
    """Observed reading time / estimated duration, capped at one.

    Words are ASCII letter/digit sequences. Punctuation separates words; text
    without these words has ratio zero. Estimated duration is at least one
    second. This is a time-based engagement proxy, not measured completion.
    """
    if not isinstance(text, str):
        raise ValueError("Article text must be a string (empty text is allowed).")
    if (
        isinstance(reading_seconds, bool)
        or not isinstance(reading_seconds, (int, float))
        or not math.isfinite(reading_seconds)
        or reading_seconds < 0
    ):
        raise ValueError("reading_seconds must be a finite, non-negative number.")
    word_count = len(WORD_PATTERN.findall(text))
    if word_count == 0:
        return 0.0
    estimated_seconds = max(1.0, word_count * 60.0 / WORDS_PER_MINUTE)
    return min(1.0, reading_seconds / estimated_seconds)
