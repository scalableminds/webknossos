package com.scalableminds.webknossos.datastore.models

import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import org.apache.commons.lang3.builder.HashCodeBuilder

trait GenericPosition {
  def x: Int
  def y: Int
  def z: Int
}

class VoxelPosition(
    protected val globalX: Int,
    protected val globalY: Int,
    protected val globalZ: Int,
    val mag: Vec3Int
) extends GenericPosition {

  val x: Int = globalX / mag.x

  val y: Int = globalY / mag.y

  val z: Int = globalZ / mag.z

  def toBucket: BucketPosition =
    BucketPosition(globalX, globalY, globalZ, mag)

  def move(dx: Int, dy: Int, dz: Int) =
    new VoxelPosition(globalX + dx, globalY + dy, globalZ + dz, mag)

  override def toString = s"($globalX, $globalY, $globalZ) / $mag"

  override def equals(obj: scala.Any): Boolean =
    obj match {
      case other: VoxelPosition =>
        other.globalX == globalX &&
          other.globalY == globalY &&
          other.globalZ == globalZ &&
          other.mag == mag
      case _ =>
        false
    }

  override def hashCode(): Int =
    new HashCodeBuilder(17, 31).append(globalX).append(globalY).append(globalZ).append(mag).toHashCode
}

case class BucketPosition(
                           globalX: Int,
                           globalY: Int,
                           globalZ: Int,
                           mag: Vec3Int
) extends GenericPosition {

  val bucketLength: Int = DataLayer.bucketLength

  val x: Int = globalX / bucketLength / mag.x

  val y: Int = globalY / bucketLength / mag.y

  val z: Int = globalZ / bucketLength / mag.z

  val globalXInMag: Int = globalX / mag.x

  val globalYInMag: Int = globalY / mag.y

  val globalZInMag: Int = globalZ / mag.z

  def volume: Int = bucketLength * bucketLength * bucketLength

  def toCube(cubeLength: Int): CubePosition =
    new CubePosition(globalX, globalY, globalZ, mag, cubeLength)

  def topLeft: VoxelPosition = {
    val tlx: Int = globalX - globalX % (bucketLength * mag.x)
    val tly: Int = globalY - globalY % (bucketLength * mag.y)
    val tlz: Int = globalZ - globalZ % (bucketLength * mag.z)

    new VoxelPosition(tlx, tly, tlz, mag)
  }

  def nextBucketInX: BucketPosition =
    BucketPosition(globalX + (bucketLength * mag.x), globalY, globalZ, mag)

  def nextBucketInY: BucketPosition =
    BucketPosition(globalX, globalY + (bucketLength * mag.y), globalZ, mag)

  def nextBucketInZ: BucketPosition =
    BucketPosition(globalX, globalY, globalZ + (bucketLength * mag.z), mag)

  def toHighestResBoundingBox: BoundingBox =
    new BoundingBox(
      Vec3Int(topLeft.x * mag.x, topLeft.y * mag.y, topLeft.z * mag.z),
      bucketLength * mag.x,
      bucketLength * mag.y,
      bucketLength * mag.z
    )

  override def toString: String =
    s"BucketPosition($globalX, $globalY, $globalZ, mag$mag)"
}

class CubePosition(
    protected val globalX: Int,
    protected val globalY: Int,
    protected val globalZ: Int,
    val resolution: Vec3Int,
    val cubeLength: Int
) extends GenericPosition {

  val x: Int = globalX / cubeLength / resolution.x

  val y: Int = globalY / cubeLength / resolution.y

  val z: Int = globalZ / cubeLength / resolution.z

  def topLeft: VoxelPosition = {
    val tlx: Int = globalX - globalX % (cubeLength * resolution.x)
    val tly: Int = globalY - globalY % (cubeLength * resolution.y)
    val tlz: Int = globalZ - globalZ % (cubeLength * resolution.z)

    new VoxelPosition(tlx, tly, tlz, resolution)
  }

  def toHighestResBoundingBox: BoundingBox =
    new BoundingBox(Vec3Int(globalX, globalY, globalZ),
                    cubeLength * resolution.x,
                    cubeLength * resolution.y,
                    cubeLength * resolution.z)

  override def toString: String =
    s"CPos($x,$y,$z,res=$resolution)"
}
