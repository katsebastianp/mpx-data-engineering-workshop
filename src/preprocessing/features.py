"""Measured jet features. Add a calculator to DERIVED_FEATURES, then preprocess again."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Sequence
    from pyspark.sql import DataFrame

from dataclasses import dataclass
import math
import re


@dataclass(frozen=True)
class ParticleMeasurements:
    """Only measured inputs are exposed to feature calculators; no labels or IDs."""
    pt: float
    mass: float
    count: int
    energy: tuple[float, ...]
    deta: tuple[float, ...]
    dphi: tuple[float, ...]
    total_energy: float
    energy_fractions: tuple[float, ...]


def energy_sum(jet: ParticleMeasurements) -> float:
    return jet.total_energy


def leading_energy_fraction(jet: ParticleMeasurements) -> float:
    return max(jet.energy_fractions)


def radial_energy_moment(jet: ParticleMeasurements) -> float:
    return sum(weight * math.hypot(eta, phi)
               for weight, eta, phi in zip(jet.energy_fractions, jet.deta, jet.dphi))


def energy_dispersion(jet: ParticleMeasurements) -> float:
    return math.sqrt(sum(weight * weight for weight in jet.energy_fractions))


def ecf2_beta1(jet: ParticleMeasurements) -> float:
    correlation = 0.0
    for first in range(jet.count):
        for second in range(first + 1, jet.count):
            angle = (jet.dphi[first] - jet.dphi[second] + math.pi) % (2 * math.pi) - math.pi
            distance = math.hypot(jet.deta[first] - jet.deta[second], angle)
            correlation += jet.energy_fractions[first] * jet.energy_fractions[second] * distance
    return correlation


BASIC_FEATURES = ("jet_pt", "jet_sdmass", "particle_count")
# Add a named function and one entry here. Keep existing definitions unchanged.
DERIVED_FEATURES = {
    "energy_sum": energy_sum,
    "leading_energy_fraction": leading_energy_fraction,
    "radial_energy_moment": radial_energy_moment,
    "energy_dispersion": energy_dispersion,
    "ecf2_beta1": ecf2_beta1,
}
FEATURE_NAMES = (*BASIC_FEATURES, *DERIVED_FEATURES)
FEATURE_SETS = {"basic": BASIC_FEATURES, "shape": FEATURE_NAMES}


def validate_feature_names(names: object) -> list[str]:
    """Select registered numeric measurements, never metadata or generator truth."""
    if not isinstance(names, (list, tuple)) or not names or len(names) > 100:
        raise ValueError("Choose a nonempty list of registered measured features.")
    reserved = {"truth_label", "truth_group", "record_id", "source_file", "source_row", "split", "jet_label"}
    if (any(not isinstance(name, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", name)
            or name in reserved or name.startswith(("truth_", "genpart_", "genjet_", "aux_genpart_")) for name in names)
            or len(set(names)) != len(names) or not set(names).issubset(FEATURE_NAMES)):
        raise ValueError("Use unique registered measured features; labels, identifiers and generator truth are forbidden.")
    return list(names)


def particle_features(
    pt: float,
    mass: float,
    count: int,
    energy: Sequence[float],
    deta: Sequence[float],
    dphi: Sequence[float],
) -> tuple[float, ...]:
    """Return supplied measurements followed by registered derived features."""
    validate_feature_names(FEATURE_NAMES)
    if isinstance(count, bool) or not isinstance(count, int) or count < 1 or any(len(values) != count for values in (energy, deta, dphi)):
        raise ValueError("Particle arrays must be nonempty and aligned.")
    if not all(math.isfinite(float(value)) for value in (pt, mass, *energy, *deta, *dphi)):
        raise ValueError("Jet measurements must be finite.")
    total = sum(energy)
    if pt <= 0 or total <= 0 or any(value < 0 for value in energy):
        raise ValueError("Jet momentum and total particle energy must be positive.")
    jet = ParticleMeasurements(float(pt), float(mass), count, tuple(energy), tuple(deta), tuple(dphi),
                               total, tuple(value / total for value in energy))
    derived = []
    for name, calculate in DERIVED_FEATURES.items():
        value = calculate(jet)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError(f"Feature {name} must return one finite number.")
        derived.append(float(value))
    return (jet.pt, jet.mass, float(jet.count), *derived)


def build_features(jets: DataFrame) -> DataFrame:
    """Build a lazy Spark plan. Quality checks and writes later trigger its execution."""
    from pyspark.sql import functions as F, types as T

    schema = T.StructType([T.StructField(name, T.DoubleType(), False) for name in FEATURE_NAMES])
    calculate = F.udf(particle_features, schema)
    frame = jets.withColumn("_features", calculate(
        "jet_pt", "jet_sdmass", "jet_nparticles", "part_energy", "part_deta", "part_dphi",
    ))
    for name in FEATURE_NAMES:
        frame = frame.withColumn(name, F.col(f"_features.{name}"))
    return (frame.drop("_features")
            .withColumn("in_training_support", (F.col("jet_pt") > 200) & (F.col("jet_pt") < 2500)
                        & (F.col("jet_sdmass") > 20) & (F.col("jet_sdmass") < 500))
            .withColumn("particles_truncated", F.col("jet_nparticles") > 128))
