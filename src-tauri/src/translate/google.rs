//! Keyless Google Translate endpoint (`translate.googleapis.com/translate_a/single?client=gtx`).
//!
//! Unofficial but stable for years and good enough for 100-character chat lines; it also
//! returns the detected source language, which `whatlang` cannot do reliably on short text.
//! Falls back to DeepL / LibreTranslate when a key or endpoint is configured (see mod.rs).

use super::{BoxFut, TranslateError, TranslateProvider, Translation};

#[derive(Default)]
pub struct GoogleFree;

impl TranslateProvider for GoogleFree {
    fn name(&self) -> &'static str { "google" }
    fn translate<'a>(&'a self, text: &'a str, from: &'a str, to: &'a str) -> BoxFut<'a, Result<Translation, TranslateError>> {
        Box::pin(async move {
            let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(6)).build()?;
            let res = client.get("https://translate.googleapis.com/translate_a/single")
                .query(&[("client", "gtx"), ("sl", if from.is_empty() { "auto" } else { from }), ("tl", to), ("dt", "t"), ("q", text)])
                .send().await?;
            if !res.status().is_success() { return Err(TranslateError::Provider(res.status().to_string())); }
            let v: serde_json::Value = res.json().await?;
            // [[["translated chunk","original chunk",null,null,10], ...], null, "detected-lang", ...]
            let mut out = String::new();
            if let Some(chunks) = v.get(0).and_then(|c| c.as_array()) {
                for ch in chunks { if let Some(t) = ch.get(0).and_then(|t| t.as_str()) { out.push_str(t); } }
            }
            let detected = v.get(2).and_then(|d| d.as_str()).map(|d| d.split('-').next().unwrap_or(d).to_lowercase());
            Ok(Translation { text: out, detected })
        })
    }
}
