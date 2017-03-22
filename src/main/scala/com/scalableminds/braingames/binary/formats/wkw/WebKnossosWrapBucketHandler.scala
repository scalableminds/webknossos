/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.requester.handlers

import java.nio.file.Paths

import com.scalableminds.braingames.binary.models._
import com.scalableminds.braingames.binary.requester.{Cube, DataCubeCache}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.concurrent.Execution.Implicits._

import scala.concurrent.duration.FiniteDuration
import play.api.i18n.Messages.Implicits._
import play.api.Play.current
import java.nio.file.Paths

import com.scalableminds.braingames.binary.formats.wkw.WebKnossosWrapDataSource
import com.scalableminds.webknossos.wrap.WKWFile
import net.liftweb.common.{Box, Failure}

class WebKnossosWrapCube(wkwFile: WKWFile) extends Cube {
  def cutOutBucket(requestedBucket: BucketReadInstruction): Box[Array[Byte]] = {
    if(requestedBucket.dataSource.lengthOfLoadedBuckets !=  wkwFile.header.numVoxelsPerBlockDimension){
      return Failure(s"Invalid bucket length. ${requestedBucket.dataSource.lengthOfLoadedBuckets}, " +
        s"${wkwFile.header.numVoxelsPerBlockDimension}")
    }

    val numBlocksPerCubeDimension = wkwFile.header.numBlocksPerCubeDimension
    val blockOffsetX = requestedBucket.position.x % numBlocksPerCubeDimension
    val blockOffsetY = requestedBucket.position.y % numBlocksPerCubeDimension
    val blockOffsetZ = requestedBucket.position.z % numBlocksPerCubeDimension

    wkwFile.readBlock(blockOffsetX, blockOffsetY, blockOffsetZ)
  }

  override protected def onFinalize(): Unit = {
    wkwFile.close()
  }
}

class WebKnossosWrapBucketHandler(val cache: DataCubeCache) extends BucketHandler
  with FoxImplicits
  with LazyLogging {

  override def loadFromUnderlying(
    loadBlock: CubeReadInstruction, timeout: FiniteDuration): Fox[Cube] = {
    val wkwDataSource = new WebKnossosWrapDataSource(Paths.get(loadBlock.dataSource.baseDir))

    for {
      layer <- wkwDataSource.getLayer(loadBlock.dataLayer.name) ?~> "Could not find webKnossosWrap layer."
      wkwFile <- layer.load(loadBlock.dataLayer.baseDir, loadBlock.position)
    } yield new WebKnossosWrapCube(wkwFile)
  }

  override def saveToUnderlying(saveBlock: BucketWriteInstruction, timeout: FiniteDuration): Fox[Boolean] = {
    logger.error("WebKnossosWrap does not support saving data yet.")
    Fox.successful(false)
  }
}
