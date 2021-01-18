package com.scalableminds.webknossos.tracingstore.tracings.volume

import java.io.{File, FileOutputStream, InputStream}

import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.io.ZipIO
import com.scalableminds.util.tools.ByteUtils
import com.scalableminds.webknossos.datastore.dataformats.wkw.WKWDataFormatHelper
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.wrap.WKWFile
import net.liftweb.common.Box
import org.apache.commons.io.IOUtils

import scala.collection.mutable

trait VolumeDataZipHelper extends WKWDataFormatHelper with ByteUtils {

  protected def withBucketsFromZip(zipFile: File)(block: (BucketPosition, Array[Byte]) => Unit): Box[Unit] = {
    val unzipResult = ZipIO.withUnziped(zipFile) {
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
    unzipResult.map(_ => ())
  }

  protected def resolutionSetFromZipfile(zipFile: File): Set[Point3D] = {
    val resolutionSet = new mutable.HashSet[Point3D]()
    ZipIO.withUnziped(zipFile) {
      case (fileName, _) =>
        parseWKWFilePath(fileName.toString).map { bucketPosition: BucketPosition =>
          resolutionSet.add(bucketPosition.resolution)
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
