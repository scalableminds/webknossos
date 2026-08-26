package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.google.protobuf.ByteString
import com.scalableminds.fossildb.proto.fossildbapi.*
import com.scalableminds.webknossos.tracingstore.TracingStoreConfig
import com.typesafe.scalalogging.LazyLogging
import io.grpc.netty.shaded.io.grpc.netty.NettyChannelBuilder
import play.api.libs.json.{JsObject, Json}

import java.nio.{ByteBuffer, ByteOrder}
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import scala.util.Random

/** SPIKE — compares two ways of versioning volume bucket data in FossilDB:
  *
  * old every version stores the full 32³ bucket. Reads are a single Get, since FossilDB already returns the newest
  * value at-or-below a requested version. new every version stores only an RLE diff, plus a full snapshot every
  * `snapshotInterval` versions. Reads fetch the newest snapshot ≤ X, the diffs in (snapshot, X], and fold them.
  *
  * Not wired into any product code path. It writes into the `volumeData` collection — collections are fixed at FossilDB
  * startup, so a dedicated one is not an option — under a per-run key prefix that is deleted again afterwards.
  *
  * It opens its own gRPC channel rather than reusing FossilDBClient, because it needs DeleteAllByPrefix for cleanup and
  * that is deliberately not part of the shared client's API.
  */
class VolumeVersioningBenchmarkService @Inject() (config: TracingStoreConfig)
    extends LazyLogging
    with VolumeBucketCompression {

  /** Only one run at a time: concurrent runs would contend and skew each other. */
  private val running = new AtomicBoolean(false)

  import VolumeVersioningBenchmarkService.*

  private def time[T](body: => T): (T, Double) = {
    val start = System.nanoTime()
    val result = body
    (result, (System.nanoTime() - start) / 1e6)
  }

  // ── Entry point ───────────────────────────────────────────────────────────

  def run(params: Params): Either[String, JsObject] =
    if (!running.compareAndSet(false, true)) {
      Left("A benchmark run is already in progress on this tracingstore.")
    } else {
      val channel = NettyChannelBuilder
        .forAddress(config.Tracingstore.Fossildb.address, config.Tracingstore.Fossildb.port)
        .maxInboundMessageSize(Int.MaxValue)
        .usePlaintext
        .build
      val keyPrefix = s"$KeyStem${UUID.randomUUID().toString.take(8)}"
      try {
        val stub = FossilDBGrpc.blockingStub(channel)
        logger.info(s"Starting volume versioning benchmark under key prefix $keyPrefix: $params")
        val result = execute(stub, params, keyPrefix)
        Right(result)
      } catch {
        case e: Exception =>
          logger.error("Volume versioning benchmark failed", e)
          Left(s"${e.getClass.getSimpleName}: ${e.getMessage}")
      } finally {
        // Always sweep, including after a failure — this writes into a shared
        // FossilDB and an aborted run would otherwise leave gigabytes behind.
        try cleanUp(FossilDBGrpc.blockingStub(channel))
        catch { case e: Exception => logger.error("Benchmark cleanup failed", e) }
        channel.shutdown()
        running.set(false)
      }
    }

  /** Deletes every key this service has ever written, not just this run's. */
  def cleanUp(stub: FossilDBGrpc.FossilDBBlockingStub): Int = {
    val reply = stub.deleteAllByPrefix(DeleteAllByPrefixRequest(collection = Collection, prefix = KeyStem))
    if (!reply.success) throw new RuntimeException(s"cleanup failed: ${reply.errorMessage}")
    val remaining = stub.getMultipleKeys(
      GetMultipleKeysRequest(collection = Collection, prefix = Some(KeyStem), limit = Some(1))
    )
    remaining.keys.size
  }

  def cleanUpStandalone(): Either[String, Int] = {
    val channel = NettyChannelBuilder
      .forAddress(config.Tracingstore.Fossildb.address, config.Tracingstore.Fossildb.port)
      .maxInboundMessageSize(Int.MaxValue)
      .usePlaintext
      .build
    try Right(cleanUp(FossilDBGrpc.blockingStub(channel)))
    catch { case e: Exception => Left(s"${e.getClass.getSimpleName}: ${e.getMessage}") }
    finally channel.shutdown()
  }

  private def execute(
      stub: FossilDBGrpc.FossilDBBlockingStub,
      p: Params,
      keyPrefix: String
  ): JsObject = {
    val random = new Random(42)

    /** Little-endian write of a segment id at one voxel. */
    def writeVoxel(bucket: Array[Byte], voxel: Int, value: Long): Unit = {
      var b = 0
      while (b < p.bytesPerVoxel) {
        bucket(voxel * p.bytesPerVoxel + b) = ((value >>> (8 * b)) & 0xff).toByte
        b += 1
      }
    }

    /** Realistic segmentation content: one background id across the whole bucket, then K cuboids of random extent and
      * position, each with its own id. This matters because the stored payload is LZ4-compressed, and random bytes —
      * the previous generator — are the pathological case for LZ4.
      */
    def generateBucket(): Array[Byte] = {
      val bucket = new Array[Byte](p.bucketBytes)
      val backgroundId = random.nextInt(1000).toLong + 1L
      var voxel = 0
      while (voxel < VoxelsPerBucket) {
        writeVoxel(bucket, voxel, backgroundId)
        voxel += 1
      }
      for (_ <- 0 until p.cuboidsPerBucket) {
        val id = random.nextInt(100000).toLong + 1L
        val extent = Array.fill(3)(5 + random.nextInt(11)) // 5..15 voxels
        val origin = Array.tabulate(3)(a => random.nextInt(math.max(1, BucketWidth - extent(a))))
        for (z <- origin(2) until math.min(BucketWidth, origin(2) + extent(2))) {
          for (y <- origin(1) until math.min(BucketWidth, origin(1) + extent(1))) {
            for (x <- origin(0) until math.min(BucketWidth, origin(0) + extent(0))) {
              writeVoxel(bucket, x + y * BucketWidth + z * BucketWidth * BucketWidth, id)
            }
          }
        }
      }
      bucket
    }

    def randomDiff(): Array[Byte] = {
      val runs = (0 until p.runsPerDiff).map { _ =>
        val row = random.nextInt(VoxelsPerBucket / BucketWidth)
        val offset = random.nextInt(math.max(1, BucketWidth - p.runLength))
        (row * BucketWidth + offset, p.runLength)
      }
      encodeDiff(runs, random.nextInt(1000).toLong + 1L)
    }

    def oldKey(bucket: Int) = s"$keyPrefix/old/[$bucket,0,0]"
    def snapshotKey(bucket: Int) = s"$keyPrefix/new/snapshot/[$bucket,0,0]"
    def diffKey(bucket: Int) = s"$keyPrefix/new/diff/[$bucket,0,0]"

    def put(key: String, version: Long, value: Array[Byte]): Unit = {
      val reply = stub.put(
        PutRequest(collection = Collection, key = key, version = Some(version), value = ByteString.copyFrom(value))
      )
      if (!reply.success) throw new RuntimeException(s"put failed: ${reply.errorMessage}")
    }

    def get(key: String, version: Long): (Array[Byte], Long) = {
      val reply = stub.get(GetRequest(collection = Collection, key = key, version = Some(version)))
      if (!reply.success) throw new RuntimeException(s"get failed: ${reply.errorMessage}")
      (reply.value.toByteArray, reply.actualVersion)
    }

    def getDiffs(bucket: Int, from: Long, to: Long): List[Array[Byte]] =
      if (from > to) Nil
      else {
        val reply = stub.getMultipleVersions(
          GetMultipleVersionsRequest(
            collection = Collection,
            key = diffKey(bucket),
            oldestVersion = Some(from),
            newestVersion = Some(to)
          )
        )
        if (!reply.success) throw new RuntimeException(s"diff get failed: ${reply.errorMessage}")
        reply.values.map(_.toByteArray).toList
      }

    // Compressing the old scheme's buckets is deliberately outside every timed
    // section: in production that happens in the frontend, which this benchmark
    // does not model. The backend stores those bytes verbatim.
    val bucketPayloads = Array.fill(p.buckets)(generateBucket())
    val bucketsCompressed = bucketPayloads.map(compressVolumeBucket(_, p.bucketBytes))
    val diffPayloads = Array.fill(math.min(p.versions, 64))(randomDiff())
    def diffFor(version: Int): Array[Byte] = diffPayloads(version % diffPayloads.length)

    val compressionRatio =
      bucketPayloads.map(_.length.toDouble).sum / math.max(1.0, bucketsCompressed.map(_.length.toDouble).sum)

    // JIT and channel warmup, so neither scheme pays for going first.
    val warmupScratch = generateBucket()
    val warmupCompressed = compressVolumeBucket(warmupScratch, p.bucketBytes)
    for (i <- 0 until 50) {
      put(s"$keyPrefix/warmup/[$i,0,0]", 1L, warmupCompressed)
      put(s"$keyPrefix/warmupdiff/[$i,0,0]", 1L, diffPayloads(0))
      get(s"$keyPrefix/warmup/[$i,0,0]", 1L)
      decompressIfNeeded(warmupCompressed, p.bucketBytes, "warmup")
      applyDiff(warmupScratch, diffPayloads(0), p.bytesPerVoxel)
    }

    // ── 1. Ingestion ────────────────────────────────────────────────────────
    var oldBytes = 0L
    val (_, oldWriteMs) = time {
      for (version <- 1 to p.versions; bucket <- 0 until p.buckets) {
        val payload = bucketsCompressed(bucket)
        oldBytes += payload.length
        put(oldKey(bucket), version.toLong, payload)
      }
    }

    // Base snapshot at version 0, so every bucket has something to fold onto.
    for (bucket <- 0 until p.buckets) put(snapshotKey(bucket), 0L, bucketsCompressed(bucket))
    var newBytes = bucketsCompressed.map(_.length.toLong).sum

    var snapshotCount = 0
    var materializeMs = 0.0
    val (_, newWriteMs) = time {
      for (version <- 1 to p.versions; bucket <- 0 until p.buckets) {
        val diff = diffFor(version)
        newBytes += diff.length
        put(diffKey(bucket), version.toLong, diff) // raw: diffs are never compressed
        if (version % p.snapshotInterval == 0) {
          // Materializing a snapshot is not free: the server must load the
          // previous snapshot and fold every diff since onto it, then compress.
          val (bytes, ms) = time {
            val (storedBase, baseVersion) = get(snapshotKey(bucket), (version - 1).toLong)
            val base = decompressIfNeeded(storedBase, p.bucketBytes, "materialize")
            getDiffs(bucket, baseVersion + 1, version.toLong).foreach(applyDiff(base, _, p.bytesPerVoxel))
            val compressed = compressVolumeBucket(base, p.bucketBytes)
            put(snapshotKey(bucket), version.toLong, compressed)
            compressed.length.toLong
          }
          materializeMs += ms
          newBytes += bytes
          snapshotCount += 1
        }
      }
    }

    // ── 2. Reads ────────────────────────────────────────────────────────────
    /** Returns ms spent decompressing. */
    def readOld(version: Int): Double = {
      var decompressMs = 0.0
      for (bucket <- 0 until p.buckets) {
        val (stored, _) = get(oldKey(bucket), version.toLong)
        val (_, ms) = time(decompressIfNeeded(stored, p.bucketBytes, "readOld"))
        decompressMs += ms
      }
      decompressMs
    }

    /** Returns (diffs folded, ms folding, ms decompressing the snapshot). */
    def readNew(version: Int): (Int, Double, Double) = {
      var foldedDiffs = 0
      var foldMs = 0.0
      var decompressMs = 0.0
      for (bucket <- 0 until p.buckets) {
        val (storedBase, baseVersion) = get(snapshotKey(bucket), version.toLong)
        // Only snapshots are compressed; diffs are stored raw.
        val (base, dms) = time(decompressIfNeeded(storedBase, p.bucketBytes, "readNew"))
        decompressMs += dms
        val diffs = getDiffs(bucket, baseVersion + 1, version.toLong)
        foldedDiffs += diffs.length
        val (_, fms) = time(diffs.foreach(applyDiff(base, _, p.bytesPerVoxel)))
        foldMs += fms
      }
      (foldedDiffs, foldMs, decompressMs)
    }

    def measureReads(version: Int): JsObject = {
      readOld(version) // discarded warmup round
      readNew(version)
      var oldTotal = 0.0
      var oldDecompress = 0.0
      var newTotal = 0.0
      var foldTotal = 0.0
      var newDecompress = 0.0
      var foldedDiffs = 0
      for (_ <- 0 until p.readRounds) {
        val (dms, oms) = time(readOld(version))
        oldTotal += oms
        oldDecompress += dms
        val (result, nms) = time(readNew(version))
        newTotal += nms
        foldedDiffs = result._1
        foldTotal += result._2
        newDecompress += result._3
      }
      val reads = (p.readRounds * p.buckets).toDouble
      Json.obj(
        "version" -> version,
        "diffsFoldedPerRead" -> foldedDiffs / p.buckets,
        "oldMsPerRead" -> oldTotal / reads,
        "oldDecompressMsPerRead" -> oldDecompress / reads,
        "newMsPerRead" -> newTotal / reads,
        "newFoldMsPerRead" -> foldTotal / reads,
        "newDecompressMsPerRead" -> newDecompress / reads,
        "newOverOld" -> (if (oldTotal > 0) newTotal / oldTotal else 0.0)
      )
    }

    val onSnapshot = p.versions - (p.versions % p.snapshotInterval)
    val bestCase = measureReads(math.max(1, onSnapshot))
    val worstCase = measureReads(math.max(1, onSnapshot - 1))

    // ── 3. Read cost as a function of distance from the snapshot ────────────
    val baseSnapshot = math.max(0, onSnapshot - p.snapshotInterval)
    val curve = (0 until p.snapshotInterval)
      .map(distance => (distance, baseSnapshot + distance))
      .filter { case (_, version) => version >= 1 }
      .map { case (distance, version) =>
        readNew(version)
        var total = 0.0
        for (_ <- 0 until p.readRounds) total += time(readNew(version))._2
        Json.obj("diffsFolded" -> distance, "msPerRead" -> total / (p.readRounds * p.buckets).toDouble)
      }

    Json.obj(
      "params" -> Json.obj(
        "buckets" -> p.buckets,
        "versions" -> p.versions,
        "snapshotInterval" -> p.snapshotInterval,
        "bytesPerVoxel" -> p.bytesPerVoxel,
        "runsPerDiff" -> p.runsPerDiff,
        "runLength" -> p.runLength,
        "readRounds" -> p.readRounds,
        "cuboidsPerBucket" -> p.cuboidsPerBucket,
        "bucketBytes" -> p.bucketBytes,
        "bucketBytesCompressed" -> (bucketsCompressed.map(_.length.toLong).sum / p.buckets),
        "lz4Ratio" -> compressionRatio,
        "diffBytes" -> p.diffBytes,
        "totalWrites" -> p.totalWrites
      ),
      "ingestion" -> Json.obj(
        "oldTotalMs" -> oldWriteMs,
        "oldMsPerWrite" -> oldWriteMs / p.totalWrites,
        "oldBytes" -> oldBytes,
        "newTotalMs" -> newWriteMs,
        "newMsPerWrite" -> newWriteMs / p.totalWrites,
        "newBytes" -> newBytes,
        "newMaterializeMs" -> materializeMs,
        "newMaterializeShare" -> (if (newWriteMs > 0) materializeMs / newWriteMs else 0.0),
        "snapshotsWritten" -> snapshotCount,
        "speedup" -> (if (newWriteMs > 0) oldWriteMs / newWriteMs else 0.0),
        "bytesRatio" -> (if (newBytes > 0) oldBytes.toDouble / newBytes else 0.0)
      ),
      "reads" -> Json.obj("bestCase" -> bestCase, "worstCase" -> worstCase),
      "readCostCurve" -> Json.toJson(curve)
    )
  }
}

/** The pure parts: parameter validation and the diff codec. Kept off the injected class so tests can exercise them
  * without a Play Configuration.
  */
object VolumeVersioningBenchmarkService {

  private[volume] val Collection = "volumeData"

  /** Common stem for every run, so orphans from an interrupted run can be swept. */
  private[volume] val KeyStem = "__perfspike_"

  private[volume] val BucketWidth = 32
  val VoxelsPerBucket = BucketWidth * BucketWidth * BucketWidth

  case class Params(
      buckets: Int,
      versions: Int,
      snapshotInterval: Int,
      bytesPerVoxel: Int,
      runsPerDiff: Int,
      runLength: Int,
      readRounds: Int,
      cuboidsPerBucket: Int
  ) {
    def bucketBytes: Int = VoxelsPerBucket * bytesPerVoxel
    def diffBytes: Int = 8 + 4 + runsPerDiff * 4
    def totalWrites: Long = buckets.toLong * versions

    /** Bytes the old scheme will write. The main safety limit. */
    def oldSchemeBytes: Long = totalWrites * bucketBytes
  }

  object Params {

    /** Caps exist because this writes real data into a shared FossilDB and RocksDB compaction amplifies it
      * several-fold. Computed on the *uncompressed* bucket size, so it is a conservative bound: LZ4 typically shrinks
      * realistic segmentation content by an order of magnitude before it reaches FossilDB.
      */
    private val MaxTotalBytes: Long = 4L * 1024 * 1024 * 1024

    def fromQuery(
        buckets: Option[Int],
        versions: Option[Int],
        snapshotInterval: Option[Int],
        bytesPerVoxel: Option[Int],
        runsPerDiff: Option[Int],
        runLength: Option[Int],
        readRounds: Option[Int],
        cuboidsPerBucket: Option[Int]
    ): Either[String, Params] = {
      val p = Params(
        buckets = buckets.getOrElse(40),
        versions = versions.getOrElse(150),
        snapshotInterval = snapshotInterval.getOrElse(20),
        bytesPerVoxel = bytesPerVoxel.getOrElse(4),
        runsPerDiff = runsPerDiff.getOrElse(300),
        runLength = runLength.getOrElse(12),
        readRounds = readRounds.getOrElse(5),
        cuboidsPerBucket = cuboidsPerBucket.getOrElse(16)
      )
      if (p.buckets < 1 || p.versions < 1) Left("buckets and versions must be >= 1")
      else if (p.snapshotInterval < 1) Left("snapshotInterval must be >= 1")
      else if (!Set(1, 2, 4, 8).contains(p.bytesPerVoxel)) Left("bytesPerVoxel must be one of 1, 2, 4, 8")
      else if (p.runsPerDiff < 1 || p.runsPerDiff > VoxelsPerBucket) Left(s"runsPerDiff must be 1..$VoxelsPerBucket")
      else if (p.runLength < 1 || p.runLength > BucketWidth) Left(s"runLength must be 1..$BucketWidth")
      else if (p.readRounds < 1 || p.readRounds > 50) Left("readRounds must be 1..50")
      else if (p.cuboidsPerBucket < 0 || p.cuboidsPerBucket > 1000) Left("cuboidsPerBucket must be 0..1000")
      else if (p.oldSchemeBytes > MaxTotalBytes)
        Left(
          f"refusing to write ${p.oldSchemeBytes / 1024 / 1024}%,d MiB (cap ${MaxTotalBytes / 1024 / 1024}%,d MiB). " +
            "Reduce buckets, versions or bytesPerVoxel."
        )
      else Right(p)
    }
  }

  // ── Payload helpers ───────────────────────────────────────────────────────

  /** Public for the codec tests in test/backend. */
  def encodeDiff(runs: Seq[(Int, Int)], value: Long): Array[Byte] = {
    val buffer = ByteBuffer.allocate(8 + 4 + runs.length * 4).order(ByteOrder.LITTLE_ENDIAN)
    buffer.putLong(value)
    buffer.putInt(runs.length)
    runs.foreach { case (start, length) =>
      buffer.putShort(start.toShort)
      buffer.putShort(length.toShort)
    }
    buffer.array()
  }

  /** Fold one encoded diff into a dense bucket, as a read would. */
  def applyDiff(bucket: Array[Byte], diff: Array[Byte], bytesPerVoxel: Int): Unit = {
    val buffer = ByteBuffer.wrap(diff).order(ByteOrder.LITTLE_ENDIAN)
    val value = buffer.getLong
    val runCount = buffer.getInt
    val valueBytes = new Array[Byte](bytesPerVoxel)
    var b = 0
    while (b < bytesPerVoxel) {
      valueBytes(b) = ((value >>> (8 * b)) & 0xff).toByte
      b += 1
    }
    var i = 0
    while (i < runCount) {
      val start = buffer.getShort & 0xffff
      val length = buffer.getShort & 0xffff
      var voxel = start
      val end = math.min(start + length, VoxelsPerBucket)
      while (voxel < end) {
        System.arraycopy(valueBytes, 0, bucket, voxel * bytesPerVoxel, bytesPerVoxel)
        voxel += 1
      }
      i += 1
    }
  }
}
