package com.scalableminds.braingames.binary.models

import com.scalableminds.util.geometry.GenericPosition
import org.apache.commons.lang3.builder.HashCodeBuilder

class VoxelPosition(
  protected val globalX: Int,
  protected val globalY: Int,
  protected val globalZ: Int,
  val resolution: Int) extends GenericPosition {

  val x: Int = globalX / resolution

  val y: Int = globalY / resolution

  val z: Int = globalZ / resolution

  def toBucket(bucketLength: Int): BucketPosition =
    new BucketPosition(globalX, globalY, globalZ, resolution, bucketLength)

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
  val resolution: Int,
  val bucketLength: Int) extends GenericPosition {

  val x: Int = globalX / bucketLength / resolution

  val y: Int = globalY / bucketLength / resolution

  val z: Int = globalZ / bucketLength / resolution

  def toCube(cubeLength: Int): CubePosition =
    new CubePosition(globalX, globalY, globalZ, resolution, cubeLength)

  def topLeft: VoxelPosition = {
    val tlx: Int = globalX - globalX % bucketLength
    val tly: Int = globalY - globalY % bucketLength
    val tlz: Int = globalZ - globalZ % bucketLength

    new VoxelPosition(tlx, tly, tlz, resolution)
  }

  def nextBucketInX: BucketPosition = {
    new BucketPosition(globalX + bucketLength, globalY, globalZ, resolution, bucketLength)
  }

  def nextBucketInY: BucketPosition = {
    new BucketPosition(globalX, globalY + bucketLength, globalZ, resolution, bucketLength)
  }

  def nextBucketInZ: BucketPosition = {
    new BucketPosition(globalX, globalY, globalZ + bucketLength, resolution, bucketLength)
  }
}


class CubePosition(
  protected val globalX: Int,
  protected val globalY: Int,
  protected val globalZ: Int,
  val resolution: Int,
  val cubeLength: Int) extends GenericPosition {

  val x: Int = globalX / cubeLength / resolution

  val y: Int = globalY / cubeLength / resolution

  val z: Int = globalZ / cubeLength / resolution
}

