#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

#[derive(Deserialize)]
struct CropRequest {
    input_path: String,
    output_path: String,
    crop: CropRect,
    output: OutputSettings,
    trim: Option<TrimRange>,
}

#[derive(Deserialize)]
struct CropRect {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

#[derive(Deserialize)]
struct OutputSettings {
    width: u32,
    height: u32,
    format: String,
}

#[derive(Deserialize)]
struct TrimRange {
    start: f64,
    end: f64,
}

#[tauri::command]
fn crop_video(app: tauri::AppHandle, req: CropRequest) -> Result<(), String> {
    let ffmpeg_path = resolve_ffmpeg_path(&app)?;
    let format = req.output.format.to_lowercase();

    let mut crop = req.crop;
    let mut out = req.output;
    crop.x = make_even(crop.x);
    crop.y = make_even(crop.y);
    crop.width = make_even(crop.width);
    crop.height = make_even(crop.height);
    out.width = make_even(out.width);
    out.height = make_even(out.height);

    if crop.width == 0 || crop.height == 0 {
        return Err("Crop size is empty after normalization.".to_string());
    }
    if out.width == 0 || out.height == 0 {
        return Err("Output size is empty after normalization.".to_string());
    }

    let filter = format!(
        "crop=w=min({cw}\\,in_w):h=min({ch}\\,in_h):x=min(max({cx}\\,0)\\,in_w-min({cw}\\,in_w)):y=min(max({cy}\\,0)\\,in_h-min({ch}\\,in_h)),scale={ow}:{oh}",
        cw = crop.width,
        ch = crop.height,
        cx = crop.x,
        cy = crop.y,
        ow = out.width,
        oh = out.height
    );

    let mut cmd = Command::new(ffmpeg_path);
    cmd.arg("-y");
    if let Some(trim) = &req.trim {
        let start = trim.start.max(0.0);
        let end = trim.end.max(start);
        let duration = end - start;
        if duration <= 0.0 {
            return Err("Trim duration must be greater than 0.".to_string());
        }
        cmd.arg("-ss").arg(format!("{:.3}", start));
        cmd.arg("-i").arg(&req.input_path);
        cmd.arg("-t").arg(format!("{:.3}", duration));
    } else {
        cmd.arg("-i").arg(&req.input_path);
    }

    cmd.args(["-map", "0:v:0", "-map", "0:a?"])
        .args(["-vf", &filter]);

    apply_format_args(&mut cmd, &format);
    cmd.arg(&req.output_path);

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(format!("ffmpeg failed:\n{}", tail_lines(&stderr, 12)))
}

fn apply_format_args(cmd: &mut Command, format: &str) {
    match format {
        "webm" => {
            cmd.args([
                "-c:v",
                "libvpx-vp9",
                "-b:v",
                "0",
                "-crf",
                "32",
                "-c:a",
                "libopus",
            ]);
        }
        "avi" => {
            cmd.args(["-c:v", "mpeg4", "-q:v", "3", "-c:a", "mp3"]);
        }
        "mov" => {
            cmd.args([
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "18",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-movflags",
                "+faststart",
            ]);
        }
        _ => {
            cmd.args([
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "18",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
            ]);
        }
    }
}

fn make_even(value: u32) -> u32 {
    let adjusted = if value < 2 { 2 } else { value };
    adjusted - (adjusted % 2)
}

fn resolve_ffmpeg_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(custom) = std::env::var("FFMPEG_PATH") {
        let path = PathBuf::from(custom);
        if path.exists() {
            return Ok(path);
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidates = ["ffmpeg.exe", "ffmpeg-x86_64-pc-windows-msvc.exe"];
        for name in candidates {
            let candidate = resource_dir.join("bin").join(name);
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        let exe_dir = exe.parent().unwrap_or_else(|| Path::new("."));
        let candidates = ["ffmpeg.exe", "ffmpeg-x86_64-pc-windows-msvc.exe"];

        for name in candidates {
            let candidate = exe_dir.join(name);
            if candidate.exists() {
                return Ok(candidate);
            }
        }

        let mut dir = exe_dir.to_path_buf();
        for _ in 0..5 {
            for name in candidates {
                let candidate = dir.join("bin").join(name);
                if candidate.exists() {
                    return Ok(candidate);
                }
            }
            if let Some(parent) = dir.parent() {
                dir = parent.to_path_buf();
            } else {
                break;
            }
        }
    }

    Ok(PathBuf::from("ffmpeg"))
}

fn tail_lines(text: &str, count: usize) -> String {
    let mut lines: Vec<&str> = text.lines().collect();
    if lines.len() > count {
        lines = lines.split_off(lines.len() - count);
    }
    lines.join("\n")
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![crop_video])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
