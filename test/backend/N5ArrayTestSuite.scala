package backend

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.box.Full
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.io.PathUtils
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.datareaders.n5.N5Array
import com.scalableminds.webknossos.datastore.datavault.{FileSystemDataVault, VaultPath}
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import org.scalatest.{Assertion, BeforeAndAfterAll}
import org.scalatest.wordspec.AsyncWordSpec

import java.io.{ByteArrayOutputStream, DataOutputStream}
import java.nio.{ByteBuffer, ByteOrder}
import java.nio.file.{Files, Path}
import scala.concurrent.Future

class N5ArrayTestSuite extends AsyncWordSpec with BeforeAndAfterAll {

  private given TokenContext = TokenContext(None)

  // Volume size is deliberately not a multiple of the block size; N5 stores edge blocks clipped.
  private val volumeSize = 40
  private val blockSize = 32

  private def voxelValue(x: Int, y: Int, z: Int): Int = x + volumeSize * (y + volumeSize * z) + 1

  private def writeDataset(dataType: String, bytesPerElement: Int): Path = {
    val root = Files.createTempDirectory("n5-unaligned")
    Files.writeString(
      root.resolve("attributes.json"),
      s"""{"dimensions": [$volumeSize, $volumeSize, $volumeSize], "blockSize": [$blockSize, $blockSize, $blockSize], "dataType": "$dataType"}"""
    )
    for {
      blockX <- 0 to 1
      blockY <- 0 to 1
      blockZ <- 0 to 1
    } {
      val topLeft = Vec3Int(blockX, blockY, blockZ) * blockSize
      val bottomRight = Vec3Int(
        (topLeft.x + blockSize).min(volumeSize),
        (topLeft.y + blockSize).min(volumeSize),
        (topLeft.z + blockSize).min(volumeSize)
      )
      val clippedSize = bottomRight - topLeft
      val bytes = new ByteArrayOutputStream()
      val out = new DataOutputStream(bytes) // N5 is big-endian
      out.writeShort(0) // default mode
      out.writeShort(3)
      Seq(clippedSize.x, clippedSize.y, clippedSize.z).foreach(out.writeInt)
      for {
        z <- topLeft.z until bottomRight.z
        y <- topLeft.y until bottomRight.y
        x <- topLeft.x until bottomRight.x
      } if (bytesPerElement == 1) out.writeByte(voxelValue(x, y, z)) else out.writeShort(voxelValue(x, y, z))
      out.close()
      val blockDir = Files.createDirectories(root.resolve(s"$blockX/$blockY"))
      Files.write(blockDir.resolve(blockZ.toString), bytes.toByteArray)
    }
    root
  }

  private lazy val datasetsByDataType: Map[String, Path] =
    Map("uint8" -> writeDataset("uint8", 1), "uint16" -> writeDataset("uint16", 2))

  override def afterAll(): Unit =
    datasetsByDataType.values.foreach(PathUtils.deleteDirectoryRecursively(_))

  private def expectedValues(offset: Vec3Int, shape: Vec3Int, bytesPerElement: Int): Seq[Int] =
    for {
      z <- offset.z until offset.z + shape.z
      y <- offset.y until offset.y + shape.y
      x <- offset.x until offset.x + shape.x
    } yield
      if (x < volumeSize && y < volumeSize && z < volumeSize) voxelValue(x, y, z) & ((1 << (8 * bytesPerElement)) - 1)
      else 0

  private def assertReads(dataType: String, offset: Vec3Int, shape: Vec3Int): Future[Assertion] = {
    val bytesPerElement = if (dataType == "uint8") 1 else 2
    val path = new VaultPath(UPath.fromLocalPath(datasetsByDataType(dataType)), FileSystemDataVault.create)
    for {
      array <- N5Array
        .open(path, DataSourceId(dataType, "test"), "color", Some(AxisOrder.xyz), None, None, AlfuCache())
        .futureBox
        .map(_.get("test execution"))
      bytesBox <- array.readBytesWithAdditionalCoordinates(offset, shape, None, shouldReadUint24 = false).futureBox
    } yield bytesBox match {
      case Full(bytes) =>
        val actual =
          if (bytesPerElement == 1) bytes.toSeq.map(_ & 0xff)
          else {
            val shorts = new Array[Short](bytes.length / 2)
            ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(shorts)
            shorts.toSeq.map(_ & 0xffff)
          }
        val expected = expectedValues(offset, shape, bytesPerElement)
        assert(actual.length == expected.length, s"read $offset/$shape returned ${actual.length} voxels")
        assert(actual == expected, s"read $offset/$shape returned wrong values")
      case other => fail(s"read $offset/$shape failed: $other")
    }
  }

  private val fullBlock = Vec3Int.full(blockSize)

  for (dataType <- Seq("uint8", "uint16"))
    s"N5 array with $dataType data and clipped edge blocks" should {
      "read an interior block" in assertReads(dataType, Vec3Int(0, 0, 0), fullBlock)
      "read a full bucket on a block clipped in x" in assertReads(dataType, Vec3Int(32, 0, 0), fullBlock)
      "read a full bucket on a block clipped in all axes" in assertReads(dataType, Vec3Int(32, 32, 32), fullBlock)
      "read an unaligned region across blocks" in assertReads(dataType, Vec3Int(16, 16, 16), fullBlock)
    }
}
