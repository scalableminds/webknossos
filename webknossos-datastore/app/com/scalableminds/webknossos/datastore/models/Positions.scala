package com.scalableminds.webknossos.datastore.models

import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.util.geometry.{BoundingBox, GenericPosition, Point3D}
import org.apache.commons.lang3.builder.HashCodeBuilder

class VoxelPosition(
    protected val globalX: Int,
    protected val globalY: Int,
    protected val globalZ: Int,
    val resolution: Point3D
) extends GenericPosition {

  val x: Int = globalX / resolution.x

  val y: Int = globalY / resolution.y

  val z: Int = globalZ / resolution.z

  def toBucket: BucketPosition =
    new BucketPosition(globalX, globalY, globalZ, resolution)

  def move(dx: Int, dy: Int, dz: Int) =
    new VoxelPosition(globalX + dx, globalY + dy, globalZ + dz, resolution)

  override def toString = s"($globalX, $globalY, $globalZ) / $resolution"

  override def equals(obj: scala.Any): Boolean =
    obj match {
      case other: VoxelPosition =>
        other.globalX == globalX &&
          other.globalY == globalY &&
          other.globalZ == globalZ &&
          other.resolution == resolution
      case _ =>
        false
    }

  override def hashCode(): Int =
    new HashCodeBuilder(17, 31).append(globalX).append(globalY).append(globalZ).append(resolution).toHashCode
}

class BucketPosition(
    val globalX: Int,
    val globalY: Int,
    val globalZ: Int,
    val resolution: Point3D
) extends GenericPosition {

  val bucketLength = DataLayer.bucketLength

  val x: Int = globalX / bucketLength / resolution.x

  val y: Int = globalY / bucketLength / resolution.y

  val z: Int = globalZ / bucketLength / resolution.z

  def volume = bucketLength * bucketLength * bucketLength

  def toCube(cubeLength: Int): CubePosition =
    new CubePosition(globalX, globalY, globalZ, resolution, cubeLength)

  def topLeft: VoxelPosition = {
    val tlx: Int = globalX - globalX % (bucketLength * resolution.x)
    val tly: Int = globalY - globalY % (bucketLength * resolution.y)
    val tlz: Int = globalZ - globalZ % (bucketLength * resolution.z)

    new VoxelPosition(tlx, tly, tlz, resolution)
  }

  def nextBucketInX: BucketPosition =
    new BucketPosition(globalX + (bucketLength * resolution.x), globalY, globalZ, resolution)

  def nextBucketInY: BucketPosition =
    new BucketPosition(globalX, globalY + (bucketLength * resolution.y), globalZ, resolution)

  def nextBucketInZ: BucketPosition =
    new BucketPosition(globalX, globalY, globalZ + (bucketLength * resolution.z), resolution)

  def toHighestResBoundingBox: BoundingBox =
    new BoundingBox(Point3D(globalX, globalY, globalZ),
                    bucketLength * resolution.x,
                    bucketLength * resolution.y,
                    bucketLength * resolution.z)
}

class CubePosition(
    protected val globalX: Int,
    protected val globalY: Int,
    protected val globalZ: Int,
    val resolution: Point3D,
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
    new BoundingBox(Point3D(globalX, globalY, globalZ),
                    cubeLength * resolution.x,
                    cubeLength * resolution.y,
                    cubeLength * resolution.z)

  override def toString: String =
    s"CPos($x,$y,$z,res=$resolution)"
}
