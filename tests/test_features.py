import math

import pytest

from preprocessing.features import particle_features


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
