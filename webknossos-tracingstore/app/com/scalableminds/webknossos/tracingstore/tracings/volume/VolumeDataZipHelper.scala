package com.scalableminds.webknossos.tracingstore.tracings.volume

import java.io.{File, FileOutputStream, InputStream}
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.io.ZipIO
import com.scalableminds.util.tools.{BoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.dataformats.wkw.WKWDataFormatHelper
import com.scalableminds.webknossos.datastore.datareaders.{
  BloscCompressor,
  IntCompressionSetting,
  StringCompressionSetting
}
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3ArrayHeader
import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, BucketPosition}
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeDataZipFormat.VolumeDataZipFormat
import com.scalableminds.webknossos.wrap.WKWFile
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box
import net.liftweb.common.Box.tryo
import org.apache.commons.io.IOUtils

import java.util.zip.{ZipEntry, ZipFile}
import scala.collection.mutable

trait VolumeDataZipHelper
    extends WKWDataFormatHelper
    with VolumeBucketReversionHelper
    with BoxImplicits
    with LazyLogging {

  protected def withBucketsFromZip(zipFile: File)(block: (BucketPosition, Array[Byte]) => Unit): Box[Unit] =
    for {
      format <- detectVolumeDataZipFormat(zipFile)
      _ <- if (format == VolumeDataZipFormat.wkw)
        withBucketsFromWkwZip(zipFile)(block)
      else withBucketsFromZarr3Zip(zipFile)(block)
    } yield ()

  private def detectVolumeDataZipFormat(zipFile: File): Box[VolumeDataZipFormat] =
    tryo(new java.util.zip.ZipFile(zipFile)).map { zip =>
      val relevantFile: Option[ZipEntry] =
        ZipIO.entries(zip).find(entry => entry.getName.endsWith("zarr.json") || entry.getName.endsWith(".wkw"))
      if (relevantFile.exists(_.getName.endsWith("zarr.json"))) {
        VolumeDataZipFormat.zarr3
      } else VolumeDataZipFormat.wkw
    }

  private def withBucketsFromWkwZip(zipFile: File)(block: (BucketPosition, Array[Byte]) => Unit): Box[Unit] =
    tryo(ZipIO.withUnziped(zipFile) {
      case (fileName, is) =>
        WKWFile.read(is) {
          case (header, buckets) =>
            if (header.numBlocksPerCube == 1) {
              parseWKWFilePath(fileName.toString).map { bucketPosition: BucketPosition =>
                if (buckets.hasNext) {
                  val data = buckets.next()
                  if (!isRevertedBucket(data)) {
                    block(bucketPosition, data)
                  }
                }
              }
            }
        }
    })

  private def withBucketsFromZarr3Zip(zipFile: File)(block: (BucketPosition, Array[Byte]) => Unit): Box[Unit] =
    for {
      firstHeaderFilePath <- option2Box(
        ZipIO.entries(new ZipFile(zipFile)).find(entry => entry.getName.endsWith(Zarr3ArrayHeader.FILENAME_ZARR_JSON)))
      firstHeaderString <- ZipIO.readAt(new ZipFile(zipFile), firstHeaderFilePath)
      firstHeader <- JsonHelper.parseAndValidateJson[Zarr3ArrayHeader](firstHeaderString)
      _ <- firstHeader.assertValid
      _ <- ZipIO.withUnziped(zipFile) {
        case (filename, inputStream) =>
          if (filename.endsWith(Zarr3ArrayHeader.FILENAME_ZARR_JSON)) ()
          else {
            parseZarrChunkPath(filename.toString, firstHeader).map { bucketPosition =>
              val dataCompressed = IOUtils.toByteArray(inputStream)
              val data = compressor.decompress(dataCompressed)
              block(bucketPosition, data)
            }
          }
      }
    } yield ()

  private def parseZarrChunkPath(path: String, zarr3ArrayHeader: Zarr3ArrayHeader): Option[BucketPosition] = {
    val dimensionNames = zarr3ArrayHeader.dimension_names.getOrElse(Array("x", "y", "z"))
    val additionalAxesNames: Seq[String] = dimensionNames.toSeq.drop(1).dropRight(3) // drop channel left, and xyz right

    // assume additionalAxes,x,y,z
    val chunkPathRegex = s"(|.*/)(\\d+|\\d+-\\d+-\\d+)/c\\.(.+)".r

    path match {
      case chunkPathRegex(_, magStr, dimsStr) =>
        val dims: Seq[String] = dimsStr.split("\\.").toSeq
        val additionalAxesDims = dims.drop(1).dropRight(3) // drop channel left, and xyz right
        val additionalCoordinates: Seq[AdditionalCoordinate] = additionalAxesNames.zip(additionalAxesDims).map {
          case (name, coordinateValue) => AdditionalCoordinate(name, coordinateValue.toInt)
        }

        val bucketX = dims(dims.length - 3)
        val bucketY = dims(dims.length - 2)
        val bucketZ = dims.last

        Vec3Int.fromMagLiteral(magStr, allowScalar = true).map { mag =>
          BucketPosition(
            bucketX.toInt * mag.x * DataLayer.bucketLength,
            bucketY.toInt * mag.y * DataLayer.bucketLength,
            bucketZ.toInt * mag.z * DataLayer.bucketLength,
            mag,
            if (additionalCoordinates.isEmpty) None else Some(additionalCoordinates)
          )
        }
      case _ =>
        None
    }
  }

  protected def resolutionSetFromZipfile(zipFile: File): Set[Vec3Int] = {
    val resolutionSet = new mutable.HashSet[Vec3Int]()
    ZipIO.withUnziped(zipFile) {
      case (fileName, _) =>
        getMagFromWkwOrZarrHeaderFilePath(fileName.toString).map { mag: Vec3Int =>
          resolutionSet.add(mag)
        }
    }
    resolutionSet.toSet
  }

  private def getMagFromWkwOrZarrHeaderFilePath(path: String): Option[Vec3Int] = {
    val wkwHeaderRx = s"(|.*/)(\\d+|\\d+-\\d+-\\d+)/$headerFileName".r
    val zarr3HeaderRx = s"(|.*/)(\\d+-\\d+-\\d+)/${Zarr3ArrayHeader.FILENAME_ZARR_JSON}".r
    path match {
      case wkwHeaderRx(_, magLiteral) =>
        Vec3Int.fromMagLiteral(magLiteral, allowScalar = true)
      case zarr3HeaderRx(_, magLiteral) =>
        Vec3Int.fromMagLiteral(magLiteral, allowScalar = true)
      case _ => None
    }
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

  private lazy val compressor =
    new BloscCompressor(
      Map(
        BloscCompressor.keyCname -> StringCompressionSetting(BloscCompressor.defaultCname),
        BloscCompressor.keyClevel -> IntCompressionSetting(BloscCompressor.defaultCLevel),
        BloscCompressor.keyShuffle -> IntCompressionSetting(BloscCompressor.defaultShuffle),
        BloscCompressor.keyBlocksize -> IntCompressionSetting(BloscCompressor.defaultBlocksize),
        BloscCompressor.keyTypesize -> IntCompressionSetting(BloscCompressor.defaultTypesize)
      ))
}
