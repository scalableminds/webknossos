/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.requester

import com.scalableminds.braingames.binary.models.{BucketPosition, DataSource, VoxelPosition}
import com.scalableminds.util.geometry.Point3D

/**
  * A cuboid represents a generic cuboid at a specified position.
  */
case class Cuboid(topLeft: VoxelPosition, width: Int, height: Int, depth: Int) {

  lazy val bottomRight: VoxelPosition = topLeft.move(width, height, depth)

  val volume: Int = width * height * depth

  /**
    * Returns all buckets that are withing the cuboid spanned by top-left and bottom-right
    */
  def allBucketsInCuboid(bucketLength: Int): Seq[BucketPosition] = {
    val minBucket = topLeft.toBucket(bucketLength)
    var bucketList = List.empty[BucketPosition]
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