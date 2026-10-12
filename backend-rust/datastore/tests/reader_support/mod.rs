use std::sync::Arc;
use webknossos_datastore::datavault::{FileSystemDataVault, UPath, VaultPath};
#[derive(Debug, Default)]
pub struct RecordingVault {
    pub reads: std::sync::Mutex<
        Vec<(
            String,
            webknossos_datastore::datavault::ByteRange,
            Option<String>,
        )>,
    >,
}
impl webknossos_datastore::datavault::DataVault for RecordingVault {
    fn read_bytes_encoding_and_range_header<'a>(
        &'a self,
        p: &'a UPath,
        range: webknossos_datastore::datavault::ByteRange,
        token: Option<&'a str>,
    ) -> webknossos_datastore::datavault::BoxFuture<
        'a,
        webknossos_datastore::datavault::VaultResult<webknossos_datastore::datavault::RawRead>,
    > {
        Box::pin(async move {
            self.reads
                .lock()
                .unwrap()
                .push((p.to_string(), range, token.map(str::to_owned)));
            tokio::task::yield_now().await;
            FileSystemDataVault
                .read_bytes_encoding_and_range_header(p, range, token)
                .await
        })
    }
    fn list_directory<'a>(
        &'a self,
        p: &'a UPath,
        max: usize,
        token: Option<&'a str>,
    ) -> webknossos_datastore::datavault::BoxFuture<
        'a,
        webknossos_datastore::datavault::VaultResult<Vec<UPath>>,
    > {
        Box::pin(async move { FileSystemDataVault.list_directory(p, max, token).await })
    }
    fn used_storage_bytes<'a>(
        &'a self,
        p: &'a UPath,
        token: Option<&'a str>,
    ) -> webknossos_datastore::datavault::BoxFuture<
        'a,
        webknossos_datastore::datavault::VaultResult<u64>,
    > {
        Box::pin(async move { FileSystemDataVault.used_storage_bytes(p, token).await })
    }
    fn kind(&self) -> &'static str {
        "RecordingVault"
    }
}

pub fn recording_path(p: &std::path::Path) -> (VaultPath, Arc<RecordingVault>) {
    let vault = Arc::new(RecordingVault::default());
    (
        VaultPath::new(UPath::parse(p.to_str().unwrap()).unwrap(), vault.clone()),
        vault,
    )
}
