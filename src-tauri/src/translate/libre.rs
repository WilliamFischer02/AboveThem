//! LibreTranslate provider — keyless fallback (self-host or a public instance).

use super::{BoxFut, TranslateError, TranslateProvider};

pub struct Libre { pub endpoint: String, pub api_key: Option<String> }

impl Default for Libre {
    fn default() -> Self { Self { endpoint: "http://127.0.0.1:5000".into(), api_key: None } }
}

impl TranslateProvider for Libre {
    fn name(&self) -> &'static str { "libretranslate" }
    fn translate<'a>(&'a self, text: &'a str, from: &'a str, to: &'a str) -> BoxFut<'a, Result<String, TranslateError>> {
        Box::pin(async move {
            #[derive(serde::Serialize)] struct Req<'b> { q: &'b str, source: &'b str, target: &'b str, format: &'b str, api_key: Option<&'b str> }
            #[derive(serde::Deserialize)] struct Res { #[serde(rename = "translatedText")] translated_text: String }
            let client = reqwest::Client::new();
            let res = client.post(format!("{}/translate", self.endpoint))
                .json(&Req { q: text, source: from, target: to, format: "text", api_key: self.api_key.as_deref() })
                .send().await?;
            if !res.status().is_success() { return Err(TranslateError::Provider(res.status().to_string())); }
            Ok(res.json::<Res>().await?.translated_text)
        })
    }
}
