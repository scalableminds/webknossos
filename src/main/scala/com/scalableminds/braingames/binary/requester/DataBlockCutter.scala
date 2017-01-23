/*
 * Copyright (C) 2011-2017 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.requester

import com.scalableminds.braingames.binary.models.{DataLayer, DataReadRequest}
import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.tools.BlockedArray3D
import com.scalableminds.util.tools.ExtendedTypes.ExtendedDouble

class DataBlockCutter(block: BlockedArray3D[Byte], dataRequest: DataReadRequest, layer: DataLayer, offset: Point3D)
  extends CubeIterator {
  val dataSource = dataRequest.dataSource

  val resolution = dataRequest.resolution

  def cutOutRequestedData: Array[Byte] = {
    val result: Array[Byte] =
      iterateOverCube(dataRequest.cuboid, extendArrayBy = layer.bytesPerElement)(retrieveData)

    if (dataRequest.settings.useHalfByte)
      convertToHalfByte(result)
    else {
      result
    }
  }

  @inline
  private def retrieveData(px: Double, py: Double, pz: Double, idx: Int) = {
    byteLoader(Point3D(px.castToInt, py.castToInt, pz.castToInt))
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

  @inline
  private def calculatePositionInLoadedBlock(globalPoint: Point3D) = {
    dataSource.applyResolution(globalPoint, resolution).move(offset.negate)
  }

  @inline
  private def byteLoader(globalPoint: Point3D): Array[Byte] = {
    block(calculatePositionInLoadedBlock(globalPoint))
  }
}
