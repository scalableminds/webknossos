package backend

import com.google.protobuf.ByteString
import com.scalableminds.fossildb.proto.fossildbapi.*
import io.grpc.netty.shaded.io.grpc.netty.NettyChannelBuilder
import org.scalatest.wordspec.AnyWordSpec

import java.nio.{ByteBuffer, ByteOrder}
import java.util.UUID
import scala.util.{Random, Try}

/**
 * SPIKE — performance comparison of two ways to version volume bucket data in
 * FossilDB. Not a correctness suite; it prints timings.
 *
 *   old  every version stores the full 32³ bucket. Reads are a single Get,
 *        because FossilDB already returns the newest value at-or-below a
 *        requested version.
 *   new  every version stores only an RLE diff, plus a full snapshot every
 *        `SnapshotInterval` versions. Reads fetch the newest snapshot ≤ X, then
 *        the diffs in (snapshot, X], then fold them.
 *
 * Requires a running FossilDB (`yarn start-fossildb`); the suite cancels itself
 * if none is reachable. It writes into the existing `volumeData` collection —
 * collections are fixed at FossilDB startup, so a dedicated one is not an
 * option — under a per-run key prefix that is deleted again at the end.
 *
 * Run with:
 *   sbt --client "testOnly backend.VolumeVersioningPerformanceSuite"
 * Scale it with env vars, e.g.
 *   PERF_BUCKETS=50 PERF_VERSIONS=200 sbt --client "testOnly backend.VolumeVersioningPerformanceSuite"
 */
class VolumeVersioningPerformanceSuite extends AnyWordSpec {

  // ── Parameters ────────────────────────────────────────────────────────────

  /**
   * Overrides come from an optional properties file, because `sbt --client`
   * hands the command to an already-running sbt server whose environment the
   * caller cannot influence, and tests are not forked — so neither env vars nor
   * -D flags from the client reach this code.
   *
   * Write `test/backend/perfspike.properties` (keys without the PERF_ prefix,
   * e.g. `buckets=100`) before running. Env vars still work when the suite is
   * run from a fresh sbt.
   */
  private lazy val fileOverrides: java.util.Properties = {
    val props = new java.util.Properties()
    val file = new java.io.File("test/backend/perfspike.properties")
    if (file.exists()) {
      val in = new java.io.FileInputStream(file)
      try props.load(in)
      finally in.close()
    }
    props
  }

  private def envInt(name: String, default: Int): Int = {
    val key = name.stripPrefix("PERF_").toLowerCase
    Option(System.getProperty(name))
      .orElse(sys.env.get(name))
      .orElse(Option(fileOverrides.getProperty(key)))
      .flatMap(s => Try(s.trim.toInt).toOption)
      .getOrElse(default)
  }

  /** Distinct buckets, each with its own version history. */
  private val BucketCount = envInt("PERF_BUCKETS", 20)

  /** Versions per bucket, i.e. how many edits touched it. */
  private val VersionCount = envInt("PERF_VERSIONS", 100)

  /** A full snapshot is written every this many versions in the new scheme. */
  private val SnapshotInterval = envInt("PERF_SNAPSHOT_INTERVAL", 10)

  /** Bytes per voxel. uint32 is the common case for segmentation layers. */
  private val BytesPerVoxel = envInt("PERF_BYTES_PER_VOXEL", 4)

  /**
   * Runs per bucket diff, and their length. Modelled on a brush stroke clipping
   * a bucket: the measured spike (design doc §5.4) averages a few hundred runs
   * per finest-mag bucket, most of them short.
   */
  private val RunsPerDiff = envInt("PERF_RUNS_PER_DIFF", 300)
  private val RunLength = envInt("PERF_RUN_LENGTH", 12)

  /** Read rounds to average over, after a discarded warmup round. */
  private val ReadRounds = envInt("PERF_READ_ROUNDS", 5)

  private val BucketWidth = 32
  private val VoxelsPerBucket = BucketWidth * BucketWidth * BucketWidth
  private val BucketBytes = VoxelsPerBucket * BytesPerVoxel

  private val Collection = "volumeData"
  /** Common stem for every run, so orphans from interrupted runs can be swept. */
  private val KeyStem = "__perfspike_"
  private val KeyPrefix = s"$KeyStem${UUID.randomUUID().toString.take(8)}"

  // ── FossilDB ──────────────────────────────────────────────────────────────

  private lazy val channel =
    NettyChannelBuilder.forAddress("localhost", 7155).maxInboundMessageSize(Int.MaxValue).usePlaintext.build

  private lazy val stub = FossilDBGrpc.blockingStub(channel)

  private def fossilDbIsReachable: Boolean =
    Try(stub.health(HealthRequest())).map(_.success).getOrElse(false)

  // ── Payload generation ────────────────────────────────────────────────────

  private val random = new Random(42)

  private def randomBucket(): Array[Byte] = {
    val bytes = new Array[Byte](BucketBytes)
    random.nextBytes(bytes)
    bytes
  }

  /**
   * The wire format the frontend produces: one value for the whole bucket, then
   * (start, length) pairs. Every run in a bucket shares a value because a
   * transaction writes a single segment id.
   */
  private def encodeDiff(runs: Seq[(Int, Int)], value: Long): Array[Byte] = {
    val buffer = ByteBuffer.allocate(8 + 4 + runs.length * 4).order(ByteOrder.LITTLE_ENDIAN)
    buffer.putLong(value)
    buffer.putInt(runs.length)
    runs.foreach { case (start, length) =>
      buffer.putShort(start.toShort)
      buffer.putShort(length.toShort)
    }
    buffer.array()
  }

  private def randomDiff(): Array[Byte] = {
    val runs = (0 until RunsPerDiff).map { _ =>
      val row = random.nextInt(VoxelsPerBucket / BucketWidth)
      val offset = random.nextInt(math.max(1, BucketWidth - RunLength))
      (row * BucketWidth + offset, RunLength)
    }
    encodeDiff(runs, random.nextInt(1000).toLong + 1L)
  }

  /** Fold one encoded diff into a dense bucket, as a read would. */
  private def applyDiff(bucket: Array[Byte], diff: Array[Byte]): Unit = {
    val buffer = ByteBuffer.wrap(diff).order(ByteOrder.LITTLE_ENDIAN)
    val value = buffer.getLong
    val runCount = buffer.getInt
    val valueBytes = new Array[Byte](BytesPerVoxel)
    ByteBuffer.wrap(valueBytes).order(ByteOrder.LITTLE_ENDIAN).putInt(value.toInt)
    var i = 0
    while (i < runCount) {
      val start = buffer.getShort & 0xffff
      val length = buffer.getShort & 0xffff
      var voxel = start
      val end = start + length
      while (voxel < end) {
        System.arraycopy(valueBytes, 0, bucket, voxel * BytesPerVoxel, BytesPerVoxel)
        voxel += 1
      }
      i += 1
    }
  }

  // ── Keys ──────────────────────────────────────────────────────────────────

  private def oldKey(bucket: Int) = s"$KeyPrefix/old/[$bucket,0,0]"
  private def snapshotKey(bucket: Int) = s"$KeyPrefix/new/snapshot/[$bucket,0,0]"
  private def diffKey(bucket: Int) = s"$KeyPrefix/new/diff/[$bucket,0,0]"

  private def put(key: String, version: Long, value: Array[Byte]): Unit = {
    val reply = stub.put(
      PutRequest(
        collection = Collection,
        key = key,
        version = Some(version),
        value = ByteString.copyFrom(value)
      )
    )
    if (!reply.success) throw new RuntimeException(s"put failed: ${reply.errorMessage}")
  }

  // ── Reporting ─────────────────────────────────────────────────────────────

  private def time[T](body: => T): (T, Double) = {
    val start = System.nanoTime()
    val result = body
    (result, (System.nanoTime() - start) / 1e6)
  }

  private def mib(bytes: Long): String = f"${bytes / 1024.0 / 1024.0}%.1f MiB"

  private def line(label: String, values: String*): Unit =
    println(f"  $label%-34s " + values.mkString(" | "))

  /**
   * JVM and gRPC channel warmup. Without this the first measured block absorbs
   * JIT compilation and connection setup, which in an early run of this suite
   * made "old" reads look 5x slower than they are simply for going first.
   */
  private def warmup(): Unit = {
    val payload = randomBucket()
    val diff = randomDiff()
    val scratch = randomBucket()
    for (i <- 0 until 50) {
      put(s"$KeyPrefix/warmup/[$i,0,0]", 1L, payload)
      put(s"$KeyPrefix/warmupdiff/[$i,0,0]", 1L, diff)
      stub.get(GetRequest(collection = Collection, key = s"$KeyPrefix/warmup/[$i,0,0]", version = Some(1L)))
      stub.getMultipleVersions(
        GetMultipleVersionsRequest(
          collection = Collection,
          key = s"$KeyPrefix/warmupdiff/[$i,0,0]",
          oldestVersion = Some(1L),
          newestVersion = Some(1L)
        )
      )
      applyDiff(scratch, diff)
    }
  }

  /**
   * Deletes every key this suite has ever written, not just the current run's.
   * A run killed part-way leaves its data behind, and this is a shared FossilDB.
   */
  private def cleanUp(): Unit = {
    val deleted = stub.deleteAllByPrefix(DeleteAllByPrefixRequest(collection = Collection, prefix = KeyStem))
    if (!deleted.success) throw new RuntimeException(s"cleanup failed: ${deleted.errorMessage}")
  }

  "Leftover benchmark data" should {
    "be removable on its own" in {
      if (!fossilDbIsReachable) cancel("No FossilDB reachable on localhost:7155.")
      cleanUp()
      val remaining = stub.getMultipleKeys(
        GetMultipleKeysRequest(collection = Collection, prefix = Some(KeyStem), limit = Some(1))
      )
      assert(remaining.keys.isEmpty, s"keys still present: ${remaining.keys.take(3)}")
      println(s"[cleanup] no keys left under '$KeyStem' in collection '$Collection'")
    }
  }

  "The diff codec used by this benchmark" should {
    // A benchmark that folds diffs incorrectly would measure the wrong work, so
    // pin the codec down. This case needs no FossilDB.
    "round-trip runs and write exactly the covered voxels" in {
      val bucket = new Array[Byte](BucketBytes)
      val runs = Seq((0, 4), (100, 3), (VoxelsPerBucket - 2, 2))
      val value = 0x2aL
      applyDiff(bucket, encodeDiff(runs, value))

      val covered = runs.flatMap { case (start, length) => start until (start + length) }.toSet
      val written = (0 until VoxelsPerBucket).filter { voxel =>
        val slice = bucket.slice(voxel * BytesPerVoxel, (voxel + 1) * BytesPerVoxel)
        slice.exists(_ != 0)
      }.toSet
      assert(written == covered, "diff must touch exactly the voxels its runs cover")

      // And the value must land, little-endian, in every covered voxel.
      covered.foreach { voxel =>
        val decoded = ByteBuffer
          .wrap(bucket, voxel * BytesPerVoxel, BytesPerVoxel)
          .order(ByteOrder.LITTLE_ENDIAN)
          .getInt
        assert(decoded == value.toInt, s"voxel $voxel holds $decoded, expected $value")
      }
    }

    "apply later diffs over earlier ones" in {
      val bucket = new Array[Byte](BucketBytes)
      applyDiff(bucket, encodeDiff(Seq((10, 5)), 7L))
      applyDiff(bucket, encodeDiff(Seq((12, 5)), 9L))
      def at(voxel: Int) =
        ByteBuffer.wrap(bucket, voxel * BytesPerVoxel, BytesPerVoxel).order(ByteOrder.LITTLE_ENDIAN).getInt
      assert(at(10) == 7, "untouched by the second diff")
      assert(at(12) == 9, "overwritten by the second diff")
      assert(at(16) == 9, "written only by the second diff")
    }
  }

  "Volume versioning in FossilDB" should {
    "compare full-snapshot against RLE-diff storage" in {
      if (!fossilDbIsReachable) {
        cancel("No FossilDB reachable on localhost:7155 — start it with `yarn start-fossildb`.")
      }

      val totalWrites = BucketCount.toLong * VersionCount
      println()
      println("=" * 78)
      println("Volume versioning performance spike")
      println("=" * 78)
      line("buckets x versions", f"$BucketCount x $VersionCount = $totalWrites writes")
      line("bucket size", f"$BucketBytes%,d B ($BytesPerVoxel B/voxel)")
      line("diff size", f"${8 + 4 + RunsPerDiff * 4}%,d B ($RunsPerDiff runs)")
      line("snapshot interval (new)", f"every $SnapshotInterval versions")
      println()

      warmup()

      // Pre-generate payloads so generation cost is outside the timings.
      val bucketPayloads = Array.fill(BucketCount)(randomBucket())
      val diffPayloads = Array.fill(math.min(VersionCount, 64))(randomDiff())
      def diffFor(version: Int): Array[Byte] = diffPayloads(version % diffPayloads.length)

      // ── 1. Ingestion ──────────────────────────────────────────────────────
      println("1. INGESTION")

      var oldBytes = 0L
      val (_, oldWriteMs) = time {
        for (version <- 1 to VersionCount; bucket <- 0 until BucketCount) {
          val payload = bucketPayloads(bucket)
          oldBytes += payload.length
          put(oldKey(bucket), version.toLong, payload)
        }
      }

      var newBytes = 0L
      var snapshotCount = 0
      val (_, newWriteMs) = time {
        for (version <- 1 to VersionCount; bucket <- 0 until BucketCount) {
          val diff = diffFor(version)
          newBytes += diff.length
          put(diffKey(bucket), version.toLong, diff)
          if (version % SnapshotInterval == 0) {
            val payload = bucketPayloads(bucket)
            newBytes += payload.length
            snapshotCount += 1
            put(snapshotKey(bucket), version.toLong, payload)
          }
        }
      }
      // Every bucket needs a base snapshot at version 0 to fold onto.
      for (bucket <- 0 until BucketCount) {
        newBytes += bucketPayloads(bucket).length
        put(snapshotKey(bucket), 0L, bucketPayloads(bucket))
      }

      line("old: full snapshot per version", f"$oldWriteMs%,.0f ms", f"${oldWriteMs / totalWrites}%.3f ms/write", mib(oldBytes))
      line("new: diff + periodic snapshot", f"$newWriteMs%,.0f ms", f"${newWriteMs / totalWrites}%.3f ms/write", mib(newBytes))
      line("", f"speedup ${oldWriteMs / newWriteMs}%.1fx", f"bytes ${oldBytes.toDouble / newBytes}%.1fx less", f"$snapshotCount snapshots")
      println()

      // ── 2. Reading a bucket at version X ──────────────────────────────────
      println(f"2. READ AT VERSION X  (mean of $ReadRounds rounds, 1 discarded warmup round)")

      def readOld(version: Int): Unit =
        for (bucket <- 0 until BucketCount) {
          val reply = stub.get(
            GetRequest(collection = Collection, key = oldKey(bucket), version = Some(version.toLong))
          )
          if (!reply.success) throw new RuntimeException(s"get failed: ${reply.errorMessage}")
        }

      /** Returns (diffs folded, ms spent folding). */
      def readNew(version: Int): (Int, Double) = {
        var foldedDiffs = 0
        var foldMs = 0.0
        for (bucket <- 0 until BucketCount) {
          // a) newest snapshot at or below the requested version
          val snapshot = stub.get(
            GetRequest(collection = Collection, key = snapshotKey(bucket), version = Some(version.toLong))
          )
          if (!snapshot.success) throw new RuntimeException(s"snapshot get failed: ${snapshot.errorMessage}")
          val base = snapshot.value.toByteArray
          val baseVersion = snapshot.actualVersion

          // b) every diff in (baseVersion, version]
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

          // c) fold
          val (_, ms) = time(diffs.foreach(applyDiff(base, _)))
          foldMs += ms
        }
        (foldedDiffs, foldMs)
      }

      // Worst case for the new scheme: the version just before the next
      // snapshot, so the maximum number of diffs has to be folded.
      val onSnapshot = VersionCount - (VersionCount % SnapshotInterval)
      val readVersions = Seq(
        ("best case (on a snapshot)", onSnapshot),
        ("worst case (just before one)", math.max(1, onSnapshot - 1))
      )

      for ((label, version) <- readVersions) {
        // Discarded warmup round, so neither scheme pays for going first.
        readOld(version)
        readNew(version)

        var oldTotal = 0.0
        var newTotal = 0.0
        var foldTotal = 0.0
        var foldedDiffs = 0
        for (_ <- 0 until ReadRounds) {
          oldTotal += time(readOld(version))._2
          val (result, ms) = time(readNew(version))
          newTotal += ms
          foldedDiffs = result._1
          foldTotal += result._2
        }
        val reads = (ReadRounds * BucketCount).toDouble
        val oldReadMs = oldTotal / ReadRounds
        val newReadMs = newTotal / ReadRounds

        println(f"  [$label] version $version")
        line("  old: single Get", f"$oldReadMs%,.1f ms", f"${oldTotal / reads}%.3f ms/read")
        line("  new: snapshot + diffs + fold", f"$newReadMs%,.1f ms", f"${newTotal / reads}%.3f ms/read", f"${foldedDiffs / BucketCount} diffs/read")
        line("  new: of which folding (CPU)", f"${foldTotal / ReadRounds}%,.1f ms", f"${100 * foldTotal / newTotal}%.0f%% of read")
        line("", f"new/old ${newReadMs / oldReadMs}%.2fx")
        println()
      }

      // ── 3. Read cost as a function of distance from the snapshot ──────────
      // This is the input to choosing the snapshot interval: it shows what each
      // additional un-materialized version costs on a read.
      println("3. READ COST vs DIFFS FOLDED  (picks the snapshot interval)")
      line("distance from snapshot", "total", "per read", "vs old")

      val baseSnapshot = math.max(0, onSnapshot - SnapshotInterval)
      val oldBaseline = {
        readOld(onSnapshot)
        var total = 0.0
        for (_ <- 0 until ReadRounds) total += time(readOld(onSnapshot))._2
        total / ReadRounds
      }

      for (distance <- 0 until SnapshotInterval) {
        val version = baseSnapshot + distance
        if (version >= 1) {
          readNew(version)
          var total = 0.0
          for (_ <- 0 until ReadRounds) total += time(readNew(version))._2
          val mean = total / ReadRounds
          line(
            f"  +$distance versions",
            f"$mean%,.1f ms",
            f"${mean / BucketCount}%.3f ms",
            f"${mean / oldBaseline}%.2fx"
          )
        }
      }
      println()
      line("old baseline (single Get)", f"$oldBaseline%,.1f ms", f"${oldBaseline / BucketCount}%.3f ms")
      println()

      println("=" * 78)

      cleanUp()
      channel.shutdown()
      succeed
    }
  }
}
