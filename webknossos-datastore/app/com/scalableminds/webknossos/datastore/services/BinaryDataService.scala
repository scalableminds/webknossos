package com.scalableminds.webknossos.datastore.services

import java.nio.file.Paths

import com.google.inject.Inject
import com.newrelic.api.agent.NewRelic
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.datastore.models.requests.{DataReadInstruction, DataServiceDataRequest, DataServiceMappingRequest, MappingReadInstruction}
import com.scalableminds.webknossos.datastore.storage.{CachedCube, DataCubeCache}
import com.scalableminds.util.tools.ExtendedTypes.ExtendedArraySeq
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.dataformats.BucketProvider
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}
import play.api.Configuration

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future
import scala.concurrent.duration._

class BinaryDataService @Inject()(config: DataStoreConfig) extends FoxImplicits with LazyLogging {

  val dataBaseDir = Paths.get(config.Braingames.Binary.baseFolder)

  val loadTimeout: FiniteDuration = config.Braingames.Binary.loadTimeout

  val maxCacheSize: Int = config.Braingames.Binary.cacheMaxSize

  lazy val cache = new DataCubeCache(maxCacheSize)

  def handleDataRequests(requests: List[DataServiceDataRequest]): Fox[(Array[Byte], List[Int])] = {
    val requestsCount = requests.length
    val requestData = requests.zipWithIndex.map { case (request, index) =>
      getDataForRequest(request).map { data =>
        if (request.settings.halfByte) {
          (convertToHalfByte(data), index)
        } else {
          (data, index)
        }
      }
    }

    Fox.sequenceOfFulls(requestData).map{l =>
      val bytesArrays = l.map{case (byteArray, _) => byteArray}
      val foundIndices = l.map{case (_, index) => index}
      val notFoundIndices = List.range(0,requestsCount).diff(foundIndices)
      (bytesArrays.appendArrays, notFoundIndices)
    }
  }

  def handleMappingRequest(request: DataServiceMappingRequest): Fox[Array[Byte]] = {
    val readInstruction = MappingReadInstruction(dataBaseDir, request.dataSource, request.mapping)
    request.dataLayer.mappingProvider.load(readInstruction)
  }

  private def getDataForRequest(request: DataServiceDataRequest): Fox[Array[Byte]] = {

    def isSingleBucketRequest = {
      val bucketLength = DataLayer.bucketLength
      request.cuboid.width == bucketLength &&
        request.cuboid.height == bucketLength &&
        request.cuboid.depth == bucketLength &&
        request.cuboid.topLeft == request.cuboid.topLeft.toBucket.topLeft
    }

    val bucketQueue = request.cuboid.allBucketsInCuboid

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
    if (request.dataLayer.doesContainBucket(bucket) && request.dataLayer.containsResolution(bucket.resolution)) {
      val readInstruction = DataReadInstruction(
        dataBaseDir,
        request.dataSource,
        request.dataLayer,
        bucket)

      request.dataLayer.bucketProvider.load(readInstruction, cache, loadTimeout)
    } else {
      Fox.empty
    }
  }

  /**
    * Given a list of loaded buckets, cutout the data of the cuboid
    */
  private def cutOutCuboid(request: DataServiceDataRequest, rs: List[(BucketPosition, Array[Byte])]): Array[Byte] = {
    val bytesPerElement = request.dataLayer.bytesPerElement
    val cuboid = request.cuboid
    val result = new Array[Byte](cuboid.volume * bytesPerElement)
    val bucketLength = DataLayer.bucketLength

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

  def clearCache(organizationName: String, dataSetName: String) = {
    def matchingPredicate(cubeKey: CachedCube) = {
      cubeKey.dataSourceName == dataSetName
    }

    cache.clear(matchingPredicate)
  }
}
