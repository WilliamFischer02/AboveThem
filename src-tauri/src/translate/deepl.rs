//! DeepL provider. Phase 3. Free tier: 500k chars/month, key from settings.json (never commit).

use super::{BoxFut, TranslateError, TranslateProvider};

pub struct DeepL { pub api_key: String, pub free_tier: bool }

impl TranslateProvider for DeepL {
    fn name(&self) -> &'static str { "deepl" }
    fn translate<'a>(&'a self, text: &'a str, from: &'a str, to: &'a str) -> BoxFut<'a, Result<String, TranslateError>> {
        Box::pin(async move {
            let base = if self.free_tier { "https://api-free.deepl.com" } else { "https://api.deepl.com" };
            #[derive(serde::Serialize)] struct Req<'b> { text: [&'b str; 1], target_lang: String, #[serde(skip_serializing_if = "Option::is_none")] source_lang: Option<String> }
            #[derive(serde::Deserialize)] struct Res { translations: Vec<T> }
            #[derive(serde::Deserialize)] struct T { text: String }
            let req = Req { text: [text], target_lang: to.to_uppercase(), source_lang: if from == "auto" { None } else { Some(from.to_uppercase()) } };
            let res = reqwest::Client::new().post(format!("{base}/v2/translate"))
                .header("Authorization", format!("DeepL-Auth-Key {}", self.api_key))
                .json(&req).send().await?;
            if !res.status().is_success() { return Err(TranslateError::Provider(res.status().to_string())); }
            Ok(res.json::<Res>().await?.translations.into_iter().next().map(|t| t.text).unwrap_or_default())
        })
    }
}
