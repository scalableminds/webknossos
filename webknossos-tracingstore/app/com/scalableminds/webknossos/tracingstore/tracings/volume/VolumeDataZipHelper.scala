package com.scalableminds.webknossos.tracingstore.tracings.volume

import java.io.{File, FileOutputStream, InputStream}
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.io.ZipIO
import com.scalableminds.util.tools.ByteUtils
import com.scalableminds.webknossos.datastore.dataformats.wkw.WKWDataFormatHelper
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeDataZipFormat.VolumeDataZipFormat
import com.scalableminds.webknossos.wrap.WKWFile
import net.liftweb.common.{Box, Failure}
import net.liftweb.util.Helpers.tryo
import org.apache.commons.io.IOUtils

import java.util.zip.ZipEntry
import scala.collection.mutable

trait VolumeDataZipHelper extends WKWDataFormatHelper with ByteUtils {

  private def detectVolumeDataZipFormat(zipFile: File): Box[VolumeDataZipFormat] =
    tryo(new java.util.zip.ZipFile(zipFile)).map { zip =>
      val relevantFile: Option[ZipEntry] =
        ZipIO.entries(zip).find(entry => entry.getName == "zarr.json" || entry.getName.endsWith(".wkw"))
      if (relevantFile.exists(_.getName == "zarr.json")) {
        VolumeDataZipFormat.zarr3
      } else VolumeDataZipFormat.wkw
    }

  protected def withBucketsFromZip(zipFile: File)(block: (BucketPosition, Array[Byte]) => Unit): Box[Unit] =
    for {
      format <- detectVolumeDataZipFormat(zipFile)
      _ <- if (format == VolumeDataZipFormat.wkw) {
        ZipIO.withUnziped(zipFile) {
          case (fileName, is) =>
            WKWFile.read(is) {
              case (header, buckets) =>
                if (header.numBlocksPerCube == 1) {
                  parseWKWFilePath(fileName.toString).map { bucketPosition: BucketPosition =>
                    if (buckets.hasNext) {
                      val data = buckets.next()
                      if (!isAllZero(data)) {
                        block(bucketPosition, data)
                      }
                    }
                  }
                }
            }
        }
      } else {
        // TODO: first, read additional axes metadata fom zarr.json
        ZipIO.withUnziped(zipFile) {
          case (filename, inputStream) =>
            if (filename.endsWith("zarr.json")) ()
            else {
              parseZarrChunkPath(filename.toString).map { bucketPosition =>
                val data = IOUtils.toByteArray(inputStream)
                block(bucketPosition, data)
              }
            }
        }
      }
    } yield ()

  private def parseZarrChunkPath(path: String): Option[BucketPosition] = {
    val CubeRx = s"(|.*/)(\\d+|\\d+-\\d+-\\d+)/z(\\d+)/y(\\d+)/x(\\d+).$dataFileExtension".r
    path match {
      case CubeRx(_, resolutionStr, z, y, x) =>
        Vec3Int.fromMagLiteral(resolutionStr, allowScalar = true).map { mag =>
          BucketPosition(x.toInt * mag.x * DataLayer.bucketLength,
                         y.toInt * mag.y * DataLayer.bucketLength,
                         z.toInt * mag.z * DataLayer.bucketLength,
                         mag,
                         None)
        }
      case _ =>
        None
    }
  }

  protected def resolutionSetFromZipfile(zipFile: File): Set[Vec3Int] = {
    val resolutionSet = new mutable.HashSet[Vec3Int]()
    ZipIO.withUnziped(zipFile) {
      case (fileName, _) =>
        getMagFromWKWHeaderFilePath(fileName.toString).map { mag: Vec3Int =>
          resolutionSet.add(mag)
        }
    }
    resolutionSet.toSet
  }

  protected def withZipsFromMultiZip[T](multiZip: File)(block: (Int, File) => T): Box[Unit] = {
    var index: Int = 0
    val unzipResult = ZipIO.withUnziped(multiZip) {
      case (_, is) =>
        block(index, inputStreamToTempfile(is))
        index += 1
    }
    for {
      _ <- unzipResult
    } yield ()
  }

  private def inputStreamToTempfile(inputStream: InputStream): File = {
    val tempFile = File.createTempFile("data", "zip")
    tempFile.deleteOnExit()
    val out = new FileOutputStream(tempFile)
    IOUtils.copy(inputStream, out)
    tempFile
  }
}
