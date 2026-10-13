"""Participant exercise: make these calculations faster without changing their values."""

import math

FEATURE_NAMES = (
    "jet_pt", "jet_sdmass", "particle_count", "energy_sum",
    "leading_energy_fraction", "radial_energy_moment", "energy_dispersion", "ecf2_beta1",
)
FEATURE_SETS = {"basic": FEATURE_NAMES[:3], "shape": FEATURE_NAMES}


def particle_features(pt, mass, count, energy, deta, dphi):
    """Eight measured features; pairwise correlation is the deliberate Python baseline."""
    if count < 1 or any(len(values) != count for values in (energy, deta, dphi)):
        raise ValueError("Particle arrays must be nonempty and aligned.")
    if not all(math.isfinite(float(value)) for value in (pt, mass, *energy, *deta, *dphi)):
        raise ValueError("Jet measurements must be finite.")
    total = sum(energy)
    if pt <= 0 or total <= 0 or any(value < 0 for value in energy):
        raise ValueError("Jet momentum and total particle energy must be positive.")
    fractions = [value / total for value in energy]
    radial = sum(weight * math.hypot(eta, phi) for weight, eta, phi in zip(fractions, deta, dphi))
    dispersion = math.sqrt(sum(weight * weight for weight in fractions))
    correlation = 0.0
    for first in range(count):
        for second in range(first + 1, count):
            angle = (dphi[first] - dphi[second] + math.pi) % (2 * math.pi) - math.pi
            distance = math.hypot(deta[first] - deta[second], angle)
            correlation += fractions[first] * fractions[second] * distance
    return (float(pt), float(mass), float(count), total, max(fractions), radial, dispersion, correlation)


def build_features(jets):
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
