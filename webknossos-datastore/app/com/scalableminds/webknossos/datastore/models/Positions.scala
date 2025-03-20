package com.scalableminds.webknossos.datastore.models

import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.webknossos.datastore.geometry.Vec3IntProto
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
    BucketPosition(mag1X, mag1Y, mag1Z, mag, None)

  def move(dx: Int, dy: Int, dz: Int): VoxelPosition =
    VoxelPosition(mag1X + dx, mag1Y + dy, mag1Z + dz, mag)

  def toMag1: VoxelPosition = this.copy(mag = Vec3Int.ones) // other properties are already in mag1 and do not change.

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
    mag: Vec3Int,
    additionalCoordinates: Option[Seq[AdditionalCoordinate]]
) {

  val bucketLength: Int = DataLayer.bucketLength

  val bucketX: Int = voxelMag1X / bucketLength / mag.x

  val bucketY: Int = voxelMag1Y / bucketLength / mag.y

  val bucketZ: Int = voxelMag1Z / bucketLength / mag.z

  val voxelXInMag: Int = voxelMag1X / mag.x

  val voxelYInMag: Int = voxelMag1Y / mag.y

  val voxelZInMag: Int = voxelMag1Z / mag.z

  def volume: Int = bucketLength * bucketLength * bucketLength

  def topLeft: VoxelPosition = {
    val tlx: Int = voxelMag1X - Math.floorMod(voxelMag1X, bucketLength * mag.x)
    val tly: Int = voxelMag1Y - Math.floorMod(voxelMag1Y, bucketLength * mag.y)
    val tlz: Int = voxelMag1Z - Math.floorMod(voxelMag1Z, bucketLength * mag.z)

    VoxelPosition(tlx, tly, tlz, mag)
  }

  def nextBucketInX: BucketPosition =
    BucketPosition(voxelMag1X + (bucketLength * mag.x), voxelMag1Y, voxelMag1Z, mag, additionalCoordinates)

  def nextBucketInY: BucketPosition =
    BucketPosition(voxelMag1X, voxelMag1Y + (bucketLength * mag.y), voxelMag1Z, mag, additionalCoordinates)

  def nextBucketInZ: BucketPosition =
    BucketPosition(voxelMag1X, voxelMag1Y, voxelMag1Z + (bucketLength * mag.z), mag, additionalCoordinates)

  def toMag1BoundingBox: BoundingBox =
    new BoundingBox(
      Vec3Int(topLeft.mag1X, topLeft.mag1Y, topLeft.mag1Z),
      bucketLength * mag.x,
      bucketLength * mag.y,
      bucketLength * mag.z
    )

  def hasNegativeComponent: Boolean =
    voxelMag1X < 0 || voxelMag1Y < 0 || voxelMag1Z < 0 || mag.hasNegativeComponent || AdditionalCoordinate
      .hasNegativeValue(additionalCoordinates)

  def toVec3IntProto: Vec3IntProto = Vec3IntProto(bucketX, bucketY, bucketZ)

  private def additionalCoordinateString = additionalCoordinates match {
    case Some(coords) => s", additional coordinates: ${coords.map(_.toString()).mkString(",")}"
    case None         => ""
  }

  def hasAdditionalCoordinates: Boolean =
    additionalCoordinates match {
      case Some(value) => value.nonEmpty
      case None        => false
    }

  override def toString: String =
    s"BucketPosition(voxelMag1 at ($voxelMag1X, $voxelMag1Y, $voxelMag1Z), bucket at ($bucketX,$bucketY,$bucketZ), mag$mag$additionalCoordinateString)"
}
