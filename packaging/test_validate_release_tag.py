import unittest

from validate_release_tag import validate


class ReleaseTagTests(unittest.TestCase):
    def test_matching_stable_and_prerelease_tags(self):
        for version, tag in [("1.2.3", "v1.2.3"), ("1.2.3", "v1.2.3-rc.1"), ("1.2.3-rc.1", "v1.2.3-rc.1")]:
            with self.subTest(version=version, tag=tag):
                validate(version, tag)

    def test_rejects_mismatches_and_invalid_tags(self):
        for version, tag in [("1.2.3", "v1.2.4-rc.1"), ("1.2.3-rc.1", "v1.2.3-rc.2"), ("1.2.3", "v1.2.3-"), ("1.2.3", "1.2.3"), ("bad", "vbad")]:
            with self.subTest(version=version, tag=tag), self.assertRaises(ValueError):
                validate(version, tag)
