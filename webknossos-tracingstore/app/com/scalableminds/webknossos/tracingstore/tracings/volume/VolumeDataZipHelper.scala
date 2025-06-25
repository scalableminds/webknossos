package com.scalableminds.webknossos.tracingstore.tracings.volume

import java.io.{File, FileOutputStream, InputStream}
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.io.ZipIO
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
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
import com.scalableminds.webknossos.datastore.dataformats.wkw.WKWFile
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.util.tools.Box
import com.scalableminds.util.tools.Box.tryo
import org.apache.commons.io.IOUtils

import java.util.zip.{ZipEntry, ZipFile}
import scala.collection.mutable
import scala.concurrent.ExecutionContext

trait VolumeDataZipHelper extends WKWDataFormatHelper with ReversionHelper with FoxImplicits with LazyLogging {

  protected def withBucketsFromZip(zipFile: File)(block: (BucketPosition, Array[Byte]) => Fox[Unit])(
      implicit ec: ExecutionContext): Fox[Unit] =
    for {
      format <- detectVolumeDataZipFormat(zipFile).toFox
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

  private def withBucketsFromWkwZip(zipFile: File)(block: (BucketPosition, Array[Byte]) => Fox[Unit])(
      implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- ZipIO.withUnzipedAsync(zipFile) {
        case (fileName, is) if fileName.toString.endsWith(".wkw") && !fileName.toString.endsWith("header.wkw") =>
          WKWFile.read(is) {
            case (header, buckets) =>
              if (header.numChunksPerShard == 1) {
                parseWKWFilePath(fileName.toString).map { bucketPosition: BucketPosition =>
                  if (buckets.hasNext) {
                    val data = buckets.next()
                    if (!isRevertedElement(data)) {
                      block(bucketPosition, data)
                    } else Fox.successful(())
                  } else Fox.successful(())
                }.getOrElse(Fox.successful(()))
              } else Fox.successful(())
            case _ => Fox.successful(())
          }
        case _ => Fox.successful(())
      }
    } yield ()

  private def withBucketsFromZarr3Zip(zipFile: File)(block: (BucketPosition, Array[Byte]) => Fox[Unit])(
      implicit ec: ExecutionContext): Fox[Unit] =
    for {
      firstHeaderFilePath <- ZipIO
        .entries(new ZipFile(zipFile))
        .find(entry => entry.getName.endsWith(Zarr3ArrayHeader.FILENAME_ZARR_JSON))
        .toFox
      firstHeaderString <- ZipIO.readAt(new ZipFile(zipFile), firstHeaderFilePath).toFox
      firstHeader <- JsonHelper.parseAs[Zarr3ArrayHeader](firstHeaderString).toFox
      _ <- firstHeader.assertValid.toFox
      _ <- ZipIO.withUnzipedAsync(zipFile) {
        case (filename, inputStream) =>
          if (filename.endsWith(Zarr3ArrayHeader.FILENAME_ZARR_JSON)) Fox.successful(())
          else {
            parseZarrChunkPath(filename.toString, firstHeader).map { bucketPosition =>
              val dataCompressed = IOUtils.toByteArray(inputStream)
              val data = compressor.decompress(dataCompressed)
              block(bucketPosition, data)
            }.getOrElse(Fox.successful(()))
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

  protected def magSetFromZipfile(zipFile: File): Set[Vec3Int] = {
    val magSet = new mutable.HashSet[Vec3Int]()
    ZipIO.withUnziped(zipFile) {
      case (fileName, _) =>
        getMagFromWkwOrZarrHeaderFilePath(fileName.toString).map { mag: Vec3Int =>
          magSet.add(mag)
        }
    }
    magSet.toSet
  }

  private def getMagFromWkwOrZarrHeaderFilePath(path: String): Option[Vec3Int] = {
    val wkwHeaderRx = s"(|.*/)(\\d+|\\d+-\\d+-\\d+)/$FILENAME_HEADER_WKW".r
    val zarr3HeaderRx = s"(|.*/)(\\d+-\\d+-\\d+)/${Zarr3ArrayHeader.FILENAME_ZARR_JSON}".r
    path match {
      case wkwHeaderRx(_, magLiteral) =>
        Vec3Int.fromMagLiteral(magLiteral, allowScalar = true)
      case zarr3HeaderRx(_, magLiteral) =>
        Vec3Int.fromMagLiteral(magLiteral, allowScalar = true)
      case _ => None
    }
  }

  protected def withZipsFromMultiZipAsync(multiZip: File)(block: (Int, File) => Fox[Unit])(
      implicit ec: ExecutionContext): Fox[Unit] = {
    var index: Int = 0
    val unzipResult = ZipIO.withUnzipedAsync(multiZip) {
      case (_, is) =>
        for {
          res <- block(index, inputStreamToTempfile(is))
          _ = index += 1
        } yield res
      case _ => Fox.successful(())
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
