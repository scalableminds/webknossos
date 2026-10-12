use serde::Deserialize;
use std::path::PathBuf;
use webknossos_datastore::datareaders::precomputed::compresso::{CompressoHeader, decode};
fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/compresso")
}
#[derive(Deserialize)]
struct Case {
    name: String,
    width: usize,
    shape: [usize; 3],
}
#[test]
fn independent_encoder_and_native_cpp_corpus_matches_all_windows_labels_and_connectivity() {
    let cases: Vec<Case> =
        serde_json::from_slice(&std::fs::read(root().join("cases.json")).unwrap()).unwrap();
    for case in cases {
        let bytes = std::fs::read(root().join(format!("{}.cpso", case.name))).unwrap();
        let header = CompressoHeader::parse(&bytes).unwrap();
        assert_eq!(header.shape, case.shape);
        assert_eq!(header.label_width, case.width);
        let expected = std::fs::read(root().join(format!("{}.raw", case.name))).unwrap();
        assert_eq!(
            decode(&bytes, expected.len()).unwrap(),
            expected,
            "{}",
            case.name
        );
        assert!(decode(&bytes, expected.len() - 1).is_err(), "{}", case.name);
    }
}
#[test]
fn safe_errors_and_literal_instructions_match_actual_repository_jni() {
    let cases: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root().join("jni_errors.json")).unwrap()).unwrap();
    for case in cases.as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let bytes = std::fs::read(root().join(format!("{name}.cpso"))).unwrap();
        let actual = decode(&bytes, 1024);
        if case["success"].as_bool().unwrap() {
            assert_eq!(
                actual.unwrap(),
                std::fs::read(root().join(format!("{name}.raw"))).unwrap()
            );
        } else {
            assert_eq!(
                actual.unwrap_err().message,
                case["error"].as_str().unwrap(),
                "{name}"
            );
        }
    }
}
#[test]
fn malformed_counts_steps_indices_and_size_limits_fail_without_panicking() {
    let source = std::fs::read(root().join("literal_escape.cpso")).unwrap();
    for n in 0..36 {
        assert!(decode(&source[..n], 1024).is_err());
    }
    for steps in [[0, 1, 1], [1, 0, 1], [1, 1, 0], [8, 8, 2], [255, 255, 255]] {
        let mut bytes = source.clone();
        bytes[12..15].copy_from_slice(&steps);
        assert!(decode(&bytes, 1024).is_err());
    }
    for (range, value) in [
        (15..23, u64::MAX),
        (23..27, u32::MAX as u64),
        (27..35, u64::MAX),
    ] {
        let mut bytes = source.clone();
        let size = range.len();
        bytes[range].copy_from_slice(&value.to_le_bytes()[..size]);
        assert!(decode(&bytes, 1024).is_err());
    }
    let mut bytes = source.clone();
    bytes[6..12].fill(255);
    assert!(decode(&bytes, usize::MAX).is_err());
    // Out-of-table boundary code and a run beyond the single-block grid.
    let mut bytes = source.clone();
    *bytes.last_mut().unwrap() = 2;
    assert!(decode(&bytes, 1024).is_err());
    let mut bytes = source.clone();
    *bytes.last_mut().unwrap() = 255;
    assert!(decode(&bytes, 1024).is_err());
    // No value after a literal-escape instruction (unlike native's unchecked read).
    let mut bytes = source.clone();
    bytes[27..35].copy_from_slice(&1u64.to_le_bytes());
    bytes.remove(38);
    assert!(decode(&bytes, 1024).is_err());
    let mut bytes = source;
    bytes[4] = 1;
    assert!(decode(&bytes, 1024).is_err());
}
use std::sync::Arc;
use webknossos_datastore::{
    datareaders::{ChunkContentsCache, precomputed::open_precomputed_array},
    datavault::{FileSystemDataVault, UPath, VaultPath},
    models::{AxisOrder, DataSourceId, Vec3Int},
};
fn vault(path: &std::path::Path) -> VaultPath {
    VaultPath::new(
        UPath::parse(path.to_str().unwrap()).unwrap(),
        Arc::new(FileSystemDataVault),
    )
}
#[tokio::test]
async fn compresso_precomputed_reads_plain_and_sharded_gzip_boundary_chunks_with_offsets() {
    for width in [1, 2, 4, 8] {
        for mode in ["plain", "shard_raw", "shard_gzip"] {
            let p = root().join("volumes").join(format!("u{width}_{mode}"));
            let array = open_precomputed_array(
                &vault(&p.join("1")),
                DataSourceId::new("ds", "org"),
                "seg",
                Some(AxisOrder::XYZ),
                None,
                None,
                Arc::new(ChunkContentsCache::new(1 << 20)),
                None,
            )
            .await
            .unwrap();
            let full = array
                .read_bytes_with_additional_coordinates(
                    Vec3Int::new(5, 7, 11),
                    Vec3Int::new(7, 5, 3),
                    None,
                    false,
                    None,
                )
                .await
                .unwrap();
            assert_eq!(
                full,
                std::fs::read(p.join("expected_full.raw")).unwrap(),
                "u{width}_{mode}"
            );
            let crop = array
                .read_bytes_with_additional_coordinates(
                    Vec3Int::new(6, 8, 12),
                    Vec3Int::new(6, 4, 2),
                    None,
                    false,
                    None,
                )
                .await
                .unwrap();
            assert_eq!(
                crop,
                std::fs::read(p.join("expected_crop.raw")).unwrap(),
                "u{width}_{mode}"
            );
        }
    }
}
#[tokio::test]
async fn mismatched_compresso_chunk_shapes_widths_and_channels_fail_before_decoding() {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let source = root().join("volumes/u4_plain");
    let original = std::fs::read(source.join("1/5-9_7-10_11-13")).unwrap();
    for (name, channels, header) in [
        ("width", 1, [8, 4, 3, 2]),
        ("shape", 1, [4, 3, 4, 2]),
        ("channels", 2, [4, 4, 3, 2]),
    ] {
        let p = std::env::temp_dir().join(format!(
            "wk-compresso-{name}-{}-{}",
            std::process::id(),
            N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir_all(p.join("1")).unwrap();
        let mut metadata: serde_json::Value =
            serde_json::from_slice(&std::fs::read(source.join("info")).unwrap()).unwrap();
        metadata["num_channels"] = serde_json::json!(channels);
        std::fs::write(p.join("info"), serde_json::to_vec(&metadata).unwrap()).unwrap();
        let mut bytes = original.clone();
        bytes[5] = header[0];
        for d in 0..3 {
            bytes[6 + d * 2..8 + d * 2].copy_from_slice(&(header[1 + d] as u16).to_le_bytes());
        }
        std::fs::write(p.join("1/5-9_7-10_11-13"), bytes).unwrap();
        let array = open_precomputed_array(
            &vault(&p.join("1")),
            DataSourceId::new("ds", "org"),
            "seg",
            Some(AxisOrder::XYZ),
            None,
            None,
            Arc::new(ChunkContentsCache::new(1 << 20)),
            None,
        )
        .await;
        if channels == 2 {
            assert!(array.is_err());
            continue;
        }
        assert!(
            array
                .unwrap()
                .source_chunk_with_cache(&[0, 0, 0], None)
                .await
                .is_err(),
            "{name}"
        );
    }
}
#[tokio::test]
async fn compresso_remote_shard_cache_uses_each_current_token_for_fragment_reads() {
    use axum::{
        Router,
        extract::OriginalUri,
        http::{HeaderMap, StatusCode, header},
        response::IntoResponse,
    };
    use std::sync::Mutex;
    let source = root().join("volumes/u8_shard_gzip");
    let reads = Arc::new(Mutex::new(Vec::<(String, Option<String>)>::new()));
    let log = Arc::clone(&reads);
    let server =
        Router::new().fallback(move |OriginalUri(uri): OriginalUri, headers: HeaderMap| {
            let source = source.clone();
            let log = Arc::clone(&log);
            async move {
                let path = uri.path().trim_start_matches('/');
                log.lock().unwrap().push((
                    path.to_owned(),
                    headers
                        .get("x-auth-token")
                        .and_then(|h| h.to_str().ok())
                        .map(str::to_owned),
                ));
                let bytes = std::fs::read(source.join(path)).unwrap();
                if let Some(range) = headers.get(header::RANGE) {
                    let (a, b) = range
                        .to_str()
                        .unwrap()
                        .trim_start_matches("bytes=")
                        .split_once('-')
                        .unwrap();
                    let a = a.parse::<usize>().unwrap();
                    let b = b.parse::<usize>().unwrap();
                    (
                        StatusCode::PARTIAL_CONTENT,
                        [(
                            header::CONTENT_RANGE,
                            format!("bytes {a}-{b}/{}", bytes.len()),
                        )],
                        bytes[a..=b].to_vec(),
                    )
                        .into_response()
                } else {
                    bytes.into_response()
                }
            }
        });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        axum::serve(listener, server).await.unwrap();
    });
    let uri = format!("http://{address}");
    let mut config =
        webknossos_datastore::config::DatastoreConfig::defaults(std::path::Path::new("/srv/wk"));
    config.http.uri = uri.clone();
    let state = webknossos_datastore::AppState::new(config);
    let path = state
        .data_vaults
        .vault_path_for(&UPath::parse(&format!("{uri}/1")).unwrap())
        .await
        .unwrap();
    let array = open_precomputed_array(
        &path,
        DataSourceId::new("ds", "org"),
        "seg",
        Some(AxisOrder::XYZ),
        None,
        None,
        Arc::new(ChunkContentsCache::new(1 << 20)),
        Some("first"),
    )
    .await
    .unwrap();
    array
        .source_chunk_with_cache(&[0, 0, 0], Some("first"))
        .await
        .unwrap();
    array
        .source_chunk_with_cache(&[1, 0, 0], Some("second"))
        .await
        .unwrap();
    let log = reads.lock().unwrap().clone();
    assert_eq!(log.iter().filter(|(p, _)| p == "info").count(), 1);
    assert_eq!(
        log.iter()
            .filter(|(_, t)| t.as_deref() == Some("second"))
            .count(),
        1,
        "{log:?}"
    );
    assert_eq!(log.last().unwrap().0, "1/0.shard");
    task.abort();
}
