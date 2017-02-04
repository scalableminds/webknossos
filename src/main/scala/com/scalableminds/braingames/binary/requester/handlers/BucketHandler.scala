/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.requester.handlers


import com.scalableminds.braingames.binary.models._
import com.scalableminds.braingames.binary.requester.{Cube, DataCache}
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box

import scala.concurrent.duration.FiniteDuration

trait BucketHandler extends DataCache with LazyLogging {
  protected def loadFromUnderlying[T](loadCube: CubeReadInstruction, timeout: FiniteDuration)(f: Cube => Box[T]): Fox[T]

  protected def saveToUnderlying(saveBucket: BucketWriteInstruction, timeout: FiniteDuration): Fox[Boolean]

  def save(saveBucket: BucketWriteInstruction, timeout: FiniteDuration): Fox[Boolean] = {
    saveToUnderlying(saveBucket, timeout)
  }

  def load(loadBucket: BucketReadInstruction, timeout: FiniteDuration, useCache: Boolean): Fox[Array[Byte]] = {
    val requestedCube = loadBucket.toCubeReadInstruction(loadBucket.dataSource.cubeLength)
    val withCubeResource =
      if (useCache)
        withCache[Array[Byte]](requestedCube)(loadFromUnderlying(requestedCube, timeout)) _
      else
        loadFromUnderlying[Array[Byte]](requestedCube, timeout) _
    withCubeResource { cube =>
      cube.cutOutBucket(loadBucket).map { bucket =>
        if (loadBucket.settings.useHalfByte)
          convertToHalfByte(bucket)
        else
          bucket
      }
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
}
