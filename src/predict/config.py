"""Validate workshop experiment settings and resolve feature selections."""

from __future__ import annotations

from typing import TYPE_CHECKING, cast

if TYPE_CHECKING:
    from workshop_types import ExperimentConfig, FilePath

from pathlib import Path
import re

import yaml

from preprocessing.features import FEATURE_SETS, validate_feature_names
from predict.models import require_predictor


def _feature_names(kind: object, selected: object) -> list[str]:
    require_predictor(kind)
    if kind == "sophon":
        if selected != "particles":
            raise ValueError("Sophon requires features: particles.")
        from predict.sophon import MEASUREMENT_NAMES

        return list(MEASUREMENT_NAMES)
    if isinstance(selected, str):
        if selected not in FEATURE_SETS:
            raise ValueError(f"Choose {', '.join(FEATURE_SETS)}, or an explicit measured feature list.")
        names = list(FEATURE_SETS[selected])
    elif isinstance(selected, list):
        names = selected
    else:
        raise ValueError("features must be a named set or list.")
    return validate_feature_names(names)


def read_config(path: FilePath) -> ExperimentConfig:
    config = yaml.safe_load(Path(path).read_text())
    if isinstance(config, dict) and "name" in config:
        if "team" in config and config["team"] != config["name"]:
            raise ValueError("Use name only; name and legacy team must not disagree.")
        config = {**config, "team": config["name"]}
    if (not isinstance(config, dict) or not isinstance(config.get("team"), str)
            or not config["team"].strip() or len(config["team"]) > 128):
        raise ValueError("experiments.yaml must contain a nonempty run name of at most 128 characters.")
    if set(config) - {"name", "team", "explanation", "seed", "max_workers", "evaluation", "experiments"}:
        raise ValueError("Unknown top-level experiment setting.")
    seed, workers = config.get("seed", 42), config.get("max_workers", 1)
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed <= 2**31 - 1:
        raise ValueError("seed must be an integer in [0, 2147483647].")
    if isinstance(workers, bool) or not isinstance(workers, int) or workers not in (1, 2):
        raise ValueError("max_workers must be 1 or 2; use 1 on an 8-GB laptop.")
    evaluation = config.get("evaluation", "validation")
    if evaluation not in ("validation", "test"):
        raise ValueError("evaluation must be validation while iterating or test for the final chosen configuration.")
    explanation = config.get("explanation", "")
    if not isinstance(explanation, str) or len(explanation) > 2000:
        raise ValueError("explanation must be text of at most 2,000 characters.")
    entries = config.get("experiments")
    if not isinstance(entries, list) or not entries:
        raise ValueError("Provide at least one experiment.")
    if evaluation == "test" and len(entries) != 1:
        raise ValueError("For final test evaluation, keep exactly one experiment selected using validation results.")
    seen = set()
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) - {"id", "model", "features", "params", "explanation"}:
            raise ValueError("Each experiment requires id, model and features, with optional params/explanation.")
        identifier = entry.get("id")
        if not isinstance(identifier, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,39}", identifier) or identifier in seen:
            raise ValueError("Experiment IDs must be unique, 1–40 letters/digits/hyphens/underscores.")
        seen.add(identifier)
        selected = entry.get("features", "basic")
        names = _feature_names(entry.get("model"), selected)
        note = entry.get("explanation", explanation)
        if not isinstance(entry.get("params", {}), dict):
            raise ValueError("params must be a mapping.")
        if not isinstance(note, str) or not note.strip() or len(note) > 2000:
            raise ValueError("Each experiment needs a nonempty explanation of at most 2,000 characters (entry or top level).")
        entry.update(feature_names=names, feature_set=selected if isinstance(selected, str) else "custom",
                     params=entry.get("params", {}), explanation=note)
    return cast("ExperimentConfig", {**config, "seed": seed, "max_workers": workers, "evaluation": evaluation})

