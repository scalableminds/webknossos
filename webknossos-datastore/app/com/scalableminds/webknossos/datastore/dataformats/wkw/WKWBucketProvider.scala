package com.scalableminds.webknossos.datastore.dataformats.wkw

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, DataCubeHandle}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.wrap.WKWFile
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty}

import scala.concurrent.{ExecutionContext, Future}

class WKWCubeHandle(wkwFile: WKWFile) extends DataCubeHandle with FoxImplicits {

  def cutOutBucket(bucket: BucketPosition)(implicit ec: ExecutionContext): Fox[Array[Byte]] = {
    val numBlocksPerCubeDimension = wkwFile.header.numBlocksPerCubeDimension
    val blockOffsetX = bucket.x % numBlocksPerCubeDimension
    val blockOffsetY = bucket.y % numBlocksPerCubeDimension
    val blockOffsetZ = bucket.z % numBlocksPerCubeDimension
    Fox(Future.successful(wkwFile.readBlock(blockOffsetX, blockOffsetY, blockOffsetZ)))
  }

  override protected def onFinalize(): Unit =
    wkwFile.close()
}

class WKWBucketProvider(layer: WKWLayer) extends BucketProvider with WKWDataFormatHelper with LazyLogging {

  override def loadFromUnderlying(readInstruction: DataReadInstruction): Box[WKWCubeHandle] = {
    val wkwFile = wkwFilePath(
      readInstruction.cube,
      Some(readInstruction.dataSource.id),
      Some(readInstruction.dataLayer.name),
      readInstruction.baseDir,
      resolutionAsTriple = Some(false)
    ).toFile

    if (wkwFile.exists()) {
      WKWFile(wkwFile).map(new WKWCubeHandle(_))
    } else {
      val wkwFileAnisotropic = wkwFilePath(
        readInstruction.cube,
        Some(readInstruction.dataSource.id),
        Some(readInstruction.dataLayer.name),
        readInstruction.baseDir,
        resolutionAsTriple = Some(true)
      ).toFile
      if (wkwFileAnisotropic.exists) {
        WKWFile(wkwFileAnisotropic).map(new WKWCubeHandle(_))
      } else {
        Empty
      }
    }
  }
}
