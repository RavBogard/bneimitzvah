import importlib.util
from pathlib import Path
import sys
import unittest
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("word_rescue", Path(__file__).parents[1] / "scripts" / "shermet-word-rescue.py")
rescue = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rescue)


class WordRescueTests(unittest.TestCase):
    def test_constant_recording_offset_cannot_be_voiced_energy(self):
        self.assertAlmostEqual(rescue.frame_energy([-.023] * 160)[0], 0, places=12)
        voice = [.005, -.005] * 80
        self.assertAlmostEqual(rescue.frame_energy(voice)[0], .005, places=12)
        self.assertAlmostEqual(rescue.frame_energy([v - .023 for v in voice])[0], .005, places=12)

    def test_internal_phone_movement_does_not_change_a_word_boundary(self):
        first = [{"word": 0, "start": .1, "end": .2}, {"word": 0, "start": .3, "end": .6}, {"word": 1, "start": .8, "end": 1.1}]
        second = [{"word": 0, "start": .1, "end": .25}, {"word": 0, "start": .5, "end": .6}, {"word": 1, "start": .8, "end": 1.1}]
        agreement = rescue.boundary_agreement(rescue.words_from_phones(first, 2), rescue.words_from_phones(second, 2))
        self.assertEqual(agreement, {"medianStart": 0, "maxStart": 0, "maxEnd": 0})
        second[-1]["start"] = 1.0
        self.assertGreater(rescue.boundary_agreement(rescue.words_from_phones(first, 2), rescue.words_from_phones(second, 2))["maxStart"], .12)

    def test_measured_sustain_is_retained_and_real_quiet_stops_extension(self):
        words = [{"start": .1, "end": .3}, {"start": 1., "end": 1.2}]
        activity = [False] * 10 + [True] * 86 + [False] * 4 + [True] * 20
        extended, _ = rescue.extend_measured_ends(words, activity, 1.3)
        self.assertAlmostEqual(extended[0]["end"], .96)
        activity[40:100] = [False] * 60
        extended, _ = rescue.extend_measured_ends(words, activity, 1.3)
        self.assertAlmostEqual(extended[0]["end"], .4)

    def test_missing_word_is_held_instead_of_split_or_interpolated(self):
        with self.assertRaises(ValueError):
            rescue.words_from_phones([{"word": 0, "start": 0., "end": 1.}], 2)

    def test_independent_source_contradiction_holds_only_its_exact_audio_binding(self):
        result = {"status": "candidate", "reasons": [], "timing": {"ref": "Synthetic 1:1", "audioSha256": "a" * 64}}
        audit = {"ref": "Synthetic 1:1", "audioSha256": "b" * 64, "lexical": .1, "medianOverlap": .8, "zeroOverlapFraction": 0}
        self.assertEqual(rescue.apply_independent_audit(result, audit, "c" * 64)["status"], "candidate")
        audit["audioSha256"] = "a" * 64
        self.assertEqual(rescue.apply_independent_audit(result, audit, "c" * 64)["status"], "hold")


if __name__ == '__main__':
    unittest.main()
