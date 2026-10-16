import math

import pytest

from preprocessing.features import particle_features
from preprocessing import features


KNOWN_FEATURES = {
    "jet_pt": 500, "jet_sdmass": 80, "particle_count": 2,
    "energy_sum": 4, "leading_energy_fraction": .75,
    "radial_energy_moment": .25, "energy_dispersion": math.sqrt(.625), "ecf2_beta1": .1875,
}


def named_values(*args):
    return dict(zip(features.FEATURE_NAMES, particle_features(*args), strict=True))


def add_test_feature(monkeypatch, calculate):
    # Participants may already have added the example mass_over_pt or any other name.
    name = "workshop_test_feature"
    while name in features.FEATURE_NAMES or name in features.DERIVED_FEATURES:
        name += "_extra"
    monkeypatch.setitem(features.DERIVED_FEATURES, name, calculate)
    monkeypatch.setattr(features, "FEATURE_NAMES", (*features.FEATURE_NAMES, name))
    return name


@pytest.fixture(params=[False, True], ids=["current-features", "added-feature"])
def feature_extension(request, monkeypatch):
    if request.param:
        add_test_feature(monkeypatch, lambda jet: jet.mass / jet.pt)


def test_two_particle_features_have_known_physics_values(feature_extension):
    result = named_values(500, 80, 2, [3.0, 1.0], [0.0, 1.0], [0.0, 0.0])
    assert features.FEATURE_NAMES[:len(KNOWN_FEATURES)] == tuple(KNOWN_FEATURES)
    assert {name: result[name] for name in KNOWN_FEATURES} == pytest.approx(KNOWN_FEATURES)


def test_pair_distance_wraps_at_pi(feature_extension):
    result = named_values(500, 80, 2, [1.0, 1.0], [0.0, 0.0], [math.pi - .1, -math.pi + .1])
    assert result["ecf2_beta1"] == pytest.approx(.05)


@pytest.mark.parametrize("energy,deta,dphi", [([1], [], [0]), ([0], [0], [0]),
                                            ([-1], [0], [0]), ([float('nan')], [0], [0])])
def test_invalid_measurements_fail(energy, deta, dphi):
    with pytest.raises(ValueError):
        particle_features(500, 80, 1, energy, deta, dphi)


def test_added_calculator_receives_only_measurements_and_preserves_original_features(monkeypatch):
    original = named_values(500, 80, 2, [3., 1.], [0., 1.], [0., 0.])

    def mass_over_pt(jet):
        assert not hasattr(jet, "truth_label") and not hasattr(jet, "record_id")
        return jet.mass / jet.pt

    name = add_test_feature(monkeypatch, mass_over_pt)
    changed = named_values(500, 80, 2, [3., 1.], [0., 1.], [0., 0.])
    assert {key: changed[key] for key in original} == original
    assert changed[name] == .16
    assert features.validate_feature_names(["jet_pt", name]) == ["jet_pt", name]


@pytest.mark.parametrize("value", [float("nan"), float("inf"), True, "0.5"])
def test_added_calculator_rejects_invalid_output(monkeypatch, value):
    name = add_test_feature(monkeypatch, lambda jet: value)
    with pytest.raises(ValueError, match=f"{name} must return one finite number"):
        particle_features(500, 80, 1, [1.], [0.], [0.])


@pytest.mark.parametrize("name", ["truth_label", "truth_custom", "record_id", "genpart_pt", "split"])
def test_registration_cannot_turn_metadata_into_a_feature(monkeypatch, name):
    monkeypatch.setattr(features, "FEATURE_NAMES", (*features.FEATURE_NAMES, name))
    with pytest.raises(ValueError, match="forbidden"):
        features.validate_feature_names([name])
