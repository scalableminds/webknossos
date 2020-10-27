package com.scalableminds.webknossos.datastore.dataformats.wkw

import java.lang.Thread.sleep

import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, Cube}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.wrap.WKWFile
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty}

import scala.concurrent.ExecutionContext

class WKWCube(wkwFile: WKWFile) extends Cube {

  def cutOutBucket(dataLayer: DataLayer, bucket: BucketPosition): Box[Array[Byte]] = {
    val numBlocksPerCubeDimension = wkwFile.header.numBlocksPerCubeDimension
    val blockOffsetX = bucket.x % numBlocksPerCubeDimension
    val blockOffsetY = bucket.y % numBlocksPerCubeDimension
    val blockOffsetZ = bucket.z % numBlocksPerCubeDimension
    wkwFile.readBlock(blockOffsetX, blockOffsetY, blockOffsetZ)
  }

  override protected def onFinalize(): Unit =
    wkwFile.close()
}

class WKWBucketProvider(layer: WKWLayer)
    extends BucketProvider
    with WKWDataFormatHelper
    with FoxImplicits
    with LazyLogging {

  override def loadFromUnderlying(readInstruction: DataReadInstruction): Box[WKWCube] = {

    //sleep(21000)

    val wkwFile = wkwFilePath(
      readInstruction.cube,
      Some(readInstruction.dataSource.id),
      Some(readInstruction.dataLayer.name),
      readInstruction.baseDir,
      resolutionAsTriple = false
    ).toFile

    if (wkwFile.exists()) {
      WKWFile(wkwFile).map(new WKWCube(_))
    } else {
      val wkwFileAnisotropic = wkwFilePath(
        readInstruction.cube,
        Some(readInstruction.dataSource.id),
        Some(readInstruction.dataLayer.name),
        readInstruction.baseDir,
        resolutionAsTriple = true
      ).toFile
      if (wkwFileAnisotropic.exists) {
        WKWFile(wkwFileAnisotropic).map(new WKWCube(_))
      } else {
        Empty
      }
    }
  }
}
