package backend

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.box.Full
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.datareaders.precomputed.PrecomputedArray
import com.scalableminds.webknossos.datastore.datavault.{FileSystemDataVault, VaultPath}
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import org.scalatest.Assertion
import org.scalatest.wordspec.AsyncWordSpec
import ucar.ma2.Array as MultiArray

import java.nio.{ByteBuffer, ByteOrder}
import java.nio.file.{Files, Path}
import scala.concurrent.Future

class PrecomputedArrayTestSuite extends AsyncWordSpec {

  private given TokenContext = TokenContext(None)

  // Volume size is deliberately not a multiple of the chunk size, so the edge chunks are clipped in every axis.
  private val volumeSize = Vec3Int(40, 40, 40)
  private val chunkSize = 32
  private val segmentationBlockSize = 8

  private def voxelValue(x: Int, y: Int, z: Int): Long = x + volumeSize.x * (y + volumeSize.y * z) + 1L

  private def isInVolume(x: Int, y: Int, z: Int): Boolean =
    x < volumeSize.x && y < volumeSize.y && z < volumeSize.z

  private def chunkBounds(chunkIndex: Vec3Int): (Vec3Int, Vec3Int) = {
    val topLeft = chunkIndex * chunkSize
    val bottomRight = Vec3Int(
      (topLeft.x + chunkSize).min(volumeSize.x),
      (topLeft.y + chunkSize).min(volumeSize.y),
      (topLeft.z + chunkSize).min(volumeSize.z)
    )
    (topLeft, bottomRight)
  }

  private def longsToBytes(values: Seq[Long]): Array[Byte] = {
    val buffer = ByteBuffer.allocate(values.length * 8).order(ByteOrder.LITTLE_ENDIAN)
    values.foreach(buffer.putLong)
    buffer.array()
  }

  private def intsToBytes(values: Seq[Int]): Array[Byte] = {
    val buffer = ByteBuffer.allocate(values.length * 4).order(ByteOrder.LITTLE_ENDIAN)
    values.foreach(buffer.putInt)
    buffer.array()
  }

  private def encodeRawChunk(topLeft: Vec3Int, bottomRight: Vec3Int): Array[Byte] =
    longsToBytes(for {
      z <- topLeft.z until bottomRight.z
      y <- topLeft.y until bottomRight.y
      x <- topLeft.x until bottomRight.x
    } yield voxelValue(x, y, z))

  // Minimal single-channel encoder for https://github.com/google/neuroglancer/tree/master/src/neuroglancer/sliceview/compressed_segmentation
  private def encodeCompressedSegmentationChunk(topLeft: Vec3Int, bottomRight: Vec3Int): Array[Byte] = {
    val shape = bottomRight - topLeft
    val bs = segmentationBlockSize
    val gridSize = Vec3Int((shape.x + bs - 1) / bs, (shape.y + bs - 1) / bs, (shape.z + bs - 1) / bs)
    val blockCount = gridSize.x * gridSize.y * gridSize.z
    val headers = new Array[Int](blockCount * 2)
    val body = Seq.newBuilder[Int]
    var bodyOffset = blockCount * 2
    for {
      blockZ <- 0 until gridSize.z
      blockY <- 0 until gridSize.y
      blockX <- 0 until gridSize.x
    } {
      val values = for {
        z <- 0 until bs
        y <- 0 until bs
        x <- 0 until bs
      } yield {
        val (globalX, globalY, globalZ) =
          (topLeft.x + blockX * bs + x, topLeft.y + blockY * bs + y, topLeft.z + blockZ * bs + z)
        if (isInVolume(globalX, globalY, globalZ)) voxelValue(globalX, globalY, globalZ) else 0L
      }
      val table = values.distinct
      val encodedBits = if (table.length == 1) 0 else Seq(1, 2, 4, 8, 16, 32).find(b => (1L << b) >= table.length).get
      val encodedValues = new Array[Int]((bs * bs * bs * encodedBits + 31) / 32)
      values.zipWithIndex.foreach { case (value, i) =>
        val bitPos = i * encodedBits
        encodedValues(bitPos / 32) |= table.indexOf(value) << (bitPos % 32)
      }
      val blockIndex = blockX + gridSize.x * (blockY + gridSize.y * blockZ)
      val tableOffset = bodyOffset + encodedValues.length
      headers(blockIndex * 2) = tableOffset | (encodedBits << 24)
      headers(blockIndex * 2 + 1) = bodyOffset
      body ++= encodedValues
      body ++= table.flatMap(v => Seq(v.toInt, (v >>> 32).toInt))
      bodyOffset = tableOffset + table.length * 2
    }
    intsToBytes(1 +: (headers.toSeq ++ body.result()))
  }

  private def writeDataset(encoding: String): Path = {
    val root = Files.createTempDirectory("precomputed-unaligned")
    val scaleKey = "1_1_1"
    val blockSizeJson =
      if (encoding == "compressed_segmentation") """"compressed_segmentation_block_size": [8, 8, 8],""" else ""
    val info =
      s"""{"type": "segmentation", "data_type": "uint64", "num_channels": 1, "scales": [{
         |  "key": "$scaleKey", "size": [${volumeSize.x}, ${volumeSize.y}, ${volumeSize.z}], "resolution": [1, 1, 1],
         |  "chunk_sizes": [[$chunkSize, $chunkSize, $chunkSize]], "encoding": "$encoding", $blockSizeJson
         |  "voxel_offset": [0, 0, 0]}]}""".stripMargin
    Files.writeString(root.resolve("info"), info)
    val scaleDir = Files.createDirectory(root.resolve(scaleKey))
    for {
      chunkX <- 0 to 1
      chunkY <- 0 to 1
      chunkZ <- 0 to 1
    } {
      val (topLeft, bottomRight) = chunkBounds(Vec3Int(chunkX, chunkY, chunkZ))
      val bytes =
        if (encoding == "raw") encodeRawChunk(topLeft, bottomRight)
        else encodeCompressedSegmentationChunk(topLeft, bottomRight)
      val fileName =
        s"${topLeft.x}-${bottomRight.x}_${topLeft.y}-${bottomRight.y}_${topLeft.z}-${bottomRight.z}"
      Files.write(scaleDir.resolve(fileName), bytes)
    }
    scaleDir
  }

  private lazy val datasetsByEncoding: Map[String, Path] =
    Seq("raw", "compressed_segmentation").map(encoding => encoding -> writeDataset(encoding)).toMap

  private def openArray(encoding: String, cache: AlfuCache[String, MultiArray]): Future[PrecomputedArray] = {
    val magPath = new VaultPath(UPath.fromLocalPath(datasetsByEncoding(encoding)), FileSystemDataVault.create)
    PrecomputedArray
      .open(magPath, DataSourceId(encoding, "test"), "segmentation", Some(AxisOrder.xyz), None, None, cache)
      .futureBox
      .map(_.get("test execution"))
  }

  private def expectedValues(offset: Vec3Int, shape: Vec3Int): Seq[Long] =
    for {
      z <- offset.z until offset.z + shape.z
      y <- offset.y until offset.y + shape.y
      x <- offset.x until offset.x + shape.x
    } yield if (isInVolume(x, y, z)) voxelValue(x, y, z) else 0L

  private def assertReads(array: PrecomputedArray, offset: Vec3Int, shape: Vec3Int): Future[Assertion] =
    array.readBytesWithAdditionalCoordinates(offset, shape, None, shouldReadUint24 = false).futureBox.map {
      case Full(bytes) =>
        val actual = new Array[Long](bytes.length / 8)
        ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asLongBuffer().get(actual)
        val expected = expectedValues(offset, shape)
        assert(actual.length == expected.length, s"read $offset/$shape returned ${actual.length} voxels")
        assert(actual.toSeq == expected, s"read $offset/$shape returned wrong values")
      case other => fail(s"read $offset/$shape failed: $other")
    }

  // Each read gets a fresh cache, so results don’t depend on which reads ran before
  private def assertReadsIsolated(encoding: String, offset: Vec3Int, shape: Vec3Int): Future[Assertion] =
    openArray(encoding, AlfuCache()).flatMap(assertReads(_, offset, shape))

  private val full = Vec3Int(chunkSize, chunkSize, chunkSize)

  for (encoding <- Seq("raw", "compressed_segmentation"))
    s"Precomputed array with $encoding encoding and unaligned volume size" should {
      "read an interior chunk" in assertReadsIsolated(encoding, Vec3Int(0, 0, 0), full)
      "read a full bucket on a chunk clipped in x" in assertReadsIsolated(encoding, Vec3Int(32, 0, 0), full)
      "read a full bucket on a chunk clipped in y" in assertReadsIsolated(encoding, Vec3Int(0, 32, 0), full)
      "read a full bucket on a chunk clipped in z" in assertReadsIsolated(encoding, Vec3Int(0, 0, 32), full)
      "read a full bucket on a chunk clipped in all axes" in assertReadsIsolated(encoding, Vec3Int(32, 32, 32), full)
      "read exactly the stored extent of a clipped chunk" in assertReadsIsolated(
        encoding,
        Vec3Int(32, 0, 0),
        Vec3Int(8, 32, 32)
      )
      "read with an offset into a clipped chunk" in assertReadsIsolated(encoding, Vec3Int(33, 1, 0), Vec3Int(7, 7, 32))
      "read the whole volume" in assertReadsIsolated(encoding, Vec3Int(0, 0, 0), volumeSize)

      "read correctly when a chunk is cached by a full-chunk read first" in {
        for {
          array <- openArray(encoding, AlfuCache())
          _ <- assertReads(array, Vec3Int(0, 0, 0), full)
          _ <- assertReads(array, Vec3Int(32, 0, 0), Vec3Int(8, 32, 32))
          _ <- assertReads(array, Vec3Int(1, 1, 1), Vec3Int(16, 16, 16))
          assertion <- assertReads(array, Vec3Int(0, 0, 0), volumeSize)
        } yield assertion
      }

      "read correctly when a chunk is cached by a partial read first" in {
        for {
          array <- openArray(encoding, AlfuCache())
          _ <- assertReads(array, Vec3Int(1, 1, 1), Vec3Int(16, 16, 16))
          assertion <- assertReads(array, Vec3Int(0, 0, 0), full)
        } yield assertion
      }
    }
}
