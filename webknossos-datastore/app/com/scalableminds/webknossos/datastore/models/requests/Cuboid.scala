package com.scalableminds.webknossos.datastore.models.requests

import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.webknossos.datastore.models.{BucketPosition, VoxelPosition}

/**
  * Mag-aware BoundingBox
  */
case class Cuboid(topLeft: VoxelPosition, width: Int, height: Int, depth: Int) {

  lazy val bottomRight: VoxelPosition =
    topLeft.move(width * topLeft.mag.x, height * topLeft.mag.y, depth * topLeft.mag.z)

  val volume: Int = width * height * depth

  // The JVM does not support arrays with more than 2^31 elements. We thus limit the dimensions of requested cuboids
  // such that all requests (even for 64-bit data types) can still be handled.
  val hasValidDimensions: Boolean =
    width > 0 && height > 0 && depth > 0 && volume <= 512 * 512 * 512

  def isSingleBucket(bucketLength: Int): Boolean =
    width == bucketLength && height == bucketLength && depth == bucketLength && topLeft == topLeft.toBucket.topLeft

  /**
    * Returns all buckets that are within the cuboid spanned by top-left and bottom-right
    */
  def allBucketsInCuboid: Seq[BucketPosition] = {
    val minBucket = topLeft.toBucket
    var bucketList: List[BucketPosition] = Nil
    var bucket = minBucket
    while (bucket.topLeft.voxelXInMag < bottomRight.voxelXInMag) {
      val prevX = bucket
      while (bucket.topLeft.voxelYInMag < bottomRight.voxelYInMag) {
        val prevY = bucket
        while (bucket.topLeft.voxelZInMag < bottomRight.voxelZInMag) {
          bucketList ::= bucket
          bucket = bucket.nextBucketInZ
        }
        bucket = prevY.nextBucketInY
      }
      bucket = prevX.nextBucketInX
    }
    bucketList
  }

  def mag: Vec3Int = topLeft.mag

  def toMag1: Cuboid = Cuboid(
    topLeft.toMag1,
    width * mag.x,
    height * mag.y,
    depth * mag.z
  )

  def toMag1BoundingBox: BoundingBox = {
    val mag1Cuboid = this.toMag1
    BoundingBox(Vec3Int(mag1Cuboid.topLeft.mag1X, mag1Cuboid.topLeft.mag1Y, mag1Cuboid.topLeft.mag1Z),
                mag1Cuboid.width,
                mag1Cuboid.height,
                mag1Cuboid.depth)
  }
}
