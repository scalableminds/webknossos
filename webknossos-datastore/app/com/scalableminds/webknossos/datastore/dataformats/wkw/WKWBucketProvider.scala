package com.scalableminds.webknossos.datastore.dataformats.wkw

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, DataCubeHandle}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService
import com.scalableminds.webknossos.wrap.WKWFile
import net.liftweb.common.{Empty, Failure, Full}

import java.nio.file.Path
import scala.concurrent.ExecutionContext

class WKWCubeHandle(wkwFile: WKWFile, wkwFilePath: Path) extends DataCubeHandle with FoxImplicits {

  def cutOutBucket(bucket: BucketPosition)(implicit ec: ExecutionContext): Fox[Array[Byte]] = {
    val numBlocksPerCubeDimension = wkwFile.header.numBlocksPerCubeDimension
    val blockOffsetX = bucket.bucketX % numBlocksPerCubeDimension
    val blockOffsetY = bucket.bucketY % numBlocksPerCubeDimension
    val blockOffsetZ = bucket.bucketZ % numBlocksPerCubeDimension
    try {
      wkwFile.readBlock(blockOffsetX, blockOffsetY, blockOffsetZ)
    } catch {
      case e: InternalError =>
        Failure(s"${e.getMessage} while reading block from $wkwFilePath, realpath ${wkwFilePath.toRealPath()}",
                Full(e),
                Empty).toFox
    }
  }

  override protected def onFinalize(): Unit =
    wkwFile.close()
}

class WKWBucketProvider(layer: WKWLayer) extends BucketProvider with WKWDataFormatHelper {

  override def remoteSourceDescriptorServiceOpt: Option[RemoteSourceDescriptorService] = None

  override def loadFromUnderlying(readInstruction: DataReadInstruction)(
      implicit ec: ExecutionContext): Fox[WKWCubeHandle] = {
    val wkwFile = wkwFilePath(
      readInstruction.cube,
      Some(readInstruction.dataSource.id),
      Some(readInstruction.dataLayer.name),
      readInstruction.baseDir,
      resolutionAsTriple = Some(false)
    ).toFile

    if (wkwFile.exists()) {
      WKWFile(wkwFile).map(new WKWCubeHandle(_, wkwFile.toPath))
    } else {
      val wkwFileAnisotropic = wkwFilePath(
        readInstruction.cube,
        Some(readInstruction.dataSource.id),
        Some(readInstruction.dataLayer.name),
        readInstruction.baseDir,
        resolutionAsTriple = Some(true)
      ).toFile
      if (wkwFileAnisotropic.exists) {
        WKWFile(wkwFileAnisotropic).map(new WKWCubeHandle(_, wkwFileAnisotropic.toPath))
      } else {
        Empty
      }
    }
  }
}
