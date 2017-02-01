package com.scalableminds.braingames.binary.api

import com.scalableminds.braingames.binary.models.{DataLayer, DataReadRequest, DataRequestSettings, DataSource}
import com.scalableminds.braingames.binary.requester.Cuboid
import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.tools.Fox

/**
  * Created by tmbo on 01.02.17.
  */
trait DataImageService {
  this: BinaryDataService =>

  def requestImageData(
    dataSource: DataSource,
    dataLayer: DataLayer,
    cuboid: Cuboid,
    settings: DataRequestSettings): Fox[Array[Byte]] = {

    val position = dataSource.applyResolution(cuboid.topLeft, cuboid.resolution)
    val cuboidWithResolution = cuboid.copy(topLeft = position)
    val minBucket = bucketOfPosition(position, dataSource.lengthOfLoadedBuckets)
    val maxPosition = position.move(cuboid.width, cuboid.height, cuboid.depth)

    val bucketQueue = allBucketsInCuboid(minBucket, maxPosition, cuboid.resolution, dataSource)

    loadAllBuckets(bucketQueue, dataSource, dataLayer, cuboid.resolutionExponent, settings).map { rs =>
      // after we have loaded all buckets that 'touch' our cuboid we want to retrieve, we need to cut the data from
      // the loaded buckets
      cutOutCuboid(rs, cuboidWithResolution, dataLayer.bytesPerElement, dataSource, maxPosition)
    }
  }

  /**
    * Given a list of loaded buckets, cutout the data of the cuboid
    */
  private def cutOutCuboid(
    rs: List[(DataReadRequest, Array[Byte])],
    cuboid: Cuboid,
    bytesPerElement: Int,
    dataSource: DataSource,
    maxPosition: Point3D) = {

    val result = new Array[Byte](cuboid.width * cuboid.height * cuboid.depth * bytesPerElement)
    val bucketLength = dataSource.lengthOfLoadedBuckets

    rs.foreach {
      case (request, data) =>
        val bucket = dataSource.applyResolution(request.cuboid.topLeft, cuboid.resolution)
        val x = math.max(cuboid.topLeft.x, bucket.x)
        var y = math.max(cuboid.topLeft.y, bucket.y)
        var z = math.max(cuboid.topLeft.z, bucket.z)

        val xMax = math.min(bucket.x + bucketLength, maxPosition.x)
        val yMax = math.min(bucket.y + bucketLength, maxPosition.y)
        val zMax = math.min(bucket.z + bucketLength, maxPosition.z)

        while (z < zMax) {
          y = math.max(cuboid.topLeft.y, bucket.y)
          while (y < yMax) {
            val dataOffset =
              (x % bucketLength +
                y % bucketLength * bucketLength +
                z % bucketLength * bucketLength * bucketLength) * bytesPerElement
            val rx = x - cuboid.topLeft.x
            val ry = y - cuboid.topLeft.y
            val rz = z - cuboid.topLeft.z

            val resultOffset = (rx + ry * cuboid.width + rz * cuboid.width * cuboid.height) * bytesPerElement
            System.arraycopy(data, dataOffset, result, resultOffset, (xMax - x) * bytesPerElement)
            y += 1
          }
          z += 1
        }
    }
    result
  }

  /**
    * Returns all buckets that are withing the cuboid spanned by top-left and bottom-right
    */
  private def allBucketsInCuboid(topLeft: Point3D, bottomRight: Point3D, resolution: Int, dataSource: DataSource) = {
    for {
      x <- topLeft.x.until(bottomRight.x, dataSource.lengthOfLoadedBuckets)
      y <- topLeft.y.until(bottomRight.y, dataSource.lengthOfLoadedBuckets)
      z <- topLeft.z.until(bottomRight.z, dataSource.lengthOfLoadedBuckets)
    } yield dataSource.unapplyResolution(Point3D(x, y, z), resolution)
  }

  /**
    * Loads all the buckets (where each position is the top-left of the bucket) from the passed layer.
    */
  private def loadAllBuckets(
    buckets: Seq[Point3D], dataSource: DataSource, dataLayer: DataLayer,
    resolutionExponent: Int, settings: DataRequestSettings) = {

    val dataRequestTemplate = createDataReadRequest(
      dataSource, dataLayer, None,
      dataSource.lengthOfLoadedBuckets, dataSource.lengthOfLoadedBuckets, dataSource.lengthOfLoadedBuckets,
      Point3D(0, 0, 0), resolutionExponent, settings)

    Fox.serialCombined(buckets.toList) { bucket =>
      val dataRequest = dataRequestTemplate.copy(cuboid = dataRequestTemplate.cuboid.copy(topLeft = bucket))
      handleDataRequest(dataRequest).map(r => dataRequest -> r)
    }
  }

  /**
    * Calculates the bucket the point is contained in
    */
  private def bucketOfPosition(position: Point3D, bucketLength: Int) =
    position.move(-position.x % bucketLength, -position.y % bucketLength, -position.z % bucketLength)
}
