use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const IDLE_CAP_MS: u64 = 10 * 60 * 1000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DateRange {
    from: Option<String>,
    to: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceCounts {
    threads: usize,
    rollouts_read: usize,
    missing_rollouts: usize,
    skipped_out_of_scope: usize,
    malformed_lines: usize,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActivityDay {
    date: String,
    sessions: u64,
    messages: u64,
    tool_calls: u64,
    tokens: u64,
    active_minutes_estimate: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexAggregate {
    period_label: String,
    date_range: DateRange,
    sessions: usize,
    user_messages: u64,
    assistant_messages: u64,
    tool_calls: u64,
    tokens: u64,
    active_minutes_estimate: u64,
    activity_days: Vec<ActivityDay>,
    confidence: String,
    source_counts: SourceCounts,
}

struct ThreadRow {
    rollout_path: String,
    created_at_ms: Option<i64>,
    updated_at_ms: Option<i64>,
    tokens_used: u64,
}

#[derive(Default)]
struct RolloutAggregate {
    user_messages: u64,
    assistant_messages: u64,
    tool_calls: u64,
    active_ms: u64,
    malformed_lines: usize,
}

fn iso_date_from_ms(ms: Option<i64>) -> Option<String> {
    let value = ms?;
    let days = (value / 1000) / 86_400;
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if month <= 2 { 1 } else { 0 };
    Some(format!("{:04}-{:02}-{:02}", year, month, day))
}

fn add_activity_day(
    days: &mut BTreeMap<String, ActivityDay>,
    date: Option<String>,
    sessions: u64,
    messages: u64,
    tool_calls: u64,
    tokens: u64,
    active_minutes_estimate: u64,
) {
    let Some(date) = date else {
        return;
    };
    let entry = days.entry(date.clone()).or_insert_with(|| ActivityDay {
        date,
        ..ActivityDay::default()
    });
    entry.sessions += sessions;
    entry.messages += messages;
    entry.tool_calls += tool_calls;
    entry.tokens += tokens;
    entry.active_minutes_estimate += active_minutes_estimate;
}

fn path_inside_root(candidate: &Path, root: &Path) -> bool {
    let Ok(candidate) = candidate.canonicalize() else {
        return false;
    };
    let Ok(root) = root.canonicalize() else {
        return false;
    };
    candidate == root || candidate.starts_with(root)
}

fn parse_rollout(text: &str) -> RolloutAggregate {
    let mut aggregate = RolloutAggregate::default();

    for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let Ok(event) = serde_json::from_str::<Value>(line) else {
            aggregate.malformed_lines += 1;
            continue;
        };
        let event_type = event.get("type").and_then(Value::as_str).unwrap_or("");
        let payload = event.get("payload").unwrap_or(&Value::Null);

        if event_type == "response_item" {
            let payload_type = payload.get("type").and_then(Value::as_str).unwrap_or("");
            if payload_type == "message" {
                match payload.get("role").and_then(Value::as_str).unwrap_or("") {
                    "user" => aggregate.user_messages += 1,
                    "assistant" => aggregate.assistant_messages += 1,
                    _ => {}
                }
            }
            if matches!(
                payload_type,
                "function_call" | "custom_tool_call" | "web_search_call" | "image_generation_call" | "tool_search_call"
            ) {
                aggregate.tool_calls += 1;
            }
        }

        if event_type == "event_msg" && payload.get("type").and_then(Value::as_str).unwrap_or("") == "task_complete" {
            let duration = payload.get("duration_ms").and_then(Value::as_u64).unwrap_or(0);
            aggregate.active_ms += duration.min(IDLE_CAP_MS);
        }
    }

    aggregate
}

#[tauri::command]
fn scan_codex_root(root: String) -> Result<CodexAggregate, String> {
    let root_path = PathBuf::from(root);
    let canonical_root = root_path
        .canonicalize()
        .map_err(|_| "Selected Codex root is not readable.".to_string())?;
    let db_path = canonical_root.join("sqlite").join("state_5.sqlite");
    if !db_path.exists() {
        return Err("Selected root does not contain sqlite/state_5.sqlite.".to_string());
    }

    let connection = Connection::open(&db_path).map_err(|error| error.to_string())?;
    let mut statement = connection
        .prepare("select rollout_path, created_at_ms, updated_at_ms, tokens_used from threads")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(ThreadRow {
                rollout_path: row.get(0)?,
                created_at_ms: row.get(1).ok(),
                updated_at_ms: row.get(2).ok(),
                tokens_used: row.get::<_, i64>(3).unwrap_or(0).max(0) as u64,
            })
        })
        .map_err(|error| error.to_string())?;

    let threads: Vec<ThreadRow> = rows.filter_map(Result::ok).collect();
    let mut user_messages = 0;
    let mut assistant_messages = 0;
    let mut tool_calls = 0;
    let mut active_ms = 0;
    let mut tokens = 0;
    let mut rollouts_read = 0;
    let mut missing_rollouts = 0;
    let mut skipped_out_of_scope = 0;
    let mut malformed_lines = 0;
    let mut activity_by_date = BTreeMap::<String, ActivityDay>::new();

    for thread in &threads {
        tokens += thread.tokens_used;
        let activity_date = iso_date_from_ms(thread.updated_at_ms.or(thread.created_at_ms));
        add_activity_day(&mut activity_by_date, activity_date.clone(), 1, 0, 0, thread.tokens_used, 0);
        let rollout_path = PathBuf::from(&thread.rollout_path);
        if !path_inside_root(&rollout_path, &canonical_root) {
            skipped_out_of_scope += 1;
            continue;
        }
        let Ok(text) = fs::read_to_string(&rollout_path) else {
            missing_rollouts += 1;
            continue;
        };
        let rollout = parse_rollout(&text);
        rollouts_read += 1;
        user_messages += rollout.user_messages;
        assistant_messages += rollout.assistant_messages;
        tool_calls += rollout.tool_calls;
        active_ms += rollout.active_ms;
        malformed_lines += rollout.malformed_lines;
        add_activity_day(
            &mut activity_by_date,
            activity_date,
            0,
            rollout.user_messages + rollout.assistant_messages,
            rollout.tool_calls,
            0,
            rollout.active_ms / 60_000,
        );
    }

    let from = threads.iter().filter_map(|thread| thread.created_at_ms).min();
    let to = threads.iter().filter_map(|thread| thread.updated_at_ms).max();
    let from_label = iso_date_from_ms(from);
    let to_label = iso_date_from_ms(to);
    let period_label = match (&from_label, &to_label) {
        (Some(from), Some(to)) => format!("{} to {}", from, to),
        _ => "No verified period".to_string(),
    };
    let confidence = if threads.is_empty() {
        "empty"
    } else if missing_rollouts > 0 || skipped_out_of_scope > 0 || malformed_lines > 0 {
        "partial"
    } else {
        "verified"
    };

    Ok(CodexAggregate {
        period_label,
        date_range: DateRange {
            from: from_label,
            to: to_label,
        },
        sessions: threads.len(),
        user_messages,
        assistant_messages,
        tool_calls,
        tokens,
        active_minutes_estimate: active_ms / 60_000,
        activity_days: activity_by_date.into_values().collect(),
        confidence: confidence.to_string(),
        source_counts: SourceCounts {
            threads: threads.len(),
            rollouts_read,
            missing_rollouts,
            skipped_out_of_scope,
            malformed_lines,
        },
    })
}

fn applescript_quote(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn safe_png_name(name: &str) -> String {
    let cleaned = name
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' => '-',
            _ => character,
        })
        .collect::<String>();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "codex-merit-token-4096.png".to_string()
    } else if trimmed.ends_with(".png") {
        trimmed.to_string()
    } else {
        format!("{trimmed}.png")
    }
}

#[tauri::command]
fn save_png_with_panel(png: Vec<u8>, name: String) -> Result<String, String> {
    if png.is_empty() {
        return Err("PNG save payload is empty.".to_string());
    }

    let safe_name = applescript_quote(&safe_png_name(&name));
    let script = format!(
        "set savePath to choose file name with prompt \"Save Codex merit card\" default name \"{}\"\nPOSIX path of savePath",
        safe_name
    );
    let output = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|error| format!("Could not open the macOS save sheet: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.contains("-128") || stderr.to_lowercase().contains("canceled") {
            "Save cancelled.".to_string()
        } else if stderr.is_empty() {
            "macOS save sheet failed.".to_string()
        } else {
            stderr
        });
    }

    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        return Err("macOS save sheet did not return a file path.".to_string());
    }
    fs::write(&path, png).map_err(|error| format!("Could not write the PNG file: {error}"))?;
    Ok(path)
}

#[tauri::command]
fn copy_text_to_clipboard(text: String) -> Result<(), String> {
    let mut child = Command::new("/usr/bin/pbcopy")
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start pbcopy: {error}"))?;

    let stdin = child
        .stdin
        .as_mut()
        .ok_or_else(|| "Could not open pbcopy stdin.".to_string())?;
    stdin
        .write_all(text.as_bytes())
        .map_err(|error| format!("Could not write caption to clipboard: {error}"))?;

    let status = child
        .wait()
        .map_err(|error| format!("Could not finish pbcopy: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("pbcopy failed while copying the caption.".to_string())
    }
}

#[tauri::command]
fn copy_png_to_clipboard(png: Vec<u8>) -> Result<(), String> {
    if png.is_empty() {
        return Err("PNG clipboard payload is empty.".to_string());
    }

    let path = std::env::temp_dir().join(format!(
        "codex-work-badge-clipboard-{}.png",
        std::process::id()
    ));
    fs::write(&path, png).map_err(|error| format!("Could not prepare PNG clipboard file: {error}"))?;

    let path_text = applescript_quote(
        path.to_str()
            .ok_or_else(|| "PNG clipboard path is not valid UTF-8.".to_string())?,
    );
    let script = format!(
        "set the clipboard to (read (POSIX file \"{}\") as «class PNGf»)",
        path_text
    );
    let output = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|error| format!("Could not start osascript: {error}"))?;

    let _ = fs::remove_file(path);

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            "osascript failed while copying the PNG image.".to_string()
        } else {
            stderr
        })
    }
}

#[tauri::command]
fn open_png_file(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err("Saved PNG file does not exist.".to_string());
    }

    let status = Command::new("/usr/bin/open")
        .arg("-a")
        .arg("Preview")
        .arg(&path)
        .status()
        .map_err(|error| format!("Could not open Preview: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("Preview failed to open the saved PNG.".to_string())
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            scan_codex_root,
            save_png_with_panel,
            copy_text_to_clipboard,
            copy_png_to_clipboard,
            open_png_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Codex Work Badge");
}
