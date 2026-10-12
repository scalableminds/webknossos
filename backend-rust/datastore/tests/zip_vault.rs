use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use std::{collections::HashMap, path::PathBuf, sync::Arc};
use webknossos_datastore::datavault::{
    ByteRange, DataVault, Encoding, FileSystemDataVault, UPath, VaultError, VaultPath, ZipDataVault,
};
fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/zip")
}
#[tokio::test]
async fn stored_zip_zip64_listing_order_ranges_sizes_and_errors_match_compiled_scala_vault() {
    let cases: Value =
        serde_json::from_slice(&std::fs::read(fixtures().join("scala_zip_vault.json")).unwrap())
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
        let result:Result<Value,VaultError>=match case["operation"].as_str().unwrap() {
            "list" => vault.list_directory(&path,case["max"].as_u64().unwrap()as usize,None).await.map(|paths|json!({"names":paths.into_iter().map(|p|match p { UPath::ZipEntry(_,name)=>name,_=>unreachable!() }).collect::<Vec<_>>()})),
            "size" => vault.used_storage_bytes(&path,None).await.map(|size|json!({"size":size})),
            "read" => {
                let range=match case["range"].as_str().unwrap() { "complete"=>ByteRange::Complete,"start3end17"=>ByteRange::StartEnd{start:3,end:17},"suffix2"=>ByteRange::suffix(2),"suffix100"=>ByteRange::suffix(100),"start40end50"=>ByteRange::StartEnd{start:40,end:50},"start5end2"=>ByteRange::StartEnd{start:5,end:2},"start0end0"=>ByteRange::StartEnd{start:0,end:0},_=>unreachable!() };
                vault.read_bytes_encoding_and_range_header(&path,range,None).await.map(|raw| { assert_eq!(raw.encoding,Encoding::Identity);json!({"bytes":STANDARD.encode(raw.bytes),"encoding":"identity","contentRange":raw.content_range}) })
            }
            _=>unreachable!(),
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
            let mut names: Vec<String> = serde_json::from_value(actual["names"].clone()).unwrap();
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
    let path = std::env::temp_dir().join(format!("wk-zip-sparse-{}-{}.zip", std::process::id(), COUNT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
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
