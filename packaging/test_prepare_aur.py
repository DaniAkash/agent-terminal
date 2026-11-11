import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("prepare_aur", Path(__file__).parent / "prepare-aur.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PrepareAurTests(unittest.TestCase):
    def test_release_url_and_checksums(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            deb = root / "release.deb"
            deb.write_bytes(b"release asset")
            module.render("1.2.3", "owner/repo", "Maintainer", deb, root / "out")
            pkgbuild = (root / "out/PKGBUILD").read_text()
            self.assertIn("pkgver=1.2.3", pkgbuild)
            self.assertIn("https://github.com/owner/repo/releases/download/v${pkgver}/", pkgbuild)
            self.assertIn(hashlib.sha256(deb.read_bytes()).hexdigest(), pkgbuild)
            self.assertIn(hashlib.sha256((root / "out/LICENSE").read_bytes()).hexdigest(), pkgbuild)
            self.assertNotIn("SKIP", pkgbuild)

    def test_rejects_prereleases_and_invalid_repository(self):
        for version, repository in [("1.2.3-rc.1", "owner/repo"), ("1.2.3", "owner/repo;id")]:
            with self.assertRaises(ValueError):
                module.render(version, repository, "Maintainer", Path("unused"), Path("unused"))


if __name__ == "__main__":
    unittest.main()
