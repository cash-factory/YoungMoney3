"""Safety and content contracts for both the classic and native MT5 guides."""
import unittest

from help_guide import GUIDE_TOPICS, FAQ, available_step_ids, search_faq, topic_for


class TestConnectorHelpGuide(unittest.TestCase):
    def test_topics_and_safe_navigation(self):
        self.assertEqual(
            [topic["id"] for topic in GUIDE_TOPICS],
            ["connect", "monitor", "recover", "copy"],
        )
        destinations = {"overview", "sessions", "pair", "activity", "dashboard", "copy-studio"}
        for topic in GUIDE_TOPICS:
            with self.subTest(topic=topic["id"]):
                self.assertEqual(len(topic["steps"]), 4)
                for step in topic["steps"]:
                    self.assertEqual(len(step), 5)
                    self.assertTrue(all(step[:3]), "Title, explanation and caution are required")
                    self.assertIn(step[3], destinations)
                    self.assertNotIn("execute", step[3])
                    self.assertNotIn("authorize", step[3])

    def test_progress_is_stable_and_contains_no_sensitive_data(self):
        steps = available_step_ids()
        self.assertEqual(len(steps), 16)
        self.assertIn("connect:0", steps)
        self.assertIn("recover:3", steps)
        self.assertIn("copy:3", steps)
        self.assertTrue(all("password" not in value for value in steps))

    def test_search_and_fallback(self):
        self.assertEqual(topic_for("missing")["id"], "connect")
        self.assertEqual(len(search_faq("")), len(FAQ))
        answers = search_faq("BROKER records")
        self.assertGreaterEqual(len(answers), 1)
        self.assertTrue(any("first observed" in answer.lower() for _, _, answer in answers))
        self.assertEqual(search_faq("nonsense-unmatched-phrase"), [])

    def test_broker_and_copying_disclaimers(self):
        copy_topic = topic_for("copy")
        text = " ".join(part for step in copy_topic["steps"] for part in step)
        self.assertIn("LIVE", text)
        self.assertIn("local consent", text)
        self.assertIn("guide never", text.lower())
        recovery = " ".join(part for step in topic_for("recover")["steps"] for part in step)
        self.assertIn("not evidence", recovery)
        self.assertIn("silently overwritten", recovery)


if __name__ == "__main__":
    unittest.main()
