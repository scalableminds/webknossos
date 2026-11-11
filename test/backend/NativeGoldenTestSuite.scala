package backend

import com.scalableminds.webknossos.datastore.compresso.NativeCompressoCompressor
import com.scalableminds.webknossos.datastore.draco.NativeDracoToStlConverter
import com.scalableminds.webknossos.datastore.helpers.NativeBucketScanner
import org.scalatest.wordspec.AnyWordSpec

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path, Paths}
import java.nio.{ByteBuffer, ByteOrder}
import java.security.MessageDigest
import scala.jdk.CollectionConverters.*
import scala.util.Random

/** Pins the exact results of every native (JNI) function on a fixed input corpus, so that a reimplementation of the
  * native library can be checked for identical behavior.
  *
  * Each case is reduced to one line (`name<TAB>result`): output arrays as length + the first 64 bits of their SHA-256,
  * scalars verbatim, and thrown exceptions as `throws <class>` (messages are not pinned). The inputs are either
  * generated from fixed seeds below or read from test/native-golden (see the scripts there).
  *
  * To regenerate after an intended behavior change: run this suite, then copy target/native-golden-actual.txt over
  * test/native-golden/expected.txt.
  */
class NativeGoldenTestSuite extends AnyWordSpec {

  private val goldenDir = Paths.get("test/native-golden")
  private val expectedFile = goldenDir.resolve("expected.txt")
  private val actualFile = Paths.get("target/native-golden-actual.txt")

  private lazy val bucketScanner = new NativeBucketScanner()
  private lazy val compresso = new NativeCompressoCompressor()
  private lazy val draco = new NativeDracoToStlConverter()

  private val bucketLength = 32
  private val bucketVoxelCount = bucketLength * bucketLength * bucketLength
  private val maxDecompressedBytes = 1024 * 1024 * 1024

  // ---------- result encoding ----------

  private def sha256(bytes: Array[Byte]): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).take(8).map(b => f"${b & 0xff}%02x").mkString

  private def bytesResult(bytes: Array[Byte]): String = s"bytes len=${bytes.length} sha256_64=${sha256(bytes)}"

  private def longsResult(longs: Array[Long]): String = {
    val buffer = ByteBuffer.allocate(longs.length * 8).order(ByteOrder.LITTLE_ENDIAN)
    longs.foreach(buffer.putLong)
    s"longs len=${longs.length} sha256_64=${sha256(buffer.array())}"
  }

  private def capture(compute: => String): String =
    try compute
    catch { case e: Exception => s"throws ${e.getClass.getName}" }

  // For corrupted input whose decoded garbage (or rejection) is an implementation detail: only pins that the call
  // returns or throws a Java exception, i.e. does not crash the JVM.
  private def survives(compute: => Any): String =
    try {
      compute
      "returns or throws"
    } catch { case _: Exception => "returns or throws" }

  // ---------- bucket inputs ----------

  private def littleEndianLowBytes(value: Long, bytesPerElement: Int): Array[Byte] =
    ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putLong(value).array().take(bytesPerElement)

  // Raw element values (as their low bytes) that cover zero, small ids, the extremes and values whose topmost bit
  // is set (negative when read as signed).
  private def palette(bytesPerElement: Int): Seq[Long] = {
    val bits = bytesPerElement * 8
    val max = if (bits == 64) -1L else (1L << bits) - 1
    val topBit = if (bits == 64) Long.MinValue else 1L << (bits - 1)
    Seq(0L, 1L, 2L, 7L, 42L, max, max - 1, topBit, topBit + 3, topBit - 1).map(_ & max).distinct
  }

  // How the native code reads a raw element value, depending on signedness.
  private def interpret(raw: Long, bytesPerElement: Int, isSigned: Boolean): Long =
    if (bytesPerElement == 8 || !isSigned) raw
    else {
      val shift = 64 - bytesPerElement * 8
      (raw << shift) >> shift
    }

  // A bucket made of runs of palette values, so that both repeated and changing values occur.
  private def bucket(bytesPerElement: Int, seed: Int, zeroShare: Double = 0.0): Array[Byte] = {
    val random = new Random(seed)
    val values = palette(bytesPerElement)
    val out = new Array[Byte](bucketVoxelCount * bytesPerElement)
    var index = 0
    while (index < bucketVoxelCount) {
      val runLength = 1 + random.nextInt(60)
      val value = if (random.nextDouble() < zeroShare) 0L else values(random.nextInt(values.length))
      val valueBytes = littleEndianLowBytes(value, bytesPerElement)
      (index until math.min(index + runLength, bucketVoxelCount)).foreach { i =>
        System.arraycopy(valueBytes, 0, out, i * bytesPerElement, bytesPerElement)
      }
      index += runLength
    }
    out
  }

  private def queryIds(bytesPerElement: Int): Seq[Long] =
    (palette(bytesPerElement).flatMap(raw => Seq(raw, interpret(raw, bytesPerElement, isSigned = true))) ++ Seq(
      3L,
      -2L,
      Long.MaxValue
    )).distinct

  // ---------- voxel runs inputs ----------

  private def varint(value: Long): Array[Byte] =
    if (value < 0x80) Array(value.toByte)
    else Array(((value & 0x7f) | 0x80).toByte) ++ varint(value >>> 7)

  private def voxelRunsHeader(formatVersion: Int, runAxis: Int, value: Long): Array[Byte] = {
    val header = ByteBuffer.allocate(10).order(ByteOrder.LITTLE_ENDIAN)
    header.put(formatVersion.toByte).put(runAxis.toByte).putLong(value)
    header.array()
  }

  private def voxelRuns(runAxis: Int, value: Long, runs: Seq[(Int, Int)]): Array[Byte] =
    voxelRunsHeader(1, runAxis, value) ++ varint(runs.length) ++ runs.flatMap { case (gap, length) =>
      varint(gap) ++ varint(length)
    }

  // Random non-overlapping (gap, length) runs that stay within one bucket.
  private def randomRuns(seed: Int, count: Int, maxLength: Int): Seq[(Int, Int)] = {
    val random = new Random(seed)
    var end = 0
    (0 until count).flatMap { _ =>
      val gap = random.nextInt(200)
      val length = 1 + random.nextInt(maxLength)
      if (end + gap + length > bucketVoxelCount) None
      else {
        end += gap + length
        Some((gap, length))
      }
    }
  }

  // ---------- cases ----------

  private def bucketScannerCases: Seq[(String, () => String)] = {
    val cases = Seq.newBuilder[(String, () => String)]
    def add(name: String)(compute: => String): Unit = cases += (name -> (() => capture(compute)))

    for {
      bytesPerElement <- Seq(1, 2, 4, 8)
      isSigned <- Seq(false, true)
      seed <- Seq(0, 1)
    } {
      val prefix = s"bucketScanner/bpe$bytesPerElement/${if (isSigned) "signed" else "unsigned"}/seed$seed"
      val input = bucket(bytesPerElement, seed)
      val ids = queryIds(bytesPerElement)

      for (skipZeroes <- Seq(false, true))
        add(s"$prefix/collectSegmentIds/skipZeroes=$skipZeroes") {
          longsResult(bucketScanner.collectSegmentIds(input, bytesPerElement, isSigned, skipZeroes).sorted)
        }

      ids.foreach { id =>
        add(s"$prefix/countSegmentVoxels/id=$id") {
          bucketScanner.countSegmentVoxels(input, bytesPerElement, isSigned, id).toString
        }
        add(s"$prefix/deleteSegmentFromBucket/id=$id") {
          bytesResult(bucketScanner.deleteSegmentFromBucket(input, bytesPerElement, isSigned, id))
        }
      }

      val existingBoxes = Seq(
        "empty" -> Seq(Int.MaxValue, Int.MaxValue, Int.MaxValue, Int.MinValue, Int.MinValue, Int.MinValue),
        "existing" -> Seq(70, 100, 40, 80, 110, 50)
      )
      for {
        id <- ids.take(6)
        (boxName, box) <- existingBoxes
      } add(s"$prefix/extendSegmentBoundingBox/id=$id/$boxName") {
        bucketScanner
          .extendSegmentBoundingBox(
            input,
            bytesPerElement,
            isSigned,
            bucketLength,
            id,
            64,
            96,
            32,
            box(0),
            box(1),
            box(2),
            box(3),
            box(4),
            box(5)
          )
          .mkString(",")
      }

      // Maps most palette values (as the native code reads them) to other ids; unmapped ids become 0.
      val readIds = palette(bytesPerElement).map(interpret(_, bytesPerElement, isSigned))
      val mappingSrc = readIds.drop(1).toArray
      val mappingDst = mappingSrc.indices.map(i => readIds((i + 3) % readIds.length) + i).toArray
      val mappings = Seq(
        "full" -> (mappingSrc, mappingDst),
        "partial" -> (mappingSrc.take(3), mappingDst.take(3)),
        "empty" -> (Array.empty[Long], Array.empty[Long]),
        "duplicateKeys" -> (mappingSrc.take(2) ++ mappingSrc.take(2), Array(5L, 6L, 7L, 8L))
      )
      mappings.foreach { case (mappingName, (src, dst)) =>
        add(s"$prefix/applySegmentIdMapping/$mappingName") {
          bytesResult(bucketScanner.applySegmentIdMapping(input, bytesPerElement, isSigned, src, dst))
        }
        for (skipMapping <- Seq(false, true))
          add(s"$prefix/mergeVolumeBucketInPlace/$mappingName/skipMapping=$skipMapping") {
            val mutable = bucket(bytesPerElement, seed + 100)
            val incoming = bucket(bytesPerElement, seed + 200, zeroShare = 0.7)
            bucketScanner.mergeVolumeBucketInPlace(
              mutable,
              incoming,
              skipMapping,
              src,
              dst,
              bytesPerElement,
              isSigned
            )
            bytesResult(mutable)
          }
      }

      for {
        runAxis <- Seq(0, 1, 2)
        (runsName, runs) <- Seq(
          "none" -> Seq.empty,
          "short" -> randomRuns(seed * 10 + runAxis, 300, 40),
          "long" -> randomRuns(seed * 10 + runAxis + 5, 40, 2000),
          "full" -> Seq((0, bucketVoxelCount))
        )
        value <- Seq(palette(bytesPerElement)(4), palette(bytesPerElement)(5), -1L).distinct
      } add(s"$prefix/applyVoxelRuns/axis$runAxis/$runsName/value=$value") {
        bytesResult(bucketScanner.applyVoxelRuns(input, bytesPerElement, isSigned, voxelRuns(runAxis, value, runs)))
      }
    }

    // Invalid arguments
    val uint16Bucket = bucket(2, 7)
    val oddLength = uint16Bucket.take(uint16Bucket.length - 1)
    val threeBytes = new Array[Byte](bucketVoxelCount * 3)
    add("bucketScanner/invalid/collectSegmentIds/bpe0")(
      longsResult(bucketScanner.collectSegmentIds(uint16Bucket, 0, false, false))
    )
    add("bucketScanner/invalid/collectSegmentIds/bpe3")(
      longsResult(bucketScanner.collectSegmentIds(threeBytes, 3, false, false))
    )
    add("bucketScanner/invalid/collectSegmentIds/indivisibleLength") {
      longsResult(bucketScanner.collectSegmentIds(oddLength, 2, false, false))
    }
    add("bucketScanner/invalid/countSegmentVoxels/bpe0")(
      bucketScanner.countSegmentVoxels(uint16Bucket, 0, false, 1).toString
    )
    add("bucketScanner/invalid/countSegmentVoxels/bpe3")(
      bucketScanner.countSegmentVoxels(threeBytes, 3, false, 1).toString
    )
    add("bucketScanner/invalid/countSegmentVoxels/indivisibleLength") {
      bucketScanner.countSegmentVoxels(oddLength, 2, false, 1).toString
    }
    add("bucketScanner/invalid/countSegmentVoxels/emptyBucket")(
      bucketScanner.countSegmentVoxels(Array.empty, 2, false, 0).toString
    )
    add("bucketScanner/invalid/extendSegmentBoundingBox/wrongBucketLength") {
      bucketScanner.extendSegmentBoundingBox(uint16Bucket, 2, false, 16, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0).mkString(",")
    }
    add("bucketScanner/invalid/extendSegmentBoundingBox/bpe3") {
      bucketScanner.extendSegmentBoundingBox(threeBytes, 3, false, 32, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0).mkString(",")
    }
    add("bucketScanner/invalid/applySegmentIdMapping/lengthMismatch") {
      bytesResult(bucketScanner.applySegmentIdMapping(uint16Bucket, 2, false, Array(1L, 2L), Array(3L)))
    }
    add("bucketScanner/invalid/applySegmentIdMapping/bpe3") {
      bytesResult(bucketScanner.applySegmentIdMapping(threeBytes, 3, false, Array(1L), Array(3L)))
    }
    add("bucketScanner/invalid/mergeVolumeBucketInPlace/mappingLengthMismatch") {
      val mutable = uint16Bucket.clone()
      bucketScanner.mergeVolumeBucketInPlace(mutable, bucket(2, 8), false, Array(1L, 2L), Array(3L), 2, false)
      bytesResult(mutable)
    }
    add("bucketScanner/invalid/mergeVolumeBucketInPlace/bucketLengthMismatch") {
      val mutable = uint16Bucket.clone()
      bucketScanner.mergeVolumeBucketInPlace(mutable, bucket(4, 8), true, Array.empty, Array.empty, 2, false)
      bytesResult(mutable)
    }
    add("bucketScanner/invalid/deleteSegmentFromBucket/indivisibleLength") {
      bytesResult(bucketScanner.deleteSegmentFromBucket(oddLength, 2, false, 1))
    }
    add("bucketScanner/invalid/deleteSegmentFromBucket/bpe3") {
      bytesResult(bucketScanner.deleteSegmentFromBucket(threeBytes, 3, false, 0))
    }

    val validRuns = voxelRuns(0, 5, Seq((10, 20), (5, 5)))
    val invalidVoxelRuns = Seq(
      "emptyBuffer" -> Array.empty[Byte],
      "shortHeader" -> validRuns.take(9),
      "unknownVersion" -> (voxelRunsHeader(2, 0, 5) ++ varint(0)),
      "unknownAxis" -> (voxelRunsHeader(1, 3, 5) ++ varint(0)),
      "missingRunCount" -> voxelRunsHeader(1, 0, 5),
      "tooManyRuns" -> (voxelRunsHeader(1, 0, 5) ++ varint(bucketVoxelCount + 1)),
      "runBeyondBucket" -> voxelRuns(1, 5, Seq((bucketVoxelCount - 10, 11))),
      "truncatedRuns" -> validRuns.dropRight(1),
      "trailingBytes" -> (validRuns ++ Array[Byte](0)),
      "unterminatedVarint" -> (voxelRunsHeader(1, 0, 5) ++ Array[Byte](1, 0x80.toByte)),
      "overlongVarint" -> (voxelRunsHeader(1, 0, 5) ++ Array[Byte](1, 0x80.toByte, 0x80.toByte, 0x80.toByte, 1, 1))
    )
    invalidVoxelRuns.foreach { case (name, runsBytes) =>
      add(s"bucketScanner/invalid/applyVoxelRuns/$name") {
        bytesResult(bucketScanner.applyVoxelRuns(uint16Bucket, 2, false, runsBytes))
      }
    }
    add("bucketScanner/invalid/applyVoxelRuns/bucketNot32Cubed") {
      bytesResult(bucketScanner.applyVoxelRuns(uint16Bucket.take(1024), 2, false, validRuns))
    }
    add("bucketScanner/invalid/applyVoxelRuns/bpe3")(
      bytesResult(bucketScanner.applyVoxelRuns(threeBytes, 3, false, validRuns))
    )

    cases.result()
  }

  private def corpus(subdirectory: String, extension: String): Seq[Path] =
    Files
      .list(goldenDir.resolve(subdirectory))
      .iterator()
      .asScala
      .filter(_.toString.endsWith(extension))
      .toSeq
      .sortBy(_.getFileName.toString)

  private def compressoCases: Seq[(String, () => String)] =
    corpus("compresso", ".cpso").flatMap { path =>
      val name = s"compresso/${path.getFileName}"
      val input = Files.readAllBytes(path)
      val flipped = input.clone()
      Seq(40, input.length / 2, input.length - 1).foreach(i => flipped(i) = (flipped(i) ^ 0x5a).toByte)
      Seq(
        s"$name/decompress" -> (() => capture(bytesResult(compresso.decompress(input, maxDecompressedBytes)))),
        s"$name/maxOutputLengthTooSmall" -> (() => capture(bytesResult(compresso.decompress(input, 100)))),
        s"$name/negativeMaxOutputLength" -> (() => capture(bytesResult(compresso.decompress(input, -1)))),
        s"$name/headerOnly" -> (() => capture(bytesResult(compresso.decompress(input.take(36), maxDecompressedBytes)))),
        s"$name/truncatedHeader" -> (() =>
          capture(bytesResult(compresso.decompress(input.take(20), maxDecompressedBytes)))
        ),
        s"$name/truncatedHalf" -> (() =>
          survives(compresso.decompress(input.take(input.length / 2), maxDecompressedBytes))
        ),
        s"$name/flippedBytes" -> (() => survives(compresso.decompress(flipped, maxDecompressedBytes)))
      )
    } :+ ("compresso/invalid/empty" -> (() =>
      capture(bytesResult(compresso.decompress(Array.empty, maxDecompressedBytes)))
    ))

  private def dracoCases: Seq[(String, () => String)] = {
    // (offset, scale) pairs as used by DSFullMeshService: identity, and a typical voxel size with a chunk offset
    val transforms = Seq(
      "identity" -> (Seq(0f, 0f, 0f), Seq(1.0, 1.0, 1.0)),
      "scaled" -> (Seq(1.5f, -2f, 3.25f), Seq(11.24, 11.24, 28.0))
    )
    def convert(input: Array[Byte], transform: (Seq[Float], Seq[Double]), quantizationBits: Int): String = {
      val (offset, scale) = transform
      bytesResult(
        draco.dracoToStl(input, offset(0), offset(1), offset(2), scale(0), scale(1), scale(2), quantizationBits)
      )
    }
    val fileCases = corpus("draco", ".drc").flatMap { path =>
      val input = Files.readAllBytes(path)
      for {
        (transformName, transform) <- transforms
        quantizationBits <- Seq(0, 10, 16)
      } yield s"draco/${path.getFileName}/$transformName/quantizationBits=$quantizationBits" -> (() =>
        capture(convert(input, transform, quantizationBits))
      )
    }
    val someMesh = Files.readAllBytes(corpus("draco", ".drc").head)
    val invalidInputs = Seq(
      "empty" -> Array.empty[Byte],
      "magicOnly" -> "DRACO".getBytes(StandardCharsets.US_ASCII),
      "truncatedHeader" -> someMesh.take(8),
      "garbage" -> {
        val random = new Random(3)
        "DRACO".getBytes(StandardCharsets.US_ASCII) ++ Array.fill(200)(random.nextInt(256).toByte)
      }
    )
    fileCases ++ invalidInputs.map { case (name, input) =>
      s"draco/invalid/$name" -> (() => capture(convert(input, transforms.head._2, 0)))
    }
  }

  "The native library" should {
    "produce the pinned results for all golden cases" in {
      val cases = bucketScannerCases ++ compressoCases ++ dracoCases
      val names = cases.map(_._1)
      assert(names.distinct.length == names.length, "duplicate golden case names")

      val actual = cases.map { case (name, compute) => name -> compute() }
      Files.createDirectories(actualFile.getParent)
      Files.write(actualFile, actual.map { case (name, result) => s"$name\t$result" }.asJava)

      assert(Files.exists(expectedFile), s"$expectedFile is missing, see $actualFile")
      val expected = Files
        .readAllLines(expectedFile)
        .asScala
        .filter(_.nonEmpty)
        .map { line =>
          val Array(name, result) = line.split("\t", 2)
          name -> result
        }
        .toMap
      val actualMap = actual.toMap
      val missing = expected.keySet.diff(actualMap.keySet).toSeq.sorted
      val added = actualMap.keySet.diff(expected.keySet).toSeq.sorted
      val differing = actual.collect {
        case (name, result) if expected.get(name).exists(_ != result) =>
          s"$name\n  expected: ${expected(name)}\n  actual:   $result"
      }
      val problems = differing ++ missing.map(name => s"$name: missing") ++ added.map(name => s"$name: not pinned")
      assert(
        problems.isEmpty,
        s"${problems.length} of ${expected.size} golden cases differ (all results in $actualFile):\n" + problems
          .take(30)
          .mkString("\n")
      )
    }
  }
}
