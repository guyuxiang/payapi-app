use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    Message(String),
    #[error("IO error at {path}: {source}")]
    Io {
        path: String,
        source: std::io::Error,
    },
    #[error("DB error: {0}")]
    Db(#[from] rusqlite::Error),
}

impl AppError {
    pub fn msg(s: impl Into<String>) -> Self {
        AppError::Message(s.into())
    }
    pub fn io(path: impl AsRef<std::path::Path>, source: std::io::Error) -> Self {
        AppError::Io {
            path: path.as_ref().to_string_lossy().into_owned(),
            source,
        }
    }
}

impl From<AppError> for String {
    fn from(e: AppError) -> String {
        e.to_string()
    }
}
