import importlib.util
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).parents[1] / "scripts" / "manage_media_hosts.py"
SPEC = importlib.util.spec_from_file_location("manage_media_hosts", SCRIPT_PATH)
MEDIA_HOSTS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MEDIA_HOSTS)


class ManageMediaHostsTests(unittest.TestCase):
    def test_add_url_and_remove_domain_without_touching_secrets(self):
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env.server"
            env_file.write_text(
                "DOMAIN=watch.example.com\n"
                "SECRET_KEY=keep-this-secret\n"
                "AUTHORIZED_MEDIA_HOSTS=media.example.com\n",
                encoding="utf-8",
            )

            rules = MEDIA_HOSTS.update_rules(
                env_file,
                "add",
                ["https://cdn.example.com/videos/movie.mp4", "*.assets.example.com"],
            )
            self.assertEqual(
                rules,
                ("media.example.com", "cdn.example.com", "*.assets.example.com"),
            )
            updated = env_file.read_text(encoding="utf-8")
            self.assertIn("SECRET_KEY=keep-this-secret", updated)
            self.assertIn(
                "AUTHORIZED_MEDIA_HOSTS=media.example.com,cdn.example.com,*.assets.example.com",
                updated,
            )

            rules = MEDIA_HOSTS.update_rules(
                env_file,
                "remove",
                ["media.example.com"],
            )
            self.assertEqual(
                rules,
                ("cdn.example.com", "*.assets.example.com"),
            )

    def test_rejects_local_ip_and_official_platform_targets(self):
        rejected = (
            "localhost",
            "printer.local",
            "127.0.0.1",
            "192.168.1.8",
            "v.qq.com",
            "https://www.bilibili.com/video/test.mp4",
        )
        for value in rejected:
            with self.assertRaises(ValueError, msg=value):
                MEDIA_HOSTS.normalize_rule(value)


if __name__ == "__main__":
    unittest.main()
