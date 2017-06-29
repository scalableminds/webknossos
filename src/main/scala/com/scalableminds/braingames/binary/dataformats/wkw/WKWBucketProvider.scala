/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.dataformats.wkw

import com.scalableminds.braingames.binary.dataformats.{BucketProvider, Cube}
import com.scalableminds.braingames.binary.models.BucketPosition
import com.scalableminds.braingames.binary.models.datasource.DataLayer
import com.scalableminds.braingames.binary.models.requests.DataReadInstruction
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

class WKWBucketProvider(layer: WKWLayer) extends BucketProvider with FoxImplicits with LazyLogging {

  override def loadFromUnderlying(readInstruction: DataReadInstruction): Fox[WKWCube] = {
    val wkwFile = readInstruction.baseDir
      .resolve(readInstruction.dataSource.id.team)
      .resolve(readInstruction.dataSource.id.name)
      .resolve(readInstruction.dataLayer.name)
      .resolve(readInstruction.cube.resolution.toString)
      .resolve(s"z${readInstruction.cube.z}")
      .resolve(s"y${readInstruction.cube.y}")
      .resolve(s"x${readInstruction.cube.x}.${WKWDataFormat.dataFileExtension}")
      .toFile

    if (wkwFile.exists()) {
      WKWFile(wkwFile).map(new WKWCube(_))
    } else {
      Empty
    }
  }
}
