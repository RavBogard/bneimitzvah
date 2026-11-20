import importlib.util
from pathlib import Path
import unittest
import sys
sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location("shermet_alignment", Path(__file__).parents[1] / "scripts" / "shermet-align.py")
pipeline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pipeline)


class EmissionClockTests(unittest.TestCase):
    def test_native_frame_clock_is_contiguous_and_unique_at_window_edges(self):
        for seconds in (11.3, 28.9, 29.8, 30, 30.01, 57.7, 58, 59.8, 90.1):
            for shift in (0, .24):
                samples = round((seconds + shift) * 16000)
                grid = [begin // 320 + frame for begin, _, first, end in pipeline.emission_plan(samples) for frame in range(first, end)]
                self.assertEqual(grid, list(range((samples - 400) // 320 + 1)), (seconds, shift))

    def test_portal_roman_book_names_and_word_letters_are_preserved(self):
        self.assertEqual(pipeline.canonical('1 Samuel 2:3'), 'I Samuel 2:3')
        self.assertEqual(pipeline.canonical('II Kings 2:3'), 'II Kings 2:3')
        self.assertEqual(pipeline.letters('abc'), '')


if __name__ == '__main__':
    unittest.main()
