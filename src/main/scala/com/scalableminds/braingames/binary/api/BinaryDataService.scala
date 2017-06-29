/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.api

import java.nio.file.Paths

import com.google.inject.Inject
import com.scalableminds.braingames.binary.models.BucketPosition
import com.scalableminds.braingames.binary.models.requests.{DataReadInstruction, DataServiceDataRequest, DataServiceMappingRequest, MappingReadInstruction}
import com.scalableminds.braingames.binary.storage.DataCubeCache
import com.scalableminds.util.tools.ExtendedTypes.ExtendedArraySeq
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Empty, Failure, Full}
import play.api.Configuration

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration._

class BinaryDataService @Inject()(config: Configuration) extends FoxImplicits with LazyLogging {

  val dataBaseDir = Paths.get(config.getString("braingames.binary.baseFolder").getOrElse("binaryData"))

  val loadTimeout: FiniteDuration = config.getInt("braingames.binary.loadTimeout").getOrElse(5).seconds

  val maxCacheSize: Int = config.getInt("braingames.binary.maxCacheSize").getOrElse(100)

  lazy val cache = new DataCubeCache(maxCacheSize)

  def handleDataRequests(requests: List[DataServiceDataRequest]): Fox[Array[Byte]] = {
    val requestData = requests.map { request =>
      getDataForRequest(request).map { data =>
        if (request.settings.halfByte) {
          convertToHalfByte(data)
        } else {
          data
        }
      }
    }

    Fox.combined(requestData).map(_.appendArrays)
  }

  def handleMappingRequest(request: DataServiceMappingRequest): Fox[Array[Byte]] = {
    val readInstruction = MappingReadInstruction(dataBaseDir, request.dataSource, request.mapping)
    request.dataLayer.mappingProvider.load(readInstruction)
  }

  private def getDataForRequest(request: DataServiceDataRequest): Fox[Array[Byte]] = {

    def isSingleBucketRequest = {
      request.cuboid.width == request.dataLayer.lengthOfProvidedBuckets &&
        request.cuboid.height == request.dataLayer.lengthOfProvidedBuckets &&
        request.cuboid.depth == request.dataLayer.lengthOfProvidedBuckets &&
        request.cuboid.topLeft == request.cuboid.topLeft.toBucket(request.dataLayer.lengthOfProvidedBuckets).topLeft
    }

    val bucketQueue = request.cuboid.allBucketsInCuboid(request.dataLayer.lengthOfProvidedBuckets)

    if (isSingleBucketRequest) {
      bucketQueue.headOption.toFox.flatMap { bucket =>
        handleBucketRequest(request, bucket)
      }
    } else {
      Fox.serialCombined(bucketQueue.toList) { bucket =>
        handleBucketRequest(request, bucket).map(r => bucket -> r)
      }.map {
        cutOutCuboid(request, _)
      }
    }
  }

  private def handleBucketRequest(request: DataServiceDataRequest, bucket: BucketPosition): Fox[Array[Byte]] = {

    def emptyBucket: Array[Byte] = {
      new Array[Byte](request.dataLayer.lengthOfProvidedBuckets *
                      request.dataLayer.lengthOfProvidedBuckets *
                      request.dataLayer.lengthOfProvidedBuckets *
                      request.dataLayer.bytesPerElement)
    }

    if (request.dataLayer.doesContainBucket(bucket)) {
      val readInstruction = DataReadInstruction(
        dataBaseDir,
        request.dataSource,
        request.dataLayer,
        bucket)

      request.dataLayer.bucketProvider.load(readInstruction, cache, loadTimeout).futureBox.map {
        case Full(data) =>
          Full(data)
        case Empty =>
          Full(emptyBucket)
        case f: Failure =>
          logger.error(s"BinaryDataService failure: ${f.msg}")
          f
        }
    } else {
      Fox.successful(emptyBucket)
    }
  }

  /**
    * Given a list of loaded buckets, cutout the data of the cuboid
    */
  private def cutOutCuboid(request: DataServiceDataRequest, rs: List[(BucketPosition, Array[Byte])]): Array[Byte] = {
    val bytesPerElement = request.dataLayer.bytesPerElement
    val cuboid = request.cuboid
    val result = new Array[Byte](cuboid.volume * bytesPerElement)
    val bucketLength = request.dataLayer.lengthOfProvidedBuckets

    rs.reverse.foreach {
      case (bucket, data) =>
        val x = math.max(cuboid.topLeft.x, bucket.topLeft.x)
        var y = math.max(cuboid.topLeft.y, bucket.topLeft.y)
        var z = math.max(cuboid.topLeft.z, bucket.topLeft.z)

        val xMax = math.min(bucket.topLeft.x + bucketLength, cuboid.bottomRight.x)
        val yMax = math.min(bucket.topLeft.y + bucketLength, cuboid.bottomRight.y)
        val zMax = math.min(bucket.topLeft.z + bucketLength, cuboid.bottomRight.z)

        while (z < zMax) {
          y = math.max(cuboid.topLeft.y, bucket.topLeft.y)
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

  private def convertToHalfByte(a: Array[Byte]) = {
    val aSize = a.length
    val compressedSize = (aSize + 1) / 2
    val compressed = new Array[Byte](compressedSize)
    var i = 0
    while (i * 2 + 1 < aSize) {
      val first = (a(i * 2) & 0xF0).toByte
      val second = (a(i * 2 + 1) & 0xF0).toByte >> 4 & 0x0F
      val value = (first | second).asInstanceOf[Byte]
      compressed(i) = value
      i += 1
    }
    compressed
  }
}
