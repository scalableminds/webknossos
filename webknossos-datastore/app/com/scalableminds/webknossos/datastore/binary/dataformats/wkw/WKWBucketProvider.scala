/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.binary.dataformats.wkw

import com.scalableminds.webknossos.datastore.binary.dataformats.{BucketProvider, Cube}
import com.scalableminds.webknossos.datastore.binary.models.BucketPosition
import com.scalableminds.webknossos.datastore.binary.models.datasource.DataLayer
import com.scalableminds.webknossos.datastore.binary.models.requests.DataReadInstruction
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.wrap.WKWFile
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty}

import scala.concurrent.ExecutionContext.Implicits.global

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

  override def loadFromUnderlying(readInstruction: DataReadInstruction): Fox[WKWCube] = {

    val wkwFile = wkwFilePath(
      readInstruction.cube,
      Some(readInstruction.dataSource.id),
      Some(readInstruction.dataLayer.name),
      readInstruction.baseDir).toFile

    // TODO: this should probably be handled in a different place
    if (wkwFile.exists()) {
      WKWFile(wkwFile).map(new WKWCube(_))
    } else {
      Empty
    }
  }
}
