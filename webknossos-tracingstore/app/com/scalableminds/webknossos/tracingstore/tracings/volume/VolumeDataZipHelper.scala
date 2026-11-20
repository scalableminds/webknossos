package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.box.Box
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.io.ZipIO
import com.scalableminds.util.box.Box.tryo
import com.scalableminds.util.tools.{Fox, JsonHelper}
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.dataformats.wkw.{WKWDataFormatHelper, WKWFile}
import com.scalableminds.webknossos.datastore.datareaders.zarr3.{BloscCodec, BloscCodecConfiguration, Zarr3ArrayHeader}
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, BucketPosition}
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeDataZipFormat.VolumeDataZipFormat
import com.typesafe.scalalogging.LazyLogging
import org.apache.commons.io.IOUtils

import java.io.{File, FileOutputStream}
import java.nio.file.Path
import java.util.zip.{ZipEntry, ZipFile}
import scala.collection.mutable
import scala.concurrent.ExecutionContext
import scala.util.Using

trait VolumeDataZipHelper extends WKWDataFormatHelper with ReversionHelper with LazyLogging {

  protected def withBucketsFromZip(
      zipFile: File
  )(block: (BucketPosition, Array[Byte]) => Fox[Unit])(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      format <- detectVolumeDataZipFormat(zipFile).toFox
      _ <-
        if (format == VolumeDataZipFormat.wkw)
          withBucketsFromWkwZip(zipFile)(block)
        else withBucketsFromZarr3Zip(zipFile)(block)
    } yield ()

  private def detectVolumeDataZipFormat(zipFile: File): Box[VolumeDataZipFormat] =
    tryo(Using.resource(new ZipFile(zipFile)) { zip =>
      val relevantFile: Option[ZipEntry] =
        ZipIO.entries(zip).find(entry => entry.getName.endsWith("zarr.json") || entry.getName.endsWith(".wkw"))
      if (relevantFile.exists(_.getName.endsWith("zarr.json"))) {
        VolumeDataZipFormat.zarr3
      } else VolumeDataZipFormat.wkw
    })

  private def withBucketsFromWkwZip(
      zipFile: File
  )(block: (BucketPosition, Array[Byte]) => Fox[Unit])(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- ZipIO.withUnzipedAsync(zipFile) {
        case (fileName, is) if fileName.toString.endsWith(".wkw") && !fileName.toString.endsWith("header.wkw") =>
          WKWFile.read(is) { case (header, buckets) =>
            if (header.numChunksPerShard == 1) {
              parseWKWFilePath(fileName.toString).map { (bucketPosition: BucketPosition) =>
                if (buckets.hasNext) {
                  val data = buckets.next()
                  if (!isRevertedElement(data)) {
                    block(bucketPosition, data)
                  } else Fox.successful(())
                } else Fox.successful(())
              }.getOrElse(Fox.successful(()))
            } else Fox.successful(())
          }
        case _ => Fox.successful(())
      }
    } yield ()

  private def withBucketsFromZarr3Zip(
      zipFile: File
  )(block: (BucketPosition, Array[Byte]) => Fox[Unit])(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      firstHeaderString <- tryo(Using.resource(new ZipFile(zipFile)) { zip =>
        for {
          firstHeaderEntry <- Box.fromOption(
            ZipIO.entries(zip).find(entry => entry.getName.endsWith(Zarr3ArrayHeader.FILENAME_ZARR_JSON))
          )
          headerBytes <- ZipIO.readAt(zip, firstHeaderEntry)
        } yield headerBytes
      }).flatMap(identity).toFox
      firstHeader <- JsonHelper.parseAs[Zarr3ArrayHeader](firstHeaderString).toFox
      _ <- firstHeader.assertValid.toFox
      _ <- ZipIO.withUnzipedAsync(zipFile) { case (filename, inputStream) =>
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

  protected def parseZarrChunkPath(path: String, zarr3ArrayHeader: Zarr3ArrayHeader): Option[BucketPosition] = {
    val dimensionNames = zarr3ArrayHeader.dimension_names.getOrElse(Array("x", "y", "z"))
    val additionalAxesNames: Seq[String] = dimensionNames.toSeq.drop(1).dropRight(3) // drop channel left, and xyz right

    // assume additionalAxes,x,y,z
    // the c. at the beginning of chunk names is optional
    // (used in "default" chunk encoding, which was used for volume downloads previously)
    val chunkPathRegex = """^(?:[^/]*+/)*(\d+-\d+-\d+|\d+)/(?:c\.)?(.+)$""".r

    path match {
      case chunkPathRegex(magStr, dimsStr) =>
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
    ZipIO.withUnziped(zipFile) { case (fileName, _) =>
      getMagFromWkwOrZarrHeaderFilePath(fileName.toString).map { (mag: Vec3Int) =>
        magSet.add(mag)
      }
    }
    magSet.toSet
  }

  protected def getMagFromWkwOrZarrHeaderFilePath(path: String): Option[Vec3Int] = {
    val wkwHeaderRx = """(?:[^/]*/)*(\d+-\d+-\d+|\d+)/header.wkw$""".r
    val zarr3HeaderRx = """(?:[^/]*/)*(\d+-\d+-\d+|\d+)/zarr.json$""".r
    path match {
      case wkwHeaderRx(magLiteral) =>
        Vec3Int.fromMagLiteral(magLiteral, allowScalar = true)
      case zarr3HeaderRx(magLiteral) =>
        Vec3Int.fromMagLiteral(magLiteral, allowScalar = true)
      case _ => None
    }
  }

  // Returns the inner zips in entry order
  protected def unzipMultiZip(multiZip: File, targetDir: Path): Box[List[File]] = {
    var index: Int = 0
    ZipIO.withUnziped(multiZip) { case (_, inputStream) =>
      val file = targetDir.resolve(s"$index.zip").toFile
      index += 1
      Using.resource(new FileOutputStream(file))(IOUtils.copy(inputStream, _))
      file
    }
  }

  private lazy val compressor = BloscCodec.fromConfiguration(BloscCodecConfiguration.defaultForWKZarrOutput).compressor

}
