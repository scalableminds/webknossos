package com.scalableminds.webknossos.tracingstore.tracings.volume

import java.io.{File, FileOutputStream, InputStream}
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.io.ZipIO
import com.scalableminds.util.tools.{BoxImplicits, ByteUtils, JsonHelper}
import com.scalableminds.webknossos.datastore.dataformats.wkw.WKWDataFormatHelper
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3ArrayHeader
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeDataZipFormat.VolumeDataZipFormat
import com.scalableminds.webknossos.wrap.WKWFile
import net.liftweb.common.Box
import net.liftweb.common.Box.tryo
import org.apache.commons.io.IOUtils

import java.util.zip.{ZipEntry, ZipFile}
import scala.collection.mutable

trait VolumeDataZipHelper extends WKWDataFormatHelper with ByteUtils with BoxImplicits {

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
        tryo(ZipIO.withUnziped(zipFile) {
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
        })
      } else {
        // TODO: first, read additional axes metadata fom zarr.json
        for {
          firstHeaderFilePath <- option2Box(
            ZipIO.entries(new ZipFile(zipFile)).find(entry => entry.getName == Zarr3ArrayHeader.ZARR_JSON))
          firstHeaderString <- ZipIO.readAt(new ZipFile(zipFile), firstHeaderFilePath)
          firstHeader <- JsonHelper.parseAndValidateJson[Zarr3ArrayHeader](firstHeaderString)
          _ <- ZipIO.withUnziped(zipFile) {
            case (filename, inputStream) =>
              if (filename.endsWith(Zarr3ArrayHeader.ZARR_JSON)) ()
              else {
                parseZarrChunkPath(filename.toString, firstHeader).map { bucketPosition =>
                  val data = IOUtils.toByteArray(inputStream)
                  block(bucketPosition, data)
                }
              }
          }
        } yield ()
      }
    } yield ()

  private def parseZarrChunkPath(path: String, zarr3ArrayHeader: Zarr3ArrayHeader): Option[BucketPosition] = {
    val dimensionNames = zarr3ArrayHeader.dimension_names.getOrElse(Array("z", "y", "x"))
    // TODO: this is as yet just copied from wkw
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
