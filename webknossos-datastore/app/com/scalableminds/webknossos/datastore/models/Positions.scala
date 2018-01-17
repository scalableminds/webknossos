/*
* Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.webknossos.datastore.models

import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.util.geometry.{BoundingBox, GenericPosition, Point3D}
import org.apache.commons.lang3.builder.HashCodeBuilder

class VoxelPosition(
                      protected val globalX: Int,
                      protected val globalY: Int,
                      protected val globalZ: Int,
                      val resolution: Int
                   ) extends GenericPosition {

  val x: Int = globalX / resolution

  val y: Int = globalY / resolution

  val z: Int = globalZ / resolution

  def toBucket: BucketPosition =
    new BucketPosition(globalX, globalY, globalZ, resolution)

  def toHighestRes: VoxelPosition =
    new VoxelPosition(globalX, globalY, globalZ, 1)

  def move(dx: Int, dy: Int, dz: Int) =
    new VoxelPosition(globalX + dx, globalY + dy, globalZ + dz, resolution)

  override def equals(obj: scala.Any): Boolean = {
    obj match {
      case other: VoxelPosition =>
        other.globalX == globalX &&
          other.globalY == globalY &&
          other.globalZ == globalZ &&
          other.resolution == resolution
      case _ =>
        false
    }
  }

  override def hashCode(): Int = {
    new HashCodeBuilder(17, 31)
      .append(globalX)
      .append(globalY)
      .append(globalZ)
      .append(resolution)
      .toHashCode
  }
}

class BucketPosition(
                       protected val globalX: Int,
                       protected val globalY: Int,
                       protected val globalZ: Int,
                       val resolution: Int
                    ) extends GenericPosition {

  val bucketLength = DataLayer.bucketLength

  val x: Int = globalX / bucketLength / resolution

  val y: Int = globalY / bucketLength / resolution

  val z: Int = globalZ / bucketLength / resolution

  def volume = bucketLength * bucketLength * bucketLength

  def toCube(cubeLength: Int): CubePosition =
    new CubePosition(globalX, globalY, globalZ, resolution, cubeLength)

  def topLeft: VoxelPosition = {
    val tlx: Int = globalX - globalX % (bucketLength * resolution)
    val tly: Int = globalY - globalY % (bucketLength * resolution)
    val tlz: Int = globalZ - globalZ % (bucketLength * resolution)

    new VoxelPosition(tlx, tly, tlz, resolution)
  }

  def nextBucketInX: BucketPosition = {
    new BucketPosition(globalX + (bucketLength * resolution), globalY, globalZ, resolution)
  }

  def nextBucketInY: BucketPosition = {
    new BucketPosition(globalX, globalY + (bucketLength * resolution), globalZ, resolution)
  }

  def nextBucketInZ: BucketPosition = {
    new BucketPosition(globalX, globalY, globalZ + (bucketLength * resolution), resolution)
  }

  def toHighestResBoundingBox: BoundingBox =
    new BoundingBox(Point3D(globalX, globalY, globalZ), bucketLength * resolution, bucketLength * resolution, bucketLength * resolution)
}

class CubePosition(
                     protected val globalX: Int,
                     protected val globalY: Int,
                     protected val globalZ: Int,
                     val resolution: Int,
                     val cubeLength: Int
                  ) extends GenericPosition {

  val x: Int = globalX / cubeLength / resolution

  val y: Int = globalY / cubeLength / resolution

  val z: Int = globalZ / cubeLength / resolution

  def topLeft: VoxelPosition = {
    val tlx: Int = globalX - globalX % (cubeLength * resolution)
    val tly: Int = globalY - globalY % (cubeLength * resolution)
    val tlz: Int = globalZ - globalZ % (cubeLength * resolution)

    new VoxelPosition(tlx, tly, tlz, resolution)
  }

  def toHighestResBoundingBox: BoundingBox =
    new BoundingBox(Point3D(globalX, globalY, globalZ), cubeLength * resolution, cubeLength * resolution, cubeLength * resolution)

  override def toString: String = {
    s"CPos($x,$y,$z,res=$resolution)"
  }
}
