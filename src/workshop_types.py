"""Static contracts shared by the workshop pipeline; no runtime validation.

Record deliberately permits dynamic fields at JSON/Parquet boundaries and in
participant-defined features/model metadata. Existing validators own those
schemas. Fixed outputs and validated experiment settings use TypedDict instead.
"""

from __future__ import annotations

from os import PathLike
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol, TypeAlias, TypedDict

if TYPE_CHECKING:
    from predict.base import Predictor

FilePath: TypeAlias = str | PathLike[str]
Record: TypeAlias = dict[str, Any]
Rows: TypeAlias = list[Record]
Datasets: TypeAlias = dict[str, Rows]
Truth: TypeAlias = dict[str, dict[str, int]]
ParameterValue: TypeAlias = str | int | float | bool | None | list["ParameterValue"]
Parameters: TypeAlias = dict[str, ParameterValue]
NumericParameters: TypeAlias = dict[str, int | float]


class Confusion(TypedDict):
    tn: int
    fp: int
    fn: int
    tp: int


class Metrics(TypedDict):
    rows: int
    signal_rows: int
    background_rows: int
    roc_auc: float | None
    average_precision: float | None
    accuracy: float
    f1: float
    confusion: Confusion
    signal_retention: float | None
    background_rejection: float | None


class Prediction(TypedDict):
    split: str
    record_id: str
    signal_score: float


class SplitFile(TypedDict):
    file: str
    rows: int
    sha256: str


SplitFiles: TypeAlias = dict[str, SplitFile]


class ExecutionCounts(TypedDict):
    job_count: int
    stage_count: int
    scheduled_tasks: int


class ExperimentSpec(TypedDict):
    id: str
    model: str
    feature_names: list[str]
    feature_set: str
    params: Parameters
    explanation: str


class ExperimentConfig(TypedDict):
    team: str
    seed: int
    max_workers: int
    evaluation: str
    experiments: list[ExperimentSpec]


Job: TypeAlias = tuple[ExperimentSpec, Path, Path]
FitResult: TypeAlias = tuple[Record, float, float]
FitArguments: TypeAlias = tuple[str, Rows, list[str], Parameters, Path, int]


class PredictorFactory(Protocol):
    """Class-level registry contract, including artifact loading and training."""

    kind: str
    model_file: str

    def __call__(self, directory: Path, metadata: Record) -> Predictor: ...

    def train(
        self,
        rows: Rows,
        feature_names: list[str],
        params: Parameters,
        directory: Path,
        seed: int,
    ) -> Record: ...
