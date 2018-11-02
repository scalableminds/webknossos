package com.scalableminds.webknossos.datastore.models.requests

import com.scalableminds.webknossos.datastore.models.{BucketPosition, VoxelPosition}

/**
  * A cuboid represents a generic cuboid at a specified position.
  */
case class Cuboid(topLeft: VoxelPosition, width: Int, height: Int, depth: Int) {

  lazy val bottomRight: VoxelPosition =
    topLeft.move(width * topLeft.resolution.x, height * topLeft.resolution.y, depth * topLeft.resolution.z)

  val volume: Int = width * height * depth

  val hasValidDimensions: Boolean = width > 0 && width <= 512 && height > 0 && height <= 512 && depth > 0 && depth <= 512

  def isSingleBucket(bucketLength: Int): Boolean = {
    width == bucketLength && height == bucketLength && depth == bucketLength && topLeft == topLeft.toBucket.topLeft
  }

  /**
    * Returns all buckets that are withing the cuboid spanned by top-left and bottom-right
    */
  def allBucketsInCuboid: Seq[BucketPosition] = {
    val minBucket = topLeft.toBucket
    var bucketList: List[BucketPosition] = Nil
    var bucket = minBucket
    while(bucket.topLeft.x < bottomRight.x){
      val prevX = bucket
      while(bucket.topLeft.y < bottomRight.y){
        val prevY = bucket
        while(bucket.topLeft.z < bottomRight.z){
          bucketList ::= bucket
          bucket = bucket.nextBucketInZ
        }
        bucket = prevY.nextBucketInY
      }
      bucket = prevX.nextBucketInX
    }
    bucketList
  }
}
