//! Translation providers. See docs/TRANSLATION.md.

pub use self::async_trait_lite::BoxFut; // boxed futures keep the trait object-safe without the async-trait crate
pub mod libre;
pub mod deepl;

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

pub trait TranslateProvider: Send + Sync {
    fn name(&self) -> &'static str;
    fn translate<'a>(&'a self, text: &'a str, from: &'a str, to: &'a str) -> BoxFut<'a, Result<String, TranslateError>>;
}

/// Current provider. Phase 3: read from settings.json; default to LibreTranslate public instance.
pub fn current() -> Box<dyn TranslateProvider> {
    Box::new(libre::Libre::default())
}

mod async_trait_lite {
    use std::future::Future;
    use std::pin::Pin;
    pub type BoxFut<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;
}
