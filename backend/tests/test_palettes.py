from __future__ import annotations

import re
import unittest
from pathlib import Path

TOKENS = (Path(__file__).resolve().parents[1] / "static" / "css" / "tokens.css").read_text()


def tokens_in(block: str) -> dict[str, str]:
    return dict(re.findall(r"--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;", block))


def luminance(color: str) -> float:
    channels = [int(color[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    r, g, b = [
        c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in channels
    ]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(first: str, second: str) -> float:
    lighter, darker = sorted((luminance(first), luminance(second)), reverse=True)
    return (lighter + 0.05) / (darker + 0.05)


class PaletteContrastTests(unittest.TestCase):
    """Colours are picked by hand, so nothing else would notice unreadable text."""

    def test_every_theme_stays_readable(self) -> None:
        light = tokens_in(TOKENS[: TOKENS.index("@media (prefers-color-scheme: dark)")])
        dark = tokens_in(TOKENS[TOKENS.index("@media (prefers-color-scheme: dark)") :])
        palettes = re.findall(r':root\[data-palette="(\d+)"\] \{(.*?)\}', TOKENS, re.S)
        self.assertEqual(len(palettes), 17)
        for number, block in palettes:
            colors = tokens_in(block)
            base = light if luminance(colors["bg"]) > 0.4 else dark
            danger = base["danger"]
            pairs = [
                (text, ground, 4.5)
                for text in ("ink", "ink-2", "ink-3", "accent-text", "highlight")
                for ground in ("bg", "surface")
            ]
            pairs += [
                ("ink", "sunken", 4.5),
                ("ink-2", "sunken", 4.5),
                ("on-accent", "accent", 4.5),
                ("on-accent", "accent-hover", 4.5),
                ("accent-text", "accent-soft", 4.5),
                ("field-line", "surface", 3),
            ]
            for text, ground, minimum in pairs:
                with self.subTest(palette=number, text=text, ground=ground):
                    self.assertGreaterEqual(
                        contrast(colors[text], colors[ground]), minimum
                    )
            with self.subTest(palette=number, text="danger"):
                self.assertGreaterEqual(contrast(danger, colors["surface"]), 4.5)
