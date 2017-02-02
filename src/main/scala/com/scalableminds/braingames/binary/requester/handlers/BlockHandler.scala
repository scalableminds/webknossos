/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.requester.handlers

import java.util.concurrent.atomic.AtomicInteger

import com.scalableminds.braingames.binary.models._
import com.scalableminds.braingames.binary.requester.{Cube, DataCache}
import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import play.api.libs

import scala.concurrent.{Await, Future}
import scala.concurrent.duration.FiniteDuration

trait BlockHandler extends DataCache with LazyLogging {
  protected def loadFromUnderlying[T](loadBlock: LoadBlock, timeout: FiniteDuration)(f: Cube => T): Fox[T]

  protected def saveToUnderlying(saveBlock: SaveBlock, timeout: FiniteDuration): Fox[Boolean]

  def save(saveBlock: SaveBlock, timeout: FiniteDuration): Fox[Boolean] = {
    saveToUnderlying(saveBlock, timeout)
  }

  def load(loadBlock: LoadBlock, timeout: FiniteDuration, useCache: Boolean): Fox[Array[Byte]] = {
    val cubePosition = loadBlock.dataSource.pointToCube(loadBlock.block, loadBlock.resolution)
    val requestedCube = loadBlock.copy(block = cubePosition)
    val requestedBucket = loadBlock.copy(block = loadBlock.dataSource.applyResolution(loadBlock.block, loadBlock.resolution))
    val withCubeResource =
      if (useCache)
        withCache[Array[Byte]](requestedCube)(loadFromUnderlying(requestedCube, timeout)) _
      else
        loadFromUnderlying[Array[Byte]](requestedCube, timeout) _
    withCubeResource { cube =>
      val bucket = cutOutBucket(requestedBucket, cube)
      if (requestedBucket.settings.useHalfByte)
        convertToHalfByte(bucket)
      else
        bucket
    }
  }

  private def convertToHalfByte(a: Array[Byte]) = {
    val aSize = a.length
    val compressedSize = if (aSize % 2 == 0) aSize / 2 else aSize / 2 + 1
    val compressed = new Array[Byte](compressedSize)
    var i = 0
    while (i * 2 + 1 < aSize) {
      val first = (a(i * 2) & 0xF0).toByte
      val second = (a(i * 2 + 1) & 0xF0).toByte >> 4 & 0x0F
      val value = (first | second).asInstanceOf[Byte]
      compressed(i) = value
      i += 1
    }
    compressed
  }

  protected def cutOutBucket(requestedCube: LoadBlock, cube: Cube): Array[Byte]
}
