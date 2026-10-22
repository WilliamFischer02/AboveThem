//! Translation providers. See docs/TRANSLATION.md.
//!
//! Provider choice (settings.json, `%APPDATA%\AboveThem`):
//!   { "translate": { "provider": "google" | "deepl" | "libre", "deeplKey": "...", "libreEndpoint": "http://..." } }
//! Default is the keyless Google endpoint so translation works out of the box.

pub use self::async_trait_lite::BoxFut; // boxed futures keep the trait object-safe without the async-trait crate
pub mod deepl;
pub mod google;
pub mod libre;

/// whatlang speaks ISO 639-3 ("rus", "eng"); Google / DeepL / Libre and the UI speak ISO 639-1 ("ru", "en").
/// Session-5 bug: the 3-letter code went to Google as `sl=rus`, the request failed and the line silently
/// stayed untranslated — exactly for the long, reliably-detected (i.e. clearly foreign) lines.
pub fn iso639_1(code3: &str) -> Option<&'static str> {
    Some(match code3 {
        "eng" => "en", "rus" => "ru", "ukr" => "uk", "bel" => "be", "bul" => "bg", "srp" => "sr", "mkd" => "mk",
        "cmn" => "zh", "jpn" => "ja", "kor" => "ko", "spa" => "es", "por" => "pt", "ita" => "it", "fra" => "fr",
        "deu" => "de", "nld" => "nl", "pol" => "pl", "ces" => "cs", "slk" => "sk", "slv" => "sl", "hrv" => "hr",
        "hun" => "hu", "ron" => "ro", "tur" => "tr", "ell" => "el", "ara" => "ar", "heb" => "he", "yid" => "yi",
        "hin" => "hi", "ben" => "bn", "urd" => "ur", "pes" => "fa", "tha" => "th", "vie" => "vi", "ind" => "id",
        "jav" => "jw", "tgl" => "tl", "swe" => "sv", "dan" => "da", "nob" => "no", "fin" => "fi", "est" => "et",
        "lav" => "lv", "lit" => "lt", "cat" => "ca", "lat" => "la", "afr" => "af", "epo" => "eo", "kat" => "ka",
        "hye" => "hy", "aze" => "az", "uzb" => "uz", "tuk" => "tk", "amh" => "am", "mar" => "mr", "kan" => "kn",
        "tam" => "ta", "tel" => "te", "guj" => "gu", "pan" => "pa", "mal" => "ml", "ori" => "or", "mya" => "my",
        "nep" => "ne", "sin" => "si", "khm" => "km", "aka" => "ak", "zul" => "zu", "sna" => "sn",
        _ => return None,
    })
}

/// Offline language detection, ISO 639-1. Latin-script text needs ≥ 8 chars and a reliable verdict;
/// non-Latin script (Cyrillic, CJK, Arabic…) takes whatlang's best guess even on short text — the
/// script already rules out English, and an explicit `sl` beats Google's guess on 3-word lines.
pub fn detect(text: &str) -> Option<String> {
    use crate::textscore::{script_of, Script};
    let t = text.trim();
    let info = whatlang::detect(t)?;
    let code = iso639_1(info.lang().code())?;
    if t.chars().count() >= 8 && info.is_reliable() { return Some(code.to_string()); }
    let script = script_of(t);
    if !matches!(script, Script::Latin | Script::None) && code != "en" { return Some(code.to_string()); }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_returns_two_letter_codes() {
        assert_eq!(detect("привет, я видел красного в электрике").as_deref(), Some("ru"));
        // whatlang rarely calls English "reliable" on chat-length lines; when it does, the code must be "en", not "eng".
        assert!(matches!(detect("the quick brown fox jumps over the lazy dog and then it runs away").as_deref(), None | Some("en")));
        assert!(detect("i saw them vent into electrical just before you").map(|c| c.len() == 2).unwrap_or(true));
    }

    #[test]
    fn short_cyrillic_still_gets_a_language() {
        let d = detect("кто убил").expect("cyrillic short text gets a guess");
        assert!(["ru", "uk", "bg", "sr", "mk", "be"].contains(&d.as_str()), "{d}");
        assert_eq!(detect("ok"), None);
    }

    #[test]
    fn every_whatlang_code_maps() {
        for code in ["eng", "rus", "ukr", "cmn", "spa", "por", "deu", "fra", "pol", "tur", "ara", "jpn", "kor"] {
            assert!(iso639_1(code).is_some(), "{code}");
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum TranslateError {
    #[error("no provider configured")]
    NoProvider,
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("provider error: {0}")]
    Provider(String),
}

#[derive(Clone, Debug, Default)]
pub struct Translation { pub text: String, pub detected: Option<String> }

pub trait TranslateProvider: Send + Sync {
    fn name(&self) -> &'static str;
    fn translate<'a>(&'a self, text: &'a str, from: &'a str, to: &'a str) -> BoxFut<'a, Result<Translation, TranslateError>>;
}

#[derive(Clone, Debug, Default, serde::Deserialize)]
pub struct TranslateSettings {
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default, rename = "deeplKey")]
    pub deepl_key: Option<String>,
    #[serde(default, rename = "libreEndpoint")]
    pub libre_endpoint: Option<String>,
}

fn settings() -> TranslateSettings {
    #[derive(serde::Deserialize)]
    struct Root { #[serde(default)] translate: Option<TranslateSettings> }
    crate::files::read_app_file("settings.json".into()).ok().flatten()
        .and_then(|t| serde_json::from_str::<Root>(&t).ok())
        .and_then(|r| r.translate)
        .unwrap_or_default()
}

/// Current provider from settings.json; the keyless Google endpoint by default.
pub fn current() -> Box<dyn TranslateProvider> {
    let s = settings();
    match (s.provider.as_deref(), s.deepl_key, s.libre_endpoint) {
        (Some("deepl"), Some(key), _) | (None, Some(key), _) if !key.is_empty() => Box::new(deepl::DeepL { api_key: key, free_tier: true }),
        (Some("libre"), _, endpoint) => Box::new(libre::Libre { endpoint: endpoint.unwrap_or_else(|| "http://127.0.0.1:5000".into()), api_key: None }),
        _ => Box::new(google::GoogleFree),
    }
}

mod async_trait_lite {
    use std::future::Future;
    use std::pin::Pin;
    pub type BoxFut<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;
}
