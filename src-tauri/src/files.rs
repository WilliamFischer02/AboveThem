//! App-data files: `%APPDATA%/AboveThem/`.
//!
//!   matches/<id>.ndjson   append-only match event logs (one JSON event per line)
//!   presets.json          lobby presets keyed by lobby code (written by the frontend)
//!   settings.json         app settings (frontend-owned JSON)
//!
//! Thin, synchronous std::fs. Nothing here knows what an event is; the
//! frontend (`src/state/events.ts`) owns the schema.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

/// `%APPDATA%/AboveThem` on Windows; `~/.local/share/AboveThem` elsewhere (dev convenience).
pub fn app_dir() -> Result<PathBuf, String> {
    let base = if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share"))
    };
    let base = base.ok_or("APPDATA not set")?;
    let dir = base.join("AboveThem");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn matches_dir() -> Result<PathBuf, String> {
    let d = app_dir()?.join("matches");
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

/// Reject anything that could escape the app dir. Ids/names are `[A-Za-z0-9._-]` only.
fn safe_name(name: &str) -> Result<&str, String> {
    if name.is_empty()
        || name.len() > 128
        || name.starts_with('.')
        || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
    {
        return Err(format!("invalid file name: {name:?}"));
    }
    Ok(name)
}

fn match_path(id: &str) -> Result<PathBuf, String> {
    Ok(matches_dir()?.join(format!("{}.ndjson", safe_name(id)?)))
}

fn append_line(path: &Path, line: &str) -> Result<(), String> {
    let mut f = OpenOptions::new().create(true).append(true).open(path).map_err(|e| e.to_string())?;
    // One event per line; strip any embedded newline so a bad payload can't split the log.
    let clean = line.replace(['\n', '\r'], " ");
    f.write_all(clean.as_bytes()).map_err(|e| e.to_string())?;
    f.write_all(b"\n").map_err(|e| e.to_string())?;
    f.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn append_match_event(match_id: String, line: String) -> Result<(), String> {
    append_line(&match_path(&match_id)?, &line)
}

#[derive(serde::Serialize)]
pub struct MatchFile {
    pub id: String,
    pub modified_ms: u64,
    pub bytes: u64,
}

#[tauri::command]
pub fn list_matches() -> Result<Vec<MatchFile>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(matches_dir()?).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("ndjson") { continue; }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else { continue };
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        let modified_ms = meta.modified().ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        out.push(MatchFile { id: stem.to_string(), modified_ms, bytes: meta.len() });
    }
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    Ok(out)
}

#[tauri::command]
pub fn read_match(match_id: String) -> Result<String, String> {
    fs::read_to_string(match_path(&match_id)?).map_err(|e| e.to_string())
}

/// Read a JSON/text file directly under the app dir (presets.json, settings.json). Missing → Ok(None).
#[tauri::command]
pub fn read_app_file(name: String) -> Result<Option<String>, String> {
    let p = app_dir()?.join(safe_name(&name)?);
    match fs::read_to_string(&p) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Atomic-ish write: write to `<name>.tmp` then rename over the target.
#[tauri::command]
pub fn write_app_file(name: String, contents: String) -> Result<(), String> {
    let dir = app_dir()?;
    let target = dir.join(safe_name(&name)?);
    let tmp = dir.join(format!("{}.tmp", safe_name(&name)?));
    fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &target).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn app_dir_path() -> Result<String, String> {
    Ok(app_dir()?.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_path_escapes() {
        assert!(safe_name("..").is_err());
        assert!(safe_name("../x").is_err());
        assert!(safe_name("a/b").is_err());
        assert!(safe_name("C:\\x").is_err());
        assert!(safe_name(".hidden").is_err());
        assert!(safe_name("2026-10-21T01-02-03.ndjson").is_ok());
        assert!(safe_name("presets.json").is_ok());
    }

    #[test]
    fn append_strips_newlines() {
        let dir = std::env::temp_dir().join(format!("abovethem-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("t.ndjson");
        append_line(&p, "{\"a\":1}\n{\"b\":2}").unwrap();
        append_line(&p, "{\"c\":3}").unwrap();
        let s = fs::read_to_string(&p).unwrap();
        assert_eq!(s.lines().count(), 2);
        fs::remove_dir_all(&dir).unwrap();
    }
}
