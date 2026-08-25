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
class VolumeVersioningBenchmarkService @Inject() (config: TracingStoreConfig) extends LazyLogging {

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

    def randomBucket(): Array[Byte] = {
      val bytes = new Array[Byte](p.bucketBytes)
      random.nextBytes(bytes)
      bytes
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

    // JIT and channel warmup. Without it the first measured block absorbs
    // compilation and connection setup, which made "old" look several times
    // slower than it is simply for running first.
    val warmupPayload = randomBucket()
    val warmupDiff = randomDiff()
    val warmupScratch = randomBucket()
    for (i <- 0 until 50) {
      put(s"$keyPrefix/warmup/[$i,0,0]", 1L, warmupPayload)
      put(s"$keyPrefix/warmupdiff/[$i,0,0]", 1L, warmupDiff)
      stub.get(GetRequest(collection = Collection, key = s"$keyPrefix/warmup/[$i,0,0]", version = Some(1L)))
      stub.getMultipleVersions(
        GetMultipleVersionsRequest(
          collection = Collection,
          key = s"$keyPrefix/warmupdiff/[$i,0,0]",
          oldestVersion = Some(1L),
          newestVersion = Some(1L)
        )
      )
      applyDiff(warmupScratch, warmupDiff, p.bytesPerVoxel)
    }

    val bucketPayloads = Array.fill(p.buckets)(randomBucket())
    val diffPayloads = Array.fill(math.min(p.versions, 64))(randomDiff())
    def diffFor(version: Int): Array[Byte] = diffPayloads(version % diffPayloads.length)

    // ── 1. Ingestion ────────────────────────────────────────────────────────
    var oldBytes = 0L
    val (_, oldWriteMs) = time {
      for (version <- 1 to p.versions; bucket <- 0 until p.buckets) {
        val payload = bucketPayloads(bucket)
        oldBytes += payload.length
        put(oldKey(bucket), version.toLong, payload)
      }
    }

    var newBytes = 0L
    var snapshotCount = 0
    val (_, newWriteMs) = time {
      for (version <- 1 to p.versions; bucket <- 0 until p.buckets) {
        val diff = diffFor(version)
        newBytes += diff.length
        put(diffKey(bucket), version.toLong, diff)
        if (version % p.snapshotInterval == 0) {
          val payload = bucketPayloads(bucket)
          newBytes += payload.length
          snapshotCount += 1
          put(snapshotKey(bucket), version.toLong, payload)
        }
      }
    }
    for (bucket <- 0 until p.buckets) {
      newBytes += bucketPayloads(bucket).length
      put(snapshotKey(bucket), 0L, bucketPayloads(bucket))
    }

    // ── 2. Reads ────────────────────────────────────────────────────────────
    def readOld(version: Int): Unit =
      for (bucket <- 0 until p.buckets) {
        val reply =
          stub.get(GetRequest(collection = Collection, key = oldKey(bucket), version = Some(version.toLong)))
        if (!reply.success) throw new RuntimeException(s"get failed: ${reply.errorMessage}")
      }

    /** Returns (diffs folded, ms spent folding). */
    def readNew(version: Int): (Int, Double) = {
      var foldedDiffs = 0
      var foldMs = 0.0
      for (bucket <- 0 until p.buckets) {
        val snapshot =
          stub.get(GetRequest(collection = Collection, key = snapshotKey(bucket), version = Some(version.toLong)))
        if (!snapshot.success) throw new RuntimeException(s"snapshot get failed: ${snapshot.errorMessage}")
        val base = snapshot.value.toByteArray
        val baseVersion = snapshot.actualVersion
        val diffs =
          if (baseVersion >= version) Nil
          else {
            val reply = stub.getMultipleVersions(
              GetMultipleVersionsRequest(
                collection = Collection,
                key = diffKey(bucket),
                oldestVersion = Some(baseVersion + 1),
                newestVersion = Some(version.toLong)
              )
            )
            if (!reply.success) throw new RuntimeException(s"diff get failed: ${reply.errorMessage}")
            reply.values.map(_.toByteArray).toList
          }
        foldedDiffs += diffs.length
        val (_, ms) = time(diffs.foreach(applyDiff(base, _, p.bytesPerVoxel)))
        foldMs += ms
      }
      (foldedDiffs, foldMs)
    }

    def measureReads(version: Int): JsObject = {
      readOld(version) // discarded warmup round, so neither scheme pays for going first
      readNew(version)
      var oldTotal = 0.0
      var newTotal = 0.0
      var foldTotal = 0.0
      var foldedDiffs = 0
      for (_ <- 0 until p.readRounds) {
        oldTotal += time(readOld(version))._2
        val (result, ms) = time(readNew(version))
        newTotal += ms
        foldedDiffs = result._1
        foldTotal += result._2
      }
      val reads = (p.readRounds * p.buckets).toDouble
      Json.obj(
        "version" -> version,
        "diffsFoldedPerRead" -> foldedDiffs / p.buckets,
        "oldMsPerRead" -> oldTotal / reads,
        "newMsPerRead" -> newTotal / reads,
        "newFoldMsPerRead" -> foldTotal / reads,
        "foldShareOfNewRead" -> (if (newTotal > 0) foldTotal / newTotal else 0.0),
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
        Json.obj(
          "diffsFolded" -> distance,
          "msPerRead" -> total / (p.readRounds * p.buckets).toDouble
        )
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
        "bucketBytes" -> p.bucketBytes,
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
      readRounds: Int
  ) {
    def bucketBytes: Int = VoxelsPerBucket * bytesPerVoxel
    def diffBytes: Int = 8 + 4 + runsPerDiff * 4
    def totalWrites: Long = buckets.toLong * versions

    /** Bytes the old scheme will write. The main safety limit. */
    def oldSchemeBytes: Long = totalWrites * bucketBytes
  }

  object Params {

    /** Caps exist because this writes real data into a shared FossilDB and RocksDB compaction amplifies it
      * several-fold. A 50k-write run produced ~6 GB logical and drove ~15 GB of physical writes during local testing.
      */
    private val MaxTotalBytes: Long = 4L * 1024 * 1024 * 1024

    def fromQuery(
        buckets: Option[Int],
        versions: Option[Int],
        snapshotInterval: Option[Int],
        bytesPerVoxel: Option[Int],
        runsPerDiff: Option[Int],
        runLength: Option[Int],
        readRounds: Option[Int]
    ): Either[String, Params] = {
      val p = Params(
        buckets = buckets.getOrElse(40),
        versions = versions.getOrElse(150),
        snapshotInterval = snapshotInterval.getOrElse(20),
        bytesPerVoxel = bytesPerVoxel.getOrElse(4),
        runsPerDiff = runsPerDiff.getOrElse(300),
        runLength = runLength.getOrElse(12),
        readRounds = readRounds.getOrElse(5)
      )
      if (p.buckets < 1 || p.versions < 1) Left("buckets and versions must be >= 1")
      else if (p.snapshotInterval < 1) Left("snapshotInterval must be >= 1")
      else if (!Set(1, 2, 4, 8).contains(p.bytesPerVoxel)) Left("bytesPerVoxel must be one of 1, 2, 4, 8")
      else if (p.runsPerDiff < 1 || p.runsPerDiff > VoxelsPerBucket) Left(s"runsPerDiff must be 1..$VoxelsPerBucket")
      else if (p.runLength < 1 || p.runLength > BucketWidth) Left(s"runLength must be 1..$BucketWidth")
      else if (p.readRounds < 1 || p.readRounds > 50) Left("readRounds must be 1..50")
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
