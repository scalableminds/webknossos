/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.requester.handlers

import java.nio.file.Paths

import com.scalableminds.braingames.binary.models._
import com.scalableminds.braingames.binary.requester.{Cube, DataCubeCache}
import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.concurrent.Execution.Implicits._
import play.api.Play.current
import play.api.i18n.Messages.Implicits._
import java.nio.file.Paths

import com.scalableminds.braingames.binary.requester.{CachedBlock, Cube, DataCache, DataCubeCache}
import com.scalableminds.util.cache.LRUConcurrentCache

import scala.concurrent.duration.FiniteDuration

class WebKnossosWrapCube(underlying: Array[Byte]) extends Cube{
  override def copyTo(offset: Long, other: Array[Byte], destPos: Int, length: Int): Boolean = {
    // TODO: FIX. convert to long !!!!!
    System.arraycopy(underlying, offset.toInt, other, destPos, length)
    true
  }
}

class WebKnossosWrapBlockHandler(val cache: DataCubeCache) extends BlockHandler
  with FoxImplicits
  with LazyLogging {

  override def loadFromUnderlying[T](loadBlock: LoadBlock, timeout: FiniteDuration)(f: Cube => T): Fox[T] = {
    val wkwDataSource = new WebKnossosWrapDataSource(Paths.get(loadBlock.dataSource.baseDir))

    for {
      layer <- wkwDataSource.getLayer(loadBlock.dataLayer.name) ?~> "Could not find webKnossosWrap layer."
      data <- layer.load(loadBlock)
    } yield {
      f(new WebKnossosWrapCube(data))
    }
  }

  // TODO: remove as soon as we do not load 128 sized buckets anymore but 32 sized cubes on demand
  protected def cutOutBucket(requestedCube: LoadBlock, cube: Cube): Array[Byte] = {
    val offset: Point3D = requestedCube.block
    val bytesPerElement: Int = requestedCube.dataLayer.bytesPerElement
    val bucketLength: Int = requestedCube.dataSource.lengthOfLoadedBuckets
    val cubeLength: Int = requestedCube.dataSource.blockLength
    val bucketSize = bytesPerElement * bucketLength * bucketLength * bucketLength
    val result = new Array[Byte](bucketSize)

    val x = offset.x
    var y = offset.y
    var z = offset.z

    val yMax = offset.y + bucketLength
    val zMax = offset.z + bucketLength

    var idx = 0
    while (z < zMax) {
      y = offset.y
      while (y < yMax) {
        val cubeOffset =
          (x % cubeLength +
            y % cubeLength * cubeLength +
            z % cubeLength * cubeLength * cubeLength) * bytesPerElement
        if (!cube.copyTo(cubeOffset, result, idx, bucketLength * bytesPerElement))
          logger.warn(s"Failed to copy from cube to bucket. " +
            s"DS: ${requestedCube.dataSource.id}/${requestedCube.dataLayer.name} Bucket: ${requestedCube.block}")
        idx += bucketLength * bytesPerElement
        y += 1
      }
      z += 1
    }

    result
  }

  override def saveToUnderlying(saveBlock: SaveBlock, bucket: Point3D, timeout: FiniteDuration): Fox[Boolean] = {
    logger.error("WebKnossosWrap does not support saving data yet.")
    Fox.successful(false)
  }
}
