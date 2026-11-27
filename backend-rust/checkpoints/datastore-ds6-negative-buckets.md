# DS6 non-overlap buckets investigation

## Status
IN PROGRESS: read-only actual HTTP and compiled Scala probe; no Rust changes before precise cause/design.

## Done
- Actual Scala19491/Rust19494 Zarr2 fully nonoverlapping aligned buckets[-32,0,0], [0,-32,0], [0,0,-32], [64,0,0], [96,0,0]: Scala200/0bytes/failure[0]; Rust200/32768bytes/failure[]. Partial[-1,-1,-1] both200/32768bytes/no failure.
- Repo Scala ChunkUtils and Rust both clamp chunk indices, and source plus javap MultiArrayUtils.copyRange both explicitly no-op zero-overlap dimensions.
- Direct Java probe against EXACT Scala CP `/tmp/wk-ds6-scala-20261012/classpath.txt` calls actual compiled ZarrArray.open/readBytesWithAdditionalCoordinates for same data. All fully outside selections return Full32768bytes, matching Rust DatasetArray; this disproves a Zarr2 reader-level negative rejection policy.

## Next
- Pin BinaryDataService conversion/error logging cause or loaded-bytecode freshness before implementation design.
- Parent owns central changes/checks. No blanket negative coordinate rejection; precomputed negative origins and non-bucket clipping remain valid.

## Evidence
- `/tmp/ProbeNegativeArray.java` and compiled direct probe class; immutable fixture path source.
- `/tmp/wk-ds6-multiarray-javap.txt`, `/tmp/wk-ds6-binary-javap.txt` prove current compiled copy/no-overlap policy.
