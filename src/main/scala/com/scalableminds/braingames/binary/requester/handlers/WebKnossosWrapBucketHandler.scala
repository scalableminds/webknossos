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

import com.scalableminds.webknossos.wrap.WKWFile
import net.liftweb.common.Box

class WebKnossosWrapCube(wkwFile: WKWFile) extends Cube {
  def cutOutBucket(requestedBucket: BucketReadInstruction): Box[Array[Byte]] = {
    assert(requestedBucket.dataSource.blockSize ==  wkwFile.header.numVoxelsPerBlockDimension)

    val numBlocksPerCubeDimension = wkwFile.header.numBlocksPerCubeDimension
    val blockOffsetX = requestedBucket.position.x % numBlocksPerCubeDimension
    val blockOffsetY = requestedBucket.position.y % numBlocksPerCubeDimension
    val blockOffsetZ = requestedBucket.position.z % numBlocksPerCubeDimension

    wkwFile.readBlock(blockOffsetX, blockOffsetY, blockOffsetZ)
  }
}

class WebKnossosWrapBucketHandler(val cache: DataCubeCache) extends BucketHandler
  with FoxImplicits
  with LazyLogging {

  override def loadFromUnderlying[T](
    loadBlock: CubeReadInstruction, timeout: FiniteDuration)(f: Cube => Box[T]): Fox[T] = {
    val wkwDataSource = new WebKnossosWrapDataSource(Paths.get(loadBlock.dataSource.baseDir))

    for {
      layer <- wkwDataSource.getLayer(loadBlock.dataLayer.name) ?~> "Could not find webKnossosWrap layer."
      wkwFile <- layer.load(loadBlock.dataLayer.baseDir, loadBlock.position)
      result <- f(new WebKnossosWrapCube(wkwFile))
    } yield result
  }

  override def saveToUnderlying(saveBlock: BucketWriteInstruction, timeout: FiniteDuration): Fox[Boolean] = {
    logger.error("WebKnossosWrap does not support saving data yet.")
    Fox.successful(false)
  }
}
