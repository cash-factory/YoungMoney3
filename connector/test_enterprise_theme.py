"""Connector enterprise presentation tests, independent of broker sessions."""
import unittest
from enterprise_theme import COLORS, SPACING, label_color, contrast_ratio

class EnterpriseThemeTests(unittest.TestCase):
    def test_kit_tokens(self):
        self.assertEqual(COLORS["red"], "#C8102E")
        self.assertEqual(COLORS["nav"], "#18191D")
        self.assertEqual(COLORS["canvas"], "#F6F7F8")
        self.assertEqual(SPACING[0], 4)
    def test_accessible_text_and_actions(self):
        for foreground, background in (
            (COLORS["text"], COLORS["surface"]),
            (COLORS["muted"], COLORS["surface"]),
            (COLORS["on_dark"], COLORS["nav"]),
            (COLORS["muted_dark"], COLORS["nav"]),
            (COLORS["on_dark"], COLORS["red"]),
        ):
            with self.subTest(foreground=foreground, background=background):
                self.assertGreaterEqual(contrast_ratio(foreground, background), 4.5)
    def test_surface_adaptation(self):
        self.assertEqual(label_color(COLORS["nav"], COLORS["text"]), "#FFFFFF")
        self.assertEqual(label_color(COLORS["ink"], COLORS["muted"]), COLORS["muted_dark"])
        self.assertEqual(label_color(COLORS["surface"], COLORS["text"]), COLORS["text"])
if __name__ == "__main__":
    unittest.main()
