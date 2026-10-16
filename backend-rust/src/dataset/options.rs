//! Dataset-route settings (WkConf externalPathDeletionService / segmentAnything).
use std::fmt;

#[derive(Clone, Default)]
pub struct DatasetRouteConfig {
    /// `externalPathDeletionService.key`. Unset denies every request instead of
    /// accepting Play's well-known sample key.
    pub external_path_deletion_key: Option<String>,
    /// `features.segmentAnythingEnabled`.
    pub segment_anything_enabled: bool,
    pub segment_anything: SegmentAnythingConfig,
    pub upload_to_paths: UploadToPathsConfig,
}

/// `webKnossos.datasets.uploadToPaths`.
#[derive(Clone, Debug)]
pub struct UploadToPathsConfig {
    /// Normalized absolute UPaths. Empty uses the datastore's default
    /// organization-agnostic upload base directory `./binaryData`.
    pub prefixes: Vec<String>,
    pub insert_organization_directory: bool,
    pub infix: Option<String>,
}

impl Default for UploadToPathsConfig {
    fn default() -> Self {
        Self {
            prefixes: Vec::new(),
            insert_organization_directory: true,
            infix: Some(".virtual".to_owned()),
        }
    }
}

#[derive(Clone, Default)]
pub struct SegmentAnythingConfig {
    pub uri: String,
    pub user: String,
    pub password: String,
}

impl fmt::Debug for DatasetRouteConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DatasetRouteConfig")
            .field(
                "external_path_deletion_key",
                &self
                    .external_path_deletion_key
                    .as_ref()
                    .map(|_| "[redacted]"),
            )
            .field("segment_anything_enabled", &self.segment_anything_enabled)
            .field("segment_anything", &self.segment_anything)
            .field("upload_to_paths", &self.upload_to_paths)
            .finish()
    }
}

impl fmt::Debug for SegmentAnythingConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SegmentAnythingConfig")
            .field("has_uri", &!self.uri.is_empty())
            .field("user", &"[redacted]")
            .field("password", &"[redacted]")
            .finish()
    }
}
