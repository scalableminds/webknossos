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
  private def getBytes(p: Point3D, block: Array[T]) = {
    val address =
      (p.x % blockWidth +
        p.y % blockHeight * blockWidth +
        p.z % blockDepth * blockHeight * blockWidth) * elementSize

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

  private def calculateBlockIdx(p: Point3D) =
    p.z / blockDepth +
      p.y / blockHeight * zBlocks +
      p.x / blockWidth * zBlocks * yBlocks

  def apply(p: Point3D): Array[T] = {
    if(p.x < 0 || p.y < 0 || p.z < 0)
      nullArray
    else {
      val blockIdx = calculateBlockIdx(p)
      if(exists(blockIdx))
        getBytes(p, underlying(blockIdx))
      else
        new Array[T](elementSize)
    }
  }

  def exists(blockIdx: Int): Boolean = {
    underlying(blockIdx).length > 0
  }

  def emptyBlock: Array[T] = {
    new Array[T](blockWidth * blockHeight * blockDepth * elementSize)
  }

  def setBytes(p: Point3D, d: Array[T], offset: Int): Unit = {
    val blockIdx = calculateBlockIdx(p)
    if(!exists(blockIdx))
      underlying(blockIdx) = emptyBlock
    setBytes(p, underlying(blockIdx), d, offset)
  }
}
