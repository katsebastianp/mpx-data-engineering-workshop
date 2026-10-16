import math

import pytest

from preprocessing.features import particle_features
from preprocessing import features


def test_two_particle_features_have_known_physics_values():
    result = particle_features(500, 80, 2, [3.0, 1.0], [0.0, 1.0], [0.0, 0.0])
    assert result == pytest.approx((500, 80, 2, 4, .75, .25, math.sqrt(.625), .1875))


def test_pair_distance_wraps_at_pi():
    result = particle_features(500, 80, 2, [1.0, 1.0], [0.0, 0.0], [math.pi - .1, -math.pi + .1])
    assert result[-1] == pytest.approx(.05)


@pytest.mark.parametrize("energy,deta,dphi", [([1], [], [0]), ([0], [0], [0]),
                                            ([-1], [0], [0]), ([float('nan')], [0], [0])])
def test_invalid_measurements_fail(energy, deta, dphi):
    with pytest.raises(ValueError):
        particle_features(500, 80, 1, energy, deta, dphi)


def test_added_calculator_receives_only_measurements_and_preserves_original_features(monkeypatch):
    original = particle_features(500, 80, 2, [3., 1.], [0., 1.], [0., 0.])

    def mass_over_pt(jet):
        assert not hasattr(jet, "truth_label") and not hasattr(jet, "record_id")
        return jet.mass / jet.pt

    monkeypatch.setitem(features.DERIVED_FEATURES, "mass_over_pt", mass_over_pt)
    monkeypatch.setattr(features, "FEATURE_NAMES", (*features.FEATURE_NAMES, "mass_over_pt"))
    changed = particle_features(500, 80, 2, [3., 1.], [0., 1.], [0., 0.])
    assert changed[:-1] == original
    assert changed[-1] == .16
    assert features.validate_feature_names(["jet_pt", "mass_over_pt"]) == ["jet_pt", "mass_over_pt"]


@pytest.mark.parametrize("value", [float("nan"), float("inf"), True, "0.5"])
def test_added_calculator_rejects_invalid_output(monkeypatch, value):
    monkeypatch.setitem(features.DERIVED_FEATURES, "custom", lambda jet: value)
    monkeypatch.setattr(features, "FEATURE_NAMES", (*features.FEATURE_NAMES, "custom"))
    with pytest.raises(ValueError, match="custom must return one finite number"):
        particle_features(500, 80, 1, [1.], [0.], [0.])


@pytest.mark.parametrize("name", ["truth_label", "truth_custom", "record_id", "genpart_pt", "split"])
def test_registration_cannot_turn_metadata_into_a_feature(monkeypatch, name):
    monkeypatch.setattr(features, "FEATURE_NAMES", (*features.FEATURE_NAMES, name))
    with pytest.raises(ValueError, match="forbidden"):
        features.validate_feature_names([name])
