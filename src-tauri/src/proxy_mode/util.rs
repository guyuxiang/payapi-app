//! Atomic file-write utilities for config modification.
//!
//! Strategy: write to a temp file with a nanosecond-stamped name, flush,
//! then rename (atomic on POSIX; delete-then-rename on Windows).

use crate::error::AppError;
use serde_json::Value;
use std::io::Write as _;
use std::path::Path;

/// Return whether a binary exists in PATH without showing a console window on Windows.
pub fn binary_in_path(name: &str) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x08000000;

        std::process::Command::new("where")
            .arg(name)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    #[cfg(not(windows))]
    {
        std::process::Command::new("which")
            .arg(name)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}

/// Write `value` as pretty-printed JSON atomically.
pub fn atomic_write_json(path: &Path, value: &Value) -> Result<(), AppError> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| AppError::msg(e.to_string()))?;
    atomic_write(path, &bytes)
}

/// Write `text` atomically.
pub fn atomic_write_text(path: &Path, text: &str) -> Result<(), AppError> {
    atomic_write(path, text.as_bytes())
}

fn atomic_write(path: &Path, data: &[u8]) -> Result<(), AppError> {
    let parent = path.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(parent).map_err(|e| AppError::io(parent, e))?;

    // Unique temp name — nanosecond timestamp prevents collisions.
    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let tmp = parent.join(format!("{file_name}.tmp.{ts}"));

    // Write + flush to temp.
    let mut f = std::fs::File::create(&tmp).map_err(|e| AppError::io(&tmp, e))?;
    f.write_all(data).map_err(|e| AppError::io(&tmp, e))?;
    f.flush().map_err(|e| AppError::io(&tmp, e))?;
    drop(f);

    // Preserve source permissions on Unix before swap.
    #[cfg(unix)]
    if let Ok(meta) = std::fs::metadata(path) {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, meta.permissions());
        // Ensure at minimum 0600 for sensitive configs.
        let mode = meta.permissions().mode();
        if mode & 0o600 != 0o600 {
            let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(mode | 0o600));
        }
    }

    // Windows: rename fails if target exists — remove first.
    #[cfg(windows)]
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| AppError::io(path, e))?;
    }

    std::fs::rename(&tmp, path).map_err(|e| AppError::io(path, e))
}
