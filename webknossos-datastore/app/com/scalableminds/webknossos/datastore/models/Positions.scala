package com.scalableminds.webknossos.datastore.models

import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import org.apache.commons.lang3.builder.HashCodeBuilder

case class VoxelPosition(
    mag1X: Int,
    mag1Y: Int,
    mag1Z: Int,
    mag: Vec3Int
) {

  val voxelXInMag: Int = mag1X / mag.x

  val voxelYInMag: Int = mag1Y / mag.y

  val voxelZInMag: Int = mag1Z / mag.z

  def toBucket: BucketPosition =
    BucketPosition(mag1X, mag1Y, mag1Z, mag)

  def move(dx: Int, dy: Int, dz: Int) =
    VoxelPosition(mag1X + dx, mag1Y + dy, mag1Z + dz, mag)

  override def toString = s"($mag1X, $mag1Y, $mag1Z) / $mag"

  override def equals(obj: scala.Any): Boolean =
    obj match {
      case other: VoxelPosition =>
        other.mag1X == mag1X &&
          other.mag1Y == mag1Y &&
          other.mag1Z == mag1Z &&
          other.mag == mag
      case _ =>
        false
    }

  override def hashCode(): Int =
    new HashCodeBuilder(17, 31).append(mag1X).append(mag1Y).append(mag1Z).append(mag).toHashCode
}

case class BucketPosition(
    voxelMag1X: Int,
    voxelMag1Y: Int,
    voxelMag1Z: Int,
    mag: Vec3Int
) {

  val bucketLength: Int = DataLayer.bucketLength

  val bucketX: Int = voxelMag1X / bucketLength / mag.x

  val bucketY: Int = voxelMag1Y / bucketLength / mag.y

  val bucketZ: Int = voxelMag1Z / bucketLength / mag.z

  val voxelXInMag: Int = voxelMag1X / mag.x

  val voxelYInMag: Int = voxelMag1Y / mag.y

  val voxelZInMag: Int = voxelMag1Z / mag.z

  def volume: Int = bucketLength * bucketLength * bucketLength

  def toCube(cubeLength: Int): CubePosition =
    new CubePosition(voxelMag1X, voxelMag1Y, voxelMag1Z, mag, cubeLength)

  def topLeft: VoxelPosition = {
    val tlx: Int = voxelMag1X - Math.floorMod(voxelMag1X, bucketLength * mag.x)
    val tly: Int = voxelMag1Y - Math.floorMod(voxelMag1Y, bucketLength * mag.y)
    val tlz: Int = voxelMag1Z - Math.floorMod(voxelMag1Z, bucketLength * mag.z)

    VoxelPosition(tlx, tly, tlz, mag)
  }

  def nextBucketInX: BucketPosition =
    BucketPosition(voxelMag1X + (bucketLength * mag.x), voxelMag1Y, voxelMag1Z, mag)

  def nextBucketInY: BucketPosition =
    BucketPosition(voxelMag1X, voxelMag1Y + (bucketLength * mag.y), voxelMag1Z, mag)

  def nextBucketInZ: BucketPosition =
    BucketPosition(voxelMag1X, voxelMag1Y, voxelMag1Z + (bucketLength * mag.z), mag)

  def toMag1BoundingBox: BoundingBox =
    new BoundingBox(
      Vec3Int(topLeft.mag1X, topLeft.mag1Y, topLeft.mag1Z),
      bucketLength * mag.x,
      bucketLength * mag.y,
      bucketLength * mag.z
    )

  override def toString: String =
    s"BucketPosition(voxelMag1 at ($voxelMag1X, $voxelMag1Y, $voxelMag1Z), bucket at ($bucketX,$bucketY,$bucketZ), mag$mag)"
}

class CubePosition(
    protected val mag1X: Int,
    protected val mag1Y: Int,
    protected val mag1Z: Int,
    val mag: Vec3Int,
    val cubeLength: Int
) {

  val x: Int = mag1X / cubeLength / mag.x

  val y: Int = mag1Y / cubeLength / mag.y

  val z: Int = mag1Z / cubeLength / mag.z

  def topLeft: VoxelPosition = {
    val tlx: Int = mag1X - mag1X % (cubeLength * mag.x)
    val tly: Int = mag1Y - mag1Y % (cubeLength * mag.y)
    val tlz: Int = mag1Z - mag1Z % (cubeLength * mag.z)

    VoxelPosition(tlx, tly, tlz, mag)
  }

  def toMag1BoundingBox: BoundingBox =
    new BoundingBox(Vec3Int(mag1X, mag1Y, mag1Z), cubeLength * mag.x, cubeLength * mag.y, cubeLength * mag.z)

  override def toString: String =
    s"CubePos($x,$y,$z,mag=$mag)"
}
