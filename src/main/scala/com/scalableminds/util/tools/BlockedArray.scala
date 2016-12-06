/*
* Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.util.tools

import scala.reflect.ClassTag
import com.scalableminds.util.geometry.Point3D

case class BlockedArray3D[T](
  underlying: Array[Array[T]],
  blockWidth: Int,
  blockHeight: Int,
  blockDepth: Int,
  xBlocks: Int,
  yBlocks: Int,
  zBlocks: Int,
  elementSize: Int,
  nullElement: T)(implicit classTag: ClassTag[T]) {

  lazy val nullArray = Array.fill[T](elementSize)(nullElement)

  @inline
  def getBytes(x: Int, y: Int, z: Int, block: Array[T]) = {
    val address =
      (x % blockWidth +
        y % blockHeight * blockWidth +
        z % blockDepth * blockHeight * blockWidth) * elementSize

    val bytes = new Array[T](elementSize)
    Array.copy(block, address, bytes, 0, elementSize)
    bytes
  }

  @inline
  private def setBytes(p: Point3D, block: Array[T], d: Array[T], offset: Int): Unit = {
    val address =
      (p.x % blockWidth +
        p.y % blockHeight * blockWidth +
        p.z % blockDepth * blockHeight * blockWidth) * elementSize

    Array.copy(d, offset, block, address, elementSize)
  }

  def calculateBlockIdx(x: Int, y: Int, z: Int) =
    z / blockDepth +
      y / blockHeight * zBlocks +
      x / blockWidth * zBlocks * yBlocks

  def apply(x: Int, y: Int, z: Int) = {
    if(x < 0 || y < 0 || z < 0)
      nullArray
    else {
      val blockIdx = calculateBlockIdx(x, y, z)
      if(exists(blockIdx))
        getBytes(x, y, z, underlying(blockIdx))
      else
        new Array[T](elementSize)
    }
  }

  def apply(p: Point3D): Array[T] = {
    apply(p.x, p.y, p.z)
  }

  def exists(blockIdx: Int): Boolean = {
    underlying(blockIdx).length > 0
  }

  def emptyBlock: Array[T] = {
    new Array[T](blockWidth * blockHeight * blockDepth * elementSize)
  }

  def setBytes(p: Point3D, d: Array[T], offset: Int): Unit = {
    val blockIdx = calculateBlockIdx(p.x, p.y, p.z)
    if(!exists(blockIdx))
      underlying(blockIdx) = emptyBlock
    setBytes(p, underlying(blockIdx), d, offset)
  }
}
