# DS2-codecs checkpoint (agent ds2-codecs, target /tmp/webknossos-rust-ds-verify)

Status: DONE (2026-10-11). Decompression + compression for Null, LZ4 (raw block), Zlib, Gzip, Blosc, Zstd, Chained, plus WKW LZ4 block helpers. JPEG / compresso / compressed_segmentation not included (see Open).

## Scala truth (findings)
- datareaders/Compressor.scala: Null; Lz4 (commons-compress BlockLZ4 = raw LZ4 block, no size header, decoded to EOF); Zlib (level default 1, 0..9); Gzip (level default 1, -1 or 0..9); Blosc (blosc-java 0.3-1.21.6 = JNI c-blosc 1.21.6; cname default lz4, clevel 5, shuffle byte, blocksize 0, typesize 1, numthreads 1); Zstd (commons-compress over zstd-jni; level, checksum); Jpeg (decode only, ImageIO raster bytes); Compresso (JNI); CompressedSegmentation; Chained (compress foldLeft, decompress foldRight).
- Factories: zarr v2 (`id`; null|zlib|blosc|gzip|zstd, zstd needs Int level, checksum=false), N5 (`type`; raw|null|zlib|gzip(+useZlib)|blosc|zstd; N5 lz4/xz NOT supported in Scala), zarr3 codecs (blosc shuffle strings exact-case noshuffle|shuffle|bitshuffle -> int, typesize None -> 0; gzip(level); zstd(level, checksum)), precomputed (sharding data_encoding raw|gzip(level 1); chunk encoding raw|jpeg|compresso|compressed_segmentation).
- blosc-java: Compressor enum lz4, lz4hc, blosclz, zstd, zlib (no snappy); Shuffle/Compressor `fromString` are case-insensitive (equalsIgnoreCase).
- WKW: read path uses Lz4Compressor (raw block to EOF); WKWFile uses lz4-java fastDecompressor(numBytesPerChunk) and requires the whole input consumed ("Decompressed unexpected number of bytes [expected: <compressed len>, actual: <consumed>]"). Writer: lz4-java fast (LZ4) or high (LZ4HC) block compressor.
- Gzip header written by modern Java: 1f8b 0800 00000000 00 ff.

## Decisions
- Blosc: own pure-Rust Blosc1 (container format v2) codec: src/compression/blosc.rs + blosclz.rs (BloscLZ decoder mirrors c-blosc 1.21 bounds checks; own greedy encoder). Rejected: blusc 0.0.6 (pre-alpha c-blosc2 port, needs rustc 1.91), blosc2-pure-rs 0.2.4 / omnizip-blosc (Blosc2-focused, young), blosc/blosc-src (C via cc; not needed). Inner codecs: LZ4 own bounded decoder + lz4_flex encoder; zlib flate2 (miniz_oxide); zstd ruzstd. Snappy blocks -> error (blosc-java has no snappy).
- Encoder mirrors c-blosc 1.21 compute_blocksize/split_block (FORWARD_COMPAT), memcpyed for clevel 0 / < 128 bytes / incompressible; header flags identical to c-blosc for the generated vectors.
- Deps added to datastore/Cargo.toml: lz4_flex 0.14 (default-features=false, std+safe-encode+safe-decode), ruzstd 0.9 (+twox-hash). cargo fetch done; --locked --offline builds work.
- Limits: decompress(input, expected_len) bounds output by expected_len, else DEFAULT_MAX_DECOMPRESSED_BYTES (1 GiB); buffers grow incrementally; Blosc header nbytes checked against the limit before allocation; Chained intermediate steps use the default limit.

## API (webknossos_datastore::compression)
- CompressionSetting {String, Int(i32), Bool} (+serde, from_json = Play reads order), CompressionSettings = BTreeMap.
- Compressor {Null, Lz4, Zlib{level}, Gzip{level}, Blosc(BloscConfig), Zstd{level, checksum}, Chained(Vec)}; constructors zlib/gzip/blosc(&settings), zstd(level, checksum), from_zarr_settings/from_zarr_id, from_n5_settings/from_n5_type, from_zarr3_blosc/gzip/zstd, from_precomputed_sharding_encoding; id(), Display = Scala toString; decompress(&[u8], Option<usize>), decompress_with_limit, compress.
- BloscConfig/BloscCname/BloscShuffle; wkw_decompress_block(compressed, num_bytes_per_chunk), wkw_compress_block(raw).
- Error messages mirror Scala exceptions (IllegalArgumentException texts, `key not found: id`, `For input string: "x"`, MatchError text for zarr3 shuffle, "Invalid compression level: 0" for boolean levels).

## Deviations
- Compression output is valid for the Java readers but not byte-identical: zstd uses ruzstd "Fastest" for every level and always writes a content checksum; LZ4HC (WKW, blosc lz4hc) uses the normal LZ4 encoder; BloscLZ uses an own encoder; gzip xfl byte differs.
- zarr3 blosc invalid shuffle fails at construction (Scala: lazily at first encode/decode).
- Blosc typesize <= 0 or > 255 is treated as 1 when compressing (zarr3 omitted typesize gives 0 in Scala).
- Decompressed output larger than the bound is an error (Scala unbounded).

## Evidence
- Oracle programs in /tmp/wk-ds2-java (Gen.java, Gen2.java, Check.java, Check2.java; classpath cp.txt) using the Coursier-cached jars blosc-java 0.3-1.21.6, commons-compress 1.28.0, lz4-java 1.11.2, zstd-jni 1.5.7-15. Test generator /tmp/wk-ds2-gen/make_test.py + template.rs.
- 36 c-blosc vectors (all 5 codecs x noshuffle/shuffle/bitshuffle, splits, multi-block + leftover, bitshuffle leftovers, memcpyed, empty, typesize 1/2/3/4/8/16) decode byte-exact; plus commons LZ4, lz4-java fast/HC (WKW), zstd-jni with checksum, java gzip/zlib.
- Reverse oracle: 360 Rust-produced Blosc buffers (5 codecs x 3 shuffles x 6 typesizes x 4 inputs) decode correctly with blosc-java; Rust LZ4/zlib/gzip/zstd outputs decode with commons-compress/java.util.zip (`WK_DS2_ORACLE_DIR=... cargo test --test compression -- --ignored`, then java Check/Check2).
- cargo test: lib compression units 6/6, tests/compression.rs 9 passed + 1 ignored (manual oracle writer). clippy --all-targets -D warnings clean (whole package at time of run). rustfmt --edition 2024 --check clean on compression files.

## Open / next
- JPEG (precomputed `jpeg`, DS2d): Java ImageIO returns TYPE_BYTE_GRAY bytes for 1 channel and TYPE_3BYTE_BGR (BGR order!) for 3 channels; needs a pure-Rust decoder (zune-jpeg) and parity check.
- compressed_segmentation (DS2d), compresso (DS5b).
- Perf (DS6): bit-unshuffle is a scalar per-bit loop; Blosc splits decode into temporary Vecs.
