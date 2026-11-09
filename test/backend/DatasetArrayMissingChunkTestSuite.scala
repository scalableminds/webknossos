package backend

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.box.{Box, Empty, Full}
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.io.PathUtils
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.datareaders.zarr.ZarrArray
import com.scalableminds.webknossos.datastore.datavault.{FileSystemDataVault, VaultPath}
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import org.scalatest.{Assertion, BeforeAndAfterAll}
import org.scalatest.wordspec.AsyncWordSpec

import java.nio.file.{Files, Path}
import scala.concurrent.Future

class DatasetArrayMissingChunkTestSuite extends AsyncWordSpec with BeforeAndAfterAll {

  private given TokenContext = TokenContext(None)

  private val chunkSize = 32
  private val chunkVolume = chunkSize * chunkSize * chunkSize
  private val presentValue: Byte = 5

  // Uncompressed uint8 zarr array of 2x1x1 chunks. Only chunk 0.0.0 is present on disk, chunk 1.0.0 is missing.
  private def writeDataset(order: String, fillValue: Int): Path = {
    val root = Files.createTempDirectory("zarr-missing-chunk")
    Files.writeString(
      root.resolve(".zarray"),
      s"""{"zarr_format": 2, "shape": [${2 * chunkSize}, $chunkSize, $chunkSize], "chunks": [$chunkSize, $chunkSize, $chunkSize],
         |"dtype": "|u1", "compressor": null, "filters": null, "fill_value": $fillValue, "order": "$order"}""".stripMargin
    )
    Files.write(root.resolve("0.0.0"), Array.fill[Byte](chunkVolume)(presentValue))
    root
  }

  private lazy val datasets: Map[(String, Int), Path] =
    (for {
      order <- Seq("F", "C")
      fillValue <- Seq(0, 7)
    } yield (order, fillValue) -> writeDataset(order, fillValue)).toMap

  override def afterAll(): Unit =
    datasets.values.foreach(PathUtils.deleteDirectoryRecursively(_))

  private def read(
      order: String,
      fillValue: Int,
      offset: Vec3Int,
      shape: Vec3Int,
      emptyIfChunkMissing: Boolean
  ): Future[Box[Array[Byte]]] = {
    val path = new VaultPath(UPath.fromLocalPath(datasets((order, fillValue))), FileSystemDataVault.create)
    for {
      array <- ZarrArray
        .open(path, DataSourceId("missing-chunk", "test"), "color", Some(AxisOrder.xyz), None, None, AlfuCache())
        .futureBox
        .map(_.get("test execution"))
      bytesBox <- array
        .readBytesWithAdditionalCoordinates(offset, shape, None, shouldReadUint24 = false, emptyIfChunkMissing)
        .futureBox
    } yield bytesBox
  }

  private val fullChunk = Vec3Int.full(chunkSize)
  private val missingChunkOffset = Vec3Int(chunkSize, 0, 0)

  private def assertFilledWith(box: Box[Array[Byte]], expected: Seq[Byte]): Assertion =
    box match {
      case Full(bytes) => assert(bytes.toSeq == expected)
      case other       => fail(s"Expected data, got $other")
    }

  for (order <- Seq("F", "C"))
    s"Reading a $order-order zarr array with a missing chunk" should {
      "return Empty for an exactly matching missing chunk if requested and fill value is 0" in {
        read(order, 0, missingChunkOffset, fullChunk, emptyIfChunkMissing = true).map(box => assert(box == Empty))
      }
      "return zeros for an exactly matching missing chunk if not requested" in {
        read(order, 0, missingChunkOffset, fullChunk, emptyIfChunkMissing = false).map(
          assertFilledWith(_, Seq.fill(chunkVolume)(0.toByte))
        )
      }
      "return the fill value for an exactly matching missing chunk if fill value is not 0" in {
        read(order, 7, missingChunkOffset, fullChunk, emptyIfChunkMissing = true).map(
          assertFilledWith(_, Seq.fill(chunkVolume)(7.toByte))
        )
      }
      "return data for an exactly matching present chunk" in {
        read(order, 0, Vec3Int(0, 0, 0), fullChunk, emptyIfChunkMissing = true).map(
          assertFilledWith(_, Seq.fill(chunkVolume)(presentValue))
        )
      }
      "return zeros for a smaller region within a missing chunk" in {
        read(order, 0, missingChunkOffset, Vec3Int.full(16), emptyIfChunkMissing = true).map(
          assertFilledWith(_, Seq.fill(16 * 16 * 16)(0.toByte))
        )
      }
      "return mixed data for an unaligned region spanning present and missing chunks" in {
        read(order, 0, Vec3Int(16, 0, 0), fullChunk, emptyIfChunkMissing = true).map { box =>
          // F-order output: x is the fastest axis. x < 32 lies in the present chunk.
          val expected = for {
            _ <- 0 until chunkSize
            _ <- 0 until chunkSize
            x <- 16 until 16 + chunkSize
          } yield if (x < chunkSize) presentValue else 0.toByte
          assertFilledWith(box, expected)
        }
      }
    }
}
