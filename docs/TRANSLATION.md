# Translation pipeline

## TL;DR

`chat ROI → OCR → dedupe → language detect → translate → overlay` for incoming,
and `you type English → translate to target → copy to clipboard (or auto-paste
on hotkey)` for outgoing. Target language = last detected lobby language unless
you pin one.

## Incoming

1. `chat_panel` ROI is OCR'd per line whenever its hash changes (meeting bursts
   to 15 fps; chat scrolls fast with 10+ players).
2. Each line: `[swatch][Name]: [text]`. Sender color from swatch sampling
   (`GAME_INTEGRATION.md §3.2`), name from OCR (fuzzy-matched to roster to fix OCR
   errors like `0` vs `O`).
3. Dedupe by `(sender, normalizedText)` with a 5-line sliding window — the panel
   re-renders lines as it scrolls.
4. Language detect per line (`whatlang` or `lingua`; both offline). Keep a
   per-lobby rolling histogram; the dominant language becomes `lobbyLanguage`.
   Very short lines ("ok", "red", "skip") are skipped for detection and inherit
   `lobbyLanguage`.
5. If detected ≠ English → provider.translate(text, src, "en"). Cache by text.
6. Emit `ChatLine { sender, color, original, translated, lang, confidence, t }`.
   The overlay shows both; translated bold, original small.

Among Us chat is already filtered server-side and short, so provider cost is
tiny. Batch lines within 300 ms into one request.

## Outgoing

- Translator panel has a text box. Hotkey focuses it without alt-tabbing out of
  the game (global hotkey + overlay focus; Phase 2 verifies this works with
  Among Us in fullscreen-windowed).
- Target language rule:
  - **Auto (default):** `lobbyLanguage` (last detected dominant language).
  - **Pinned:** user picks from a list; stays until unpinned.
- Translated text is placed on the clipboard; a second hotkey pastes it into the
  game chat input (`Ctrl+V` simulated via SendInput — verify the game accepts it;
  if not, user pastes manually).
- Show a **back-translation** (target → English) next to the output so you can
  sanity-check tone before sending. Among Us meetings are short and blunt; the
  prompt to the provider should prefer short, casual phrasing.

## Providers (`src-tauri/src/translate/`)

```rust
trait TranslateProvider {
    fn detect(&self, text: &str) -> Option<Lang>;        // optional; offline detect is default
    fn translate(&self, text: &str, from: Lang, to: Lang) -> Result<String>;
    fn name(&self) -> &'static str;
}
```

| Provider | Cost | Quality | Notes |
|---|---|---|---|
| DeepL (free tier 500k chars/mo) | free→cheap | best for EU langs | API key in settings |
| Google Cloud Translation | pay | broad | key |
| LibreTranslate (self-host or public instance) | free | ok | no key for self-host |
| Local (Argos Translate via Python sidecar, or CTranslate2 models) | free, offline | ok | heavier install; Phase 4 |

Provider selection + key live in `settings.json`; never commit keys. Add
`.env.example` when the first provider lands.

## Glossary

A small JSON glossary (`src/data/glossary.json`) maps Among Us slang across
languages so translations don't mangle them: `sus`, `vent`, `self-report`,
`stack`, `skip`, color names, room names. Pass as context/glossary where the
provider supports it (DeepL glossaries); otherwise pre/post-substitute.
