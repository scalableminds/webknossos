package com.scalableminds.webknossos.datastore.dataformats.wkw

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, DataCubeHandle}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService
import com.scalableminds.webknossos.datastore.dataformats.wkw.WKWFile
import net.liftweb.common.{Empty, Failure, Full}

import java.nio.file.Path
import scala.concurrent.ExecutionContext

class WKWCubeHandleLegacy(wkwFile: WKWFile, wkwFilePath: Path) extends DataCubeHandle with FoxImplicits {

  def cutOutBucket(bucket: BucketPosition, dataLayer: DataLayer)(implicit ec: ExecutionContext): Fox[Array[Byte]] = {
    val numChunksPerShardDimension = wkwFile.header.numChunksPerShardDimension
    val chunkOffsetX = bucket.bucketX % numChunksPerShardDimension
    val chunkOffsetY = bucket.bucketY % numChunksPerShardDimension
    val chunkOffsetZ = bucket.bucketZ % numChunksPerShardDimension
    try {
      wkwFile.readChunk(chunkOffsetX, chunkOffsetY, chunkOffsetZ)
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

class WKWBucketProviderLegacy(layer: WKWLayer) extends BucketProvider with WKWDataFormatHelper {

  override def remoteSourceDescriptorServiceOpt: Option[RemoteSourceDescriptorService] = None

  override def openShardOrArrayHandle(readInstruction: DataReadInstruction)(
      implicit ec: ExecutionContext): Fox[WKWCubeHandleLegacy] = {
    val wkwFile = wkwFilePath(
      readInstruction.cube,
      Some(readInstruction.dataSource.id),
      Some(readInstruction.dataLayer.name),
      readInstruction.baseDir,
      resolutionAsTriple = Some(false)
    ).toFile

    if (wkwFile.exists()) {
      WKWFile(wkwFile).map(new WKWCubeHandleLegacy(_, wkwFile.toPath))
    } else {
      val wkwFileAnisotropic = wkwFilePath(
        readInstruction.cube,
        Some(readInstruction.dataSource.id),
        Some(readInstruction.dataLayer.name),
        readInstruction.baseDir,
        resolutionAsTriple = Some(true)
      ).toFile
      if (wkwFileAnisotropic.exists) {
        WKWFile(wkwFileAnisotropic).map(new WKWCubeHandleLegacy(_, wkwFileAnisotropic.toPath))
      } else {
        Empty
      }
    }
  }
}
