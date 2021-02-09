package com.scalableminds.webknossos.datastore.dataformats.wkw

import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, SafeCachable}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.wrap.WKWFile
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty}

class WKWCube(wkwFile: WKWFile) extends SafeCachable {

  def cutOutBucket(bucket: BucketPosition): Box[Array[Byte]] = {
    val numBlocksPerCubeDimension = wkwFile.header.numBlocksPerCubeDimension
    val blockOffsetX = bucket.x % numBlocksPerCubeDimension
    val blockOffsetY = bucket.y % numBlocksPerCubeDimension
    val blockOffsetZ = bucket.z % numBlocksPerCubeDimension
    wkwFile.readBlock(blockOffsetX, blockOffsetY, blockOffsetZ)
  }

  override protected def onFinalize(): Unit =
    wkwFile.close()
}

class WKWBucketProvider(layer: WKWLayer) extends BucketProvider with WKWDataFormatHelper with LazyLogging {

  override def loadFromUnderlying(readInstruction: DataReadInstruction): Box[WKWCube] = {
    val wkwFile = wkwFilePath(
      readInstruction.cube,
      Some(readInstruction.dataSource.id),
      Some(readInstruction.dataLayer.name),
      readInstruction.baseDir,
      resolutionAsTriple = Some(false)
    ).toFile

    if (wkwFile.exists()) {
      WKWFile(wkwFile).map(new WKWCube(_))
    } else {
      val wkwFileAnisotropic = wkwFilePath(
        readInstruction.cube,
        Some(readInstruction.dataSource.id),
        Some(readInstruction.dataLayer.name),
        readInstruction.baseDir,
        resolutionAsTriple = Some(true)
      ).toFile
      if (wkwFileAnisotropic.exists) {
        WKWFile(wkwFileAnisotropic).map(new WKWCube(_))
      } else {
        Empty
      }
    }
  }
}
