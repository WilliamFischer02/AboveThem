//! Translation providers. See docs/TRANSLATION.md.
//!
//! Provider choice (settings.json, `%APPDATA%\AboveThem`):
//!   { "translate": { "provider": "google" | "deepl" | "libre", "deeplKey": "...", "libreEndpoint": "http://..." } }
//! Default is the keyless Google endpoint so translation works out of the box.

pub use self::async_trait_lite::BoxFut; // boxed futures keep the trait object-safe without the async-trait crate
pub mod deepl;
pub mod google;
pub mod libre;

/// Offline language detection (ISO 639-1). Short strings return None.
pub fn detect(text: &str) -> Option<String> {
    if text.trim().chars().count() < 8 { return None; }
    whatlang::detect(text).filter(|i| i.is_reliable()).map(|i| i.lang().code().to_string())
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
