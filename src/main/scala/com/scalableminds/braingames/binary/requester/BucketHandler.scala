/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.requester.handlers


import com.scalableminds.braingames.binary.models._
import com.scalableminds.braingames.binary.requester.{Cube, DataCache}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box

import scala.concurrent.Future
import scala.concurrent.duration.FiniteDuration
import play.api.libs.concurrent.Execution.Implicits._

trait BucketHandler extends DataCache with LazyLogging with FoxImplicits{
  protected def loadFromUnderlying(loadCube: CubeReadInstruction, timeout: FiniteDuration): Fox[Cube]

  protected def saveToUnderlying(saveBucket: BucketWriteInstruction, timeout: FiniteDuration): Fox[Boolean]

  def save(saveBucket: BucketWriteInstruction, timeout: FiniteDuration): Fox[Boolean] = {
    saveToUnderlying(saveBucket, timeout)
  }

  def load(loadBucket: BucketReadInstruction, timeout: FiniteDuration, useCache: Boolean): Fox[Array[Byte]] = {
    def getBucket(cube: Cube): Box[Array[Byte]] = {
      cube.cutOutBucket(loadBucket).map { bucket =>
        if (loadBucket.settings.useHalfByte)
          convertToHalfByte(bucket)
        else
          bucket
      }
    }

    val requestedCube = loadBucket.toCubeReadInstruction(loadBucket.dataLayer.cubeLength)
    if (useCache)
      withCache[Array[Byte]](requestedCube)(loadFromUnderlying(requestedCube, timeout))(getBucket)
    else
      loadFromUnderlying(requestedCube, timeout).flatMap { cube =>
        val bucket = getBucket(cube)
        cube.scheduleForRemoval()
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
}
