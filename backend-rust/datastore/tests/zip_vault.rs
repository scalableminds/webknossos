//! Real Python-written ZIP archives through the public vault API and actual HTTP ranges.
use axum::{
    Router,
    http::{HeaderMap, Method, StatusCode},
    response::IntoResponse,
};
use std::sync::{Arc, Mutex};
use webknossos_datastore::datavault::{
    ByteRange, Encoding, FileSystemDataVault, HttpsDataVault, UPath, VaultError, VaultPath,
    ZipDataVault,
};

const STORED: &[u8] = include_bytes!("fixtures/zip/stored.zip");
const ZIP64: &[u8] = include_bytes!("fixtures/zip/zip64.zip");
fn entry(outer: UPath, vault: Arc<ZipDataVault>, name: &str) -> VaultPath {
    VaultPath::new(UPath::ZipEntry(Box::new(outer), name.into()), vault)
}
fn local(name: &str) -> (UPath, Arc<ZipDataVault>) {
    let path = UPath::from_local_path(
        &std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/zip")
            .join(name),
    );
    let vault = Arc::new(ZipDataVault::new(VaultPath::new(
        path.clone(),
        Arc::new(FileSystemDataVault),
    )));
    (path, vault)
}
fn message(error: VaultError) -> String {
    match error {
        VaultError::Failure(e) => e.to_string(),
        VaultError::NotFound => panic!("expected failure"),
    }
}
#[tokio::test]
async fn real_archives_stored_ranges_listing_and_storage() {
    for file in ["stored.zip", "zip64.zip"] {
        let (outer, vault) = local(file);
        let path = entry(outer.clone(), Arc::clone(&vault), "/root.txt/");
        for (range, expected, header) in [
            (ByteRange::Complete, &b"0123456789"[..], "bytes 0-9/10"),
            (
                ByteRange::StartEnd { start: 2, end: 6 },
                &b"2345"[..],
                "bytes 2-5/10",
            ),
            (ByteRange::Suffix { length: 3 }, &b"789"[..], "bytes 7-9/10"),
            (
                ByteRange::Suffix { length: 99 },
                &b"0123456789"[..],
                "bytes 0-9/10",
            ),
            (
                ByteRange::StartEnd { start: 8, end: 99 },
                &b"89"[..],
                "bytes 8-9/10",
            ),
        ] {
            let read = path
                .read_bytes_encoding_and_range_header(range, None)
                .await
                .unwrap();
            assert_eq!(read.bytes.as_ref(), expected);
            assert_eq!(read.encoding, Encoding::Identity);
            assert_eq!(read.content_range.as_deref(), Some(header));
        }
        let directory = entry(outer.clone(), Arc::clone(&vault), "folder/");
        let mut children: Vec<_> = directory
            .list_directory(99, None)
            .await
            .unwrap()
            .into_iter()
            .map(|p| p.basename())
            .collect();
        children.sort();
        assert_eq!(children, ["a.bin", "deep"]);
        assert!(directory.list_directory(0, None).await.unwrap().is_empty());
        assert_eq!(directory.list_directory(1, None).await.unwrap().len(), 1);
        assert_eq!(directory.used_storage_bytes(None).await.unwrap(), 9);
        assert_eq!(
            entry(outer.clone(), Arc::clone(&vault), "unicode/ä.txt")
                .read_bytes(ByteRange::Complete, None)
                .await
                .unwrap()
                .as_ref(),
            b"utf8"
        );
        assert_eq!(
            entry(outer.clone(), Arc::clone(&vault), "missing")
                .read_bytes(ByteRange::Complete, None)
                .await
                .unwrap_err(),
            VaultError::NotFound
        );
        assert!(
            message(
                entry(outer.clone(), Arc::clone(&vault), "compressed.txt")
                    .read_bytes(ByteRange::Complete, None)
                    .await
                    .unwrap_err()
            )
            .contains("compression method 8")
        );
        assert!(
            message(
                path.read_bytes(ByteRange::StartEnd { start: 9, end: 2 }, None)
                    .await
                    .unwrap_err()
            )
            .contains("end is before start")
        );
    }
}

#[derive(Clone, Debug)]
struct Request {
    method: Method,
    range: Option<String>,
    token: Option<String>,
}
async fn remote(
    data: Vec<u8>,
    fail_first: bool,
) -> (UPath, Arc<ZipDataVault>, Arc<Mutex<Vec<Request>>>) {
    let requests = Arc::new(Mutex::new(Vec::new()));
    let recorded = Arc::clone(&requests);
    let app = Router::new().fallback(move |method: Method, headers: HeaderMap| {
        let data = data.clone();
        let recorded = Arc::clone(&recorded);
        async move {
            let req = Request {
                method: method.clone(),
                range: headers.get("range").map(|v| v.to_str().unwrap().into()),
                token: headers
                    .get("x-auth-token")
                    .map(|v| v.to_str().unwrap().into()),
            };
            let mut requests = recorded.lock().unwrap();
            let fail = fail_first
                && requests.iter().all(|r: &Request| r.method != Method::GET)
                && method == Method::GET;
            requests.push(req.clone());
            drop(requests);
            if fail || req.token.as_deref() == Some("reject") {
                return (StatusCode::FORBIDDEN, Vec::new()).into_response();
            }
            if method == Method::HEAD {
                return (
                    StatusCode::OK,
                    [
                        ("accept-ranges", "bytes".to_string()),
                        ("content-length", data.len().to_string()),
                    ],
                    Vec::new(),
                )
                    .into_response();
            }
            let range = req.range.unwrap();
            let range = range.strip_prefix("bytes=").unwrap();
            let (start, end) = range.split_once('-').unwrap();
            let (start, end) = if start.is_empty() {
                (
                    data.len().saturating_sub(end.parse::<usize>().unwrap()),
                    data.len(),
                )
            } else {
                (start.parse().unwrap(), end.parse::<usize>().unwrap() + 1)
            };
            let end = end.min(data.len());
            (
                StatusCode::PARTIAL_CONTENT,
                [(
                    "content-range",
                    format!(
                        "bytes {start}-{}/{length}",
                        end.saturating_sub(1),
                        length = data.len()
                    ),
                )],
                data[start..end].to_vec(),
            )
                .into_response()
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let outer = UPath::parse(&format!("{base}/archive.zip")).unwrap();
    let http = Arc::new(HttpsDataVault::new(None, reqwest::Client::new(), &base));
    let vault = Arc::new(ZipDataVault::new(VaultPath::new(outer.clone(), http)));
    (outer, vault, requests)
}
#[tokio::test]
async fn http_bounded_reads_cache_and_current_token() {
    let (outer, vault, requests) = remote(STORED.to_vec(), false).await;
    let path = entry(outer, vault, "root.txt");
    assert_eq!(
        path.read_bytes(ByteRange::Suffix { length: 2 }, Some("first"))
            .await
            .unwrap()
            .as_ref(),
        b"89"
    );
    let first = requests.lock().unwrap().clone();
    assert_eq!(first.len(), 5);
    assert_eq!(first[0].method, Method::HEAD);
    assert_eq!(first[0].token, None);
    assert!(first[1].range.as_deref().unwrap().starts_with("bytes="));
    assert!(
        first[1..]
            .iter()
            .all(|r| r.token.as_deref() == Some("first"))
    );
    path.read_bytes(ByteRange::Complete, Some("second"))
        .await
        .unwrap();
    let all = requests.lock().unwrap();
    assert_eq!(all.len(), 7);
    assert!(
        all[5..]
            .iter()
            .all(|r| r.token.as_deref() == Some("second"))
    );
    assert_eq!(all[5].range.as_deref(), Some("bytes=0-29"));
    assert_eq!(all[6].range.as_deref(), Some("bytes=38-47"));
}
#[tokio::test]
async fn warm_directory_cache_does_not_bypass_outer_read_denial() {
    let (outer, vault, requests) = remote(STORED.to_vec(), false).await;
    let path = entry(outer, vault, "root.txt");
    path.read_bytes(ByteRange::Complete, Some("allowed"))
        .await
        .unwrap();
    let before = requests.lock().unwrap().len();
    assert!(
        path.read_bytes(ByteRange::Complete, Some("reject"))
            .await
            .is_err()
    );
    let all = requests.lock().unwrap();
    assert_eq!(all.len(), before + 1);
    assert_eq!(all.last().unwrap().token.as_deref(), Some("reject"));
}

#[tokio::test]
async fn failed_directory_load_is_retried() {
    let (outer, vault, requests) = remote(STORED.to_vec(), true).await;
    let path = entry(outer, vault, "root.txt");
    assert!(
        path.read_bytes(ByteRange::Complete, Some("denied"))
            .await
            .is_err()
    );
    assert_eq!(
        path.read_bytes(ByteRange::Complete, Some("allowed"))
            .await
            .unwrap()
            .as_ref(),
        b"0123456789"
    );
    assert!(
        requests
            .lock()
            .unwrap()
            .iter()
            .any(|r| r.token.as_deref() == Some("allowed"))
    );
}
#[tokio::test]
async fn malformed_archives_fail_without_panics() {
    let mut bad_signature = STORED.to_vec();
    let cd = bad_signature
        .windows(4)
        .position(|w| w == b"PK\x01\x02")
        .unwrap();
    bad_signature[cd] = 0;
    let mut missing_locator = ZIP64.to_vec();
    let locator = missing_locator
        .windows(4)
        .position(|w| w == b"PK\x06\x07")
        .unwrap();
    missing_locator[locator] = 0;
    let mut short_extra = ZIP64.to_vec();
    let cd64 = short_extra
        .windows(4)
        .position(|w| w == b"PK\x01\x02")
        .unwrap();
    let n = u16::from_le_bytes(short_extra[cd64 + 28..cd64 + 30].try_into().unwrap()) as usize;
    short_extra[cd64 + 46 + n + 2..cd64 + 46 + n + 4].copy_from_slice(&8u16.to_le_bytes());
    for (data, expected) in [
        (vec![0; 40], "Could not find"),
        (bad_signature, "central directory entry signature"),
        (missing_locator, "locator signature"),
        (short_extra, "missing compressedSize"),
    ] {
        let (outer, vault, _) = remote(data, false).await;
        assert!(
            message(
                entry(outer, vault, "root.txt")
                    .read_bytes(ByteRange::Complete, None)
                    .await
                    .unwrap_err()
            )
            .contains(expected)
        );
    }
}

mod scala_oracle {
    use base64::{Engine, engine::general_purpose::STANDARD};
    use serde_json::{Value, json};
    use std::{collections::HashMap, path::PathBuf, sync::Arc};
    use webknossos_datastore::datavault::{
        ByteRange, DataVault, Encoding, FileSystemDataVault, UPath, VaultError, VaultPath,
        ZipDataVault,
    };
    fn fixtures() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/zip")
    }
    #[tokio::test]
    async fn stored_zip_zip64_listing_order_ranges_sizes_and_errors_match_compiled_scala_vault() {
        let cases: Value = serde_json::from_slice(
            &std::fs::read(fixtures().join("scala_zip_vault.json")).unwrap(),
        )
        .unwrap();
        let sparse = sparse_fixture();
        let mut vaults: HashMap<String, Arc<ZipDataVault>> = HashMap::new();
        for case in cases.as_array().unwrap() {
            let archive = case["archive"].as_str().unwrap();
            let vault = vaults.entry(archive.into()).or_insert_with(|| {
                Arc::new(ZipDataVault::new(VaultPath::new(
                    UPath::from_local_path(&if archive == "sparse.zip" {
                        sparse.clone()
                    } else {
                        fixtures().join(archive)
                    }),
                    Arc::new(FileSystemDataVault),
                )))
            });
            let path = UPath::ZipEntry(
                Box::new(UPath::from_local_path(&if archive == "sparse.zip" {
                    sparse.clone()
                } else {
                    fixtures().join(archive)
                })),
                case["inner"].as_str().unwrap().into(),
            );
            let result: Result<Value, VaultError> = match case["operation"].as_str().unwrap() {
                "list" => {
                    let max = case["max"].as_u64().unwrap() as usize;
                    vault.list_directory(&path, max, None).await.map(|paths| {
                        let names = paths
                            .into_iter()
                            .map(|p| match p {
                                UPath::ZipEntry(_, name) => name,
                                _ => unreachable!(),
                            })
                            .collect::<Vec<_>>();
                        json!({"names": names})
                    })
                }
                "size" => vault
                    .used_storage_bytes(&path, None)
                    .await
                    .map(|size| json!({"size": size})),
                "read" => {
                    let range = match case["range"].as_str().unwrap() {
                        "complete" => ByteRange::Complete,
                        "start3end17" => ByteRange::StartEnd { start: 3, end: 17 },
                        "suffix2" => ByteRange::suffix(2),
                        "suffix100" => ByteRange::suffix(100),
                        "start40end50" => ByteRange::StartEnd { start: 40, end: 50 },
                        "start5end2" => ByteRange::StartEnd { start: 5, end: 2 },
                        "start0end0" => ByteRange::StartEnd { start: 0, end: 0 },
                        _ => unreachable!(),
                    };
                    vault
                        .read_bytes_encoding_and_range_header(&path, range, None)
                        .await
                        .map(|raw| {
                            assert_eq!(raw.encoding, Encoding::Identity);
                            json!({
                                "bytes":STANDARD.encode(raw.bytes),
                                "encoding":"identity",
                                "contentRange":raw.content_range
                            })
                        })
                }
                _ => unreachable!(),
            };
            if case["expected"].get("exception").is_some() {
                assert!(result.is_err(), "{case}");
                continue;
            }
            let actual = match result {
                Ok(value) => value,
                Err(VaultError::NotFound) => json!({"missing":true}),
                Err(VaultError::Failure(error)) => json!({"error":error.message}),
            };
            if case["operation"] == "list" && actual.get("names").is_some() {
                // Scala's final Set.map(VaultPath) uses a JVM identity hash. Compare the exact
                // selected child set, including the listing limit, rather than that unstable order.
                let mut names: Vec<String> =
                    serde_json::from_value(actual["names"].clone()).unwrap();
                let mut expected: Vec<String> =
                    serde_json::from_value(case["expected"]["names"].clone()).unwrap();
                names.sort();
                expected.sort();
                assert_eq!(names, expected, "{case}");
            } else {
                assert_eq!(actual, case["expected"], "{case}");
            }
        }
    }

    fn sparse_fixture() -> PathBuf {
        use std::io::{Seek, Write};
        let layout: Value =
            serde_json::from_str(include_str!("fixtures/zip/sparse_layout.json")).unwrap();
        static COUNT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "wk-zip-sparse-{}-{}.zip",
            std::process::id(),
            COUNT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let mut file = std::fs::File::create(&path).unwrap();
        let decode = |key: &str| {
            let text = layout[key].as_str().unwrap();
            (0..text.len())
                .step_by(2)
                .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
                .collect::<Vec<_>>()
        };
        file.seek(std::io::SeekFrom::Start(layout["offset"].as_u64().unwrap()))
            .unwrap();
        file.write_all(&decode("local")).unwrap();
        file.write_all(b"zip64-content").unwrap();
        file.seek(std::io::SeekFrom::Start(
            layout["dataStart"].as_u64().unwrap() + layout["size"].as_u64().unwrap(),
        ))
        .unwrap();
        file.write_all(&decode("trailer")).unwrap();
        path
    }

    #[tokio::test]
    async fn metadata_failures_retry_and_malformed_counts_offsets_and_read_limits_fail_without_panics()
     {
        static COUNT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!(
            "wk-zip-invalid-{}-{}",
            std::process::id(),
            COUNT.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&root).unwrap();
        let file = root.join("archive.zip");
        std::fs::write(&file, b"invalid").unwrap();
        let path = UPath::ZipEntry(Box::new(UPath::from_local_path(&file)), "a.bin".into());
        let vault = ZipDataVault::new(VaultPath::new(
            UPath::from_local_path(&file),
            Arc::new(FileSystemDataVault),
        ));
        assert!(
            vault
                .read_bytes_encoding_and_range_header(&path, ByteRange::Complete, None)
                .await
                .is_err()
        );
        std::fs::copy(fixtures().join("basic.zip"), &file).unwrap();
        assert_eq!(
            vault
                .read_bytes_encoding_and_range_header(&path, ByteRange::Complete, None)
                .await
                .unwrap()
                .bytes
                .to_vec(),
            (0..32u8).collect::<Vec<_>>()
        );
        let mut variants = Vec::new();
        for length in [0, 1, 21, 22, 35] {
            variants.push(vec![0; length]);
        }
        let bytes = std::fs::read(fixtures().join("basic.zip")).unwrap();
        let eocd = bytes
            .windows(4)
            .rposition(|p| p == [0x50, 0x4b, 0x05, 0x06])
            .unwrap();
        let cd = u32::from_le_bytes(bytes[eocd + 16..eocd + 20].try_into().unwrap()) as usize;
        let mut huge = bytes.clone();
        huge[eocd + 12..eocd + 16].copy_from_slice(&(129u32 * 1024 * 1024).to_le_bytes());
        variants.push(huge);
        let mut bad_name = bytes.clone();
        bad_name[cd + 28..cd + 30].copy_from_slice(&u16::MAX.to_le_bytes());
        variants.push(bad_name);
        let mut bad_extra = bytes.clone();
        bad_extra[cd + 30..cd + 32].copy_from_slice(&u16::MAX.to_le_bytes());
        variants.push(bad_extra);
        let mut bad_signature = bytes.clone();
        bad_signature[cd..cd + 4].fill(0);
        variants.push(bad_signature);
        let mut negative = std::fs::read(fixtures().join("central_zip64.zip")).unwrap();
        let locator = negative
            .windows(4)
            .rposition(|p| p == [0x50, 0x4b, 0x06, 0x07])
            .unwrap();
        negative[locator + 8..locator + 16].copy_from_slice(&u64::MAX.to_le_bytes());
        variants.push(negative);
        for bytes in variants {
            std::fs::write(&file, bytes).unwrap();
            let vault = ZipDataVault::new(VaultPath::new(
                UPath::from_local_path(&file),
                Arc::new(FileSystemDataVault),
            ));
            assert!(vault.list_directory(&path, 10, None).await.is_err());
        }
        let sparse = sparse_fixture();
        let vault = ZipDataVault::new(VaultPath::new(
            UPath::from_local_path(&sparse),
            Arc::new(FileSystemDataVault),
        ));
        let path = UPath::ZipEntry(Box::new(UPath::from_local_path(&sparse)), "a.bin".into());
        assert!(
            vault
                .read_bytes_encoding_and_range_header(&path, ByteRange::Complete, None)
                .await
                .unwrap_err()
                .to_string()
                .contains("300 MiB")
        );
    }
}
