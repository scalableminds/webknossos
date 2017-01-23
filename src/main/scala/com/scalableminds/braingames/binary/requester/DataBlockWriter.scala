/*
 * Copyright (C) 2011-2017 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.requester

import com.scalableminds.braingames.binary.models.{DataLayer, DataWriteRequest}
import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.tools.BlockedArray3D
import com.scalableminds.util.tools.ExtendedTypes.ExtendedDouble

class DataBlockWriter(block: BlockedArray3D[Byte], dataRequest: DataWriteRequest, layer: DataLayer, offset: Point3D)
  extends CubeIterator{
  val dataSource = dataRequest.dataSource

  val resolution = dataRequest.resolution

  def writeSuppliedData: Array[Array[Byte]] = {
    iterateOverCube(dataRequest.cuboid, extendArrayBy = layer.bytesPerElement)(writeData)
    block.underlying
  }

  @inline
  private def writeData(px: Double, py: Double, pz: Double, idx: Int): Array[Byte] = {
    byteWriter(Point3D(px.castToInt, py.castToInt, pz.castToInt), dataRequest.data, idx)
    Array.empty[Byte]
  }

  private def calculatePositionInLoadedBlock(globalPoint: Point3D): Point3D = {
    dataSource
      .applyResolution(globalPoint, resolution)
      .move(offset.negate)
  }

  @inline
  private def byteWriter(globalPoint: Point3D, data: Array[Byte], offset: Int): Unit = {
    block.setBytes(calculatePositionInLoadedBlock(globalPoint), data, offset)
  }
}