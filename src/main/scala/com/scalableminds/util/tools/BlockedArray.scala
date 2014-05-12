/*
* Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.util.tools

import scala.reflect.ClassTag
import com.scalableminds.util.geometry.Point3D

case class BlockedArray3D[T](
  underlying: Vector[Array[T]],
  blockWidth: Int,
  blockHeight: Int,
  blockDepth: Int,
  xBlocks: Int,
  yBlocks: Int,
  zBlocks: Int,
  elementSize: Int,
  nullElement: T)(implicit classTag: ClassTag[T]) {

  lazy val nullArray = Array.fill[T](elementSize)(nullElement)

  def getBytes(p: Point3D, block: Array[T]) = {
    val address =
      (p.x % blockWidth +
        p.y % blockHeight * blockWidth +
        p.z % blockDepth * blockHeight * blockWidth) * elementSize

    val bytes = new Array[T](elementSize)
    var i = 0
    while (i < elementSize) {
      bytes.update(i, block(address + i))
      i += 1
    }
    bytes
  }

  def setBytes(p: Point3D, block: Array[T], d: Array[T]) = {
    val address =
      (p.x % blockWidth +
        p.y % blockHeight * blockWidth +
        p.z % blockDepth * blockHeight * blockWidth) * elementSize

    var i = 0
    while (i < elementSize) {
      block.update(address + i, d(i))
      i += 1
    }
  }

  def calculateBlockIdx(p: Point3D) =
    p.z / blockDepth +
      p.y / blockHeight * zBlocks +
      p.x / blockWidth * zBlocks * yBlocks

  def apply(p: Point3D): Array[T] = {
    if(p.x < 0 || p.y < 0 || p.z < 0)
      nullArray
    else {
      val blockIdx = calculateBlockIdx(p)
      getBytes(p, underlying(blockIdx))
    }
  }

  def apply(p: Point3D, d: Array[T]) = {
    val blockIdx = calculateBlockIdx(p)
    setBytes(p, underlying(blockIdx), d)
  }
}
