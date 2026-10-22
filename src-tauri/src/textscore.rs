//! How believable is an OCR'd chat line? Pure text heuristics, no OCR, no Windows.
//!
//! Used to (a) pick the best of several OCR languages for one chat bubble, and (b) flag a bubble
//! as unreadable when every installed OCR language produced garbage. The typical garbage is the
//! English recognizer reading Cyrillic as Latin look-alikes: "привет, я видел красного" comes out
//! as "npb4BeT, Bl,1Aen KpacHoro" (measured with the en-US engine on this PC, 2026-10-22):
//! digits inside words, capitals in the middle of words, punctuation glued into words.

/// Writing system of the letters in a string (majority vote; digits / punctuation don't count).
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Script { Latin, Cyrillic, Greek, Cjk, Arabic, Other, None }

pub fn char_script(c: char) -> Option<Script> {
    if !c.is_alphabetic() { return None; }
    let u = c as u32;
    Some(match u {
        0x0041..=0x024F | 0x1E00..=0x1EFF => Script::Latin,
        0x0400..=0x052F => Script::Cyrillic,
        0x0370..=0x03FF => Script::Greek,
        0x3040..=0x30FF | 0x3400..=0x9FFF | 0xAC00..=0xD7AF => Script::Cjk,
        0x0600..=0x06FF | 0x0750..=0x077F => Script::Arabic,
        _ => Script::Other,
    })
}

/// Majority script of the letters in `text` (None when there are no letters).
pub fn script_of(text: &str) -> Script {
    let mut counts: [(Script, u32); 6] = [(Script::Latin, 0), (Script::Cyrillic, 0), (Script::Greek, 0), (Script::Cjk, 0), (Script::Arabic, 0), (Script::Other, 0)];
    for c in text.chars() {
        if let Some(s) = char_script(c) { if let Some(e) = counts.iter_mut().find(|e| e.0 == s) { e.1 += 1; } }
    }
    counts.iter().filter(|e| e.1 > 0).max_by_key(|e| e.1).map(|e| e.0).unwrap_or(Script::None)
}

/// Any letter outside plain ASCII Latin (accents, Cyrillic, CJK…): a line that should be translated
/// rather than trusted as English.
pub fn has_non_ascii_letters(text: &str) -> bool {
    text.chars().any(|c| c.is_alphabetic() && !c.is_ascii())
}

const VOWELS: &str = "aeiouyàáâãäåèéêëìíîïòóôõöùúûüýÿаеёиоуыэюяіїєαεηιουω";

/// Common chat words (lower case) that prove a line is real text in some language.
const DICT: &[&str] = &[
    // English (Among Us chat)
    "i", "im", "me", "my", "you", "u", "ur", "he", "she", "it", "we", "they", "the", "a", "an", "and", "or", "but", "so", "not",
    "no", "yes", "ok", "is", "was", "are", "am", "be", "do", "did", "have", "has", "go", "went", "saw", "see", "seen", "with",
    "in", "at", "to", "of", "for", "on", "who", "what", "where", "why", "how", "sus", "vent", "vented", "kill", "killed", "body",
    "report", "skip", "vote", "voted", "imp", "impostor", "imposter", "crew", "task", "tasks", "fake", "self", "safe", "trust",
    "red", "blue", "green", "pink", "orange", "yellow", "black", "white", "purple", "brown", "cyan", "lime", "maroon", "rose",
    "banana", "gray", "grey", "tan", "coral", "admin", "elec", "electrical", "medbay", "cams", "nav", "o2", "lol", "bro", "idk",
    "that", "this", "there", "here", "just", "think", "know", "like", "him", "her", "them", "dead", "lying", "liar", "cap",
    // Spanish / Portuguese / French / German basics
    "que", "el", "la", "los", "las", "de", "en", "y", "es", "yo", "tu", "no", "si", "eu", "voce", "nao", "sim", "um", "uma",
    "le", "les", "et", "je", "tu", "il", "elle", "est", "pas", "oui", "der", "die", "das", "und", "ich", "du", "ist", "nicht", "ja",
    // Russian / Ukrainian (Cyrillic OCR)
    "я", "ты", "он", "она", "мы", "вы", "они", "не", "да", "нет", "и", "в", "на", "с", "что", "кто", "где", "как", "это", "был",
    "была", "видел", "видела", "убил", "убила", "тело", "скип", "пропуск", "голос", "красный", "синий", "зеленый", "розовый",
    "оранжевый", "желтый", "черный", "белый", "фиолетовый", "коричневый", "голубой", "лаймовый", "привет", "все", "всем", "сам",
    "мне", "меня", "тебя", "его", "ее", "там", "тут", "здесь", "за", "по", "из", "от", "но", "или", "так", "ну", "же", "уже",
    "імпостер", "предатель", "импостер", "имп", "вент", "репорт",
];

fn is_weird_word(w: &str) -> bool {
    let w = w.trim_matches(|c: char| !c.is_alphanumeric());
    let chars: Vec<char> = w.chars().collect();
    let letters = chars.iter().filter(|c| c.is_alphabetic()).count();
    if letters == 0 { return false; }
    // A digit or stray symbol between two letters: "y6mn", "npb4BeT", "Bl,1Aen".
    let (mut seen_letter, mut gap) = (false, 0usize);
    for &c in &chars {
        if c.is_alphabetic() {
            if seen_letter && gap > 0 { return true; }
            seen_letter = true;
            gap = 0;
        } else if c == '\'' || c == '-' || c == '\u{2019}' {
            seen_letter = false; // "don't", "x-ray": a fresh part
            gap = 0;
        } else {
            gap += 1;
        }
    }
    // A digit glued to letters at the start of a word with ≥ 2 letters ("3a", "6bl") — but not "1st", "2nd", "0k"-style
    // English OCR slips are scored by the caller's short-text leniency, so only flag digit + ≥ 2 letters.
    if chars.len() >= 3 && chars[0].is_ascii_digit() && chars[1..].iter().all(|c| c.is_alphabetic()) && !matches!(w.to_lowercase().as_str(), "1st" | "2nd" | "3rd" | "4th" | "5th") { return true; }
    // Mixed scripts inside one word.
    let scripts: Vec<Script> = chars.iter().filter_map(|c| char_script(*c)).collect();
    if scripts.windows(2).any(|p| p[0] != p[1]) { return true; }
    // Capital after a lower-case letter, twice or more ("KpacHoro", "oneKTPVlKe"); once is a CamelCase name.
    let mut caps_after_lower = 0;
    for p in chars.windows(2) { if p[0].is_lowercase() && p[1].is_uppercase() { caps_after_lower += 1; } }
    if caps_after_lower >= 2 { return true; }
    // A run of ≥ 3 capitals followed by ≥ 2 lower-case letters ("CVIHero"); "IDKkk"-style shouting is rare.
    let upper_run = chars.iter().take_while(|c| c.is_uppercase()).count();
    if upper_run >= 3 && chars.len() >= upper_run + 2 && chars[upper_run..].iter().all(|c| c.is_lowercase()) { return true; }
    // Lower-case then capital then lower-case at the very end ("ronocyeM" is caught here: ends in a lone capital).
    if chars.len() >= 4 && chars[chars.len() - 1].is_uppercase() && chars[chars.len() - 2].is_lowercase() { return true; }
    false
}

/// Details of a plausibility score (kept for diagnostics).
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
pub struct Plausibility {
    pub score: f32,
    pub letters: u32,
    pub words: u32,
    pub weird_words: u32,
    pub dict_hits: u32,
}

/// 0..1: how much `text` looks like something a person typed (vs OCR garbage).
/// Short lines (< 4 letters) score a neutral 0.6: there is nothing to judge.
pub fn plausibility(text: &str) -> Plausibility {
    let non_space = text.chars().filter(|c| !c.is_whitespace()).count() as f32;
    let letters: Vec<char> = text.chars().filter(|c| c.is_alphabetic()).collect();
    let words: Vec<&str> = text.split_whitespace().collect();
    let mut p = Plausibility { letters: letters.len() as u32, words: words.len() as u32, ..Default::default() };
    if letters.len() < 4 { p.score = 0.6; return p; }
    let alpha_ratio = letters.len() as f32 / non_space.max(1.0);
    p.weird_words = words.iter().filter(|w| is_weird_word(w)).count() as u32;
    p.dict_hits = words.iter().filter(|w| {
        let t: String = w.chars().filter(|c| c.is_alphanumeric()).flat_map(|c| c.to_lowercase()).collect();
        !t.is_empty() && DICT.contains(&t.as_str())
    }).count() as u32;
    let vowels = letters.iter().filter(|c| c.to_lowercase().any(|l| VOWELS.contains(l))).count() as f32 / letters.len() as f32;
    // CJK / Arabic have no vowel letters in this sense: don't punish them.
    let script = script_of(text);
    let vowel_ok = if matches!(script, Script::Cjk | Script::Arabic | Script::Other) { 1.0 }
        else if (0.2..=0.7).contains(&vowels) { 1.0 } else if (0.1..=0.8).contains(&vowels) { 0.5 } else { 0.0 };
    let n = words.len().max(1) as f32;
    let weird = p.weird_words as f32 / n;
    let dict = (p.dict_hits as f32 / n * 2.0).min(1.0);
    p.score = (0.3 * alpha_ratio + 0.35 * (1.0 - weird) + 0.15 * vowel_ok + 0.2 * dict).clamp(0.0, 1.0);
    p
}

/// Latin letters that the English recognizer produces for Cyrillic glyphs (к→K, р→p, а→a, с→c, н→H,
/// о→o, г→r, в→B, т→T, м→M, у→y, б→6, з→3, ч→4, и→VI/Vl, п→n, л→n/Jl, е→e, х→x).
const CYR_LOOKALIKE: &str = "AaBbCcEeHKkMmnOoPpTtuXxyr3460VIlJN";

/// The line is probably Cyrillic text read by a Latin-only OCR engine.
pub fn looks_like_cyrillic_misread(text: &str) -> bool {
    let words: Vec<&str> = text.split_whitespace().filter(|w| w.chars().filter(|c| c.is_alphanumeric()).count() >= 2).collect();
    if words.is_empty() || has_non_ascii_letters(text) { return false; }
    let weird: Vec<&&str> = words.iter().filter(|w| is_weird_word(w)).collect();
    if weird.len() * 3 < words.len() { return false; } // at least a third of the words are mangled
    let alnum: Vec<char> = text.chars().filter(|c| c.is_alphanumeric()).collect();
    let look = alnum.iter().filter(|c| CYR_LOOKALIKE.contains(**c)).count();
    look * 10 >= alnum.len() * 8
}

/// Best-effort undo of a Latin-only OCR reading of Cyrillic: map look-alike glyphs back
/// ("KTO y6mn? ronocyeM" → "кто убмп? голосуем"). A GUESS for the translator, never shown as
/// what the player wrote; the UI labels it as such.
pub fn cyrillic_from_lookalike(text: &str) -> String {
    const MULTI: &[(&str, char)] = &[("bI", 'ы'), ("bl", 'ы'), ("b|", 'ы'), ("VI", 'и'), ("Vl", 'и'), ("Jl", 'л'), ("IO", 'ю'), ("lO", 'ю'), ("bI", 'ы')];
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len() * 2);
    let mut i = 0;
    'outer: while i < chars.len() {
        for (pat, cyr) in MULTI {
            let p: Vec<char> = pat.chars().collect();
            if chars[i..].starts_with(&p) { out.push(*cyr); i += p.len(); continue 'outer; }
        }
        let c = chars[i];
        let mapped = match c {
            'A' | 'a' => 'а', 'B' => 'в', 'b' => 'ь', '6' => 'б', 'C' | 'c' => 'с', 'E' | 'e' => 'е', 'H' | 'h' => 'н',
            'K' | 'k' => 'к', 'M' | 'm' => 'м', 'n' => 'п', 'N' => 'и', 'O' | 'o' | '0' => 'о', 'P' | 'p' => 'р',
            'T' | 't' => 'т', 'X' | 'x' => 'х', 'Y' | 'y' => 'у', 'r' => 'г', '3' => 'з', '4' => 'ч', 'u' => 'и',
            _ => c,
        };
        out.extend(mapped.to_lowercase());
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lookalike_guess_recovers_common_words() {
        assert_eq!(cyrillic_from_lookalike("KTO"), "кто");
        // л and п both come out of OCR as "n": the guess can't tell them apart (the translator usually can).
        assert!(cyrillic_from_lookalike("ronocyeM 3a").ends_with("осуем за"));
        assert!(cyrillic_from_lookalike("CVIHero").starts_with("си"));
    }

    #[test]
    fn real_english_scores_high_and_en_ocr_of_cyrillic_scores_low() {
        let en = plausibility("i saw them vent into electrical just before you").score;
        let garbage = plausibility("npb4BeT, Bl,1Aen KpacHoro B oneKTPVlKe").score;
        let garbage2 = plausibility("KTO y6mn? ronocyeM 3a CVIHero").score;
        assert!(en > 0.8, "{en}");
        assert!(garbage < 0.6, "{garbage}");
        assert!(garbage2 < 0.6, "{garbage2}");
        assert!(en - garbage > 0.25);
    }

    #[test]
    fn real_russian_scores_high() {
        let ru = plausibility("привет, я видел красного в электрике").score;
        assert!(ru > 0.8, "{ru}");
        assert!(ru > plausibility("npb4BeT, Bl,1Aen KpacHoro B oneKTPVlKe").score);
    }

    #[test]
    fn short_lines_are_neutral_and_camel_names_are_not_weird() {
        assert_eq!(plausibility("0k").score, 0.6);
        assert!(plausibility("BigBingus killed SHUSH in admin").score > 0.75);
        assert!(plausibility("1m not even engineer lol").score > 0.6);
    }

    #[test]
    fn script_detection() {
        assert_eq!(script_of("привет all"), Script::Cyrillic);
        assert_eq!(script_of("hello мир"), Script::Latin);
        assert_eq!(script_of("123 !!"), Script::None);
        assert_eq!(script_of("こんにちは"), Script::Cjk);
        assert!(has_non_ascii_letters("café"));
        assert!(!has_non_ascii_letters("cafe 123"));
    }

    #[test]
    fn spots_cyrillic_read_as_latin() {
        assert!(looks_like_cyrillic_misread("npb4BeT, Bl,1Aen KpacHoro B oneKTPVlKe"));
        assert!(looks_like_cyrillic_misread("KTO y6mn? ronocyeM 3a CVIHero"));
        assert!(!looks_like_cyrillic_misread("i saw them vent into electrical"));
        assert!(!looks_like_cyrillic_misread("привет"));
        assert!(!looks_like_cyrillic_misread("BigBingus hello"));
    }
}
