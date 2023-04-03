package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.ExtendedTypes.ExtendedArraySeq
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.helpers.DataSetDeleter
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.{Category, DataLayer}
import com.scalableminds.webknossos.datastore.models.requests.{DataReadInstruction, DataServiceDataRequest}
import com.scalableminds.webknossos.datastore.storage._
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Failure, Full}

import java.nio.file.Path
import scala.concurrent.ExecutionContext.Implicits.global

class BinaryDataService(val dataBaseDir: Path,
                        maxCacheSize: Int,
                        val agglomerateServiceOpt: Option[AgglomerateService],
                        dataVaultServiceOpt: Option[DataVaultService],
                        val applicationHealthService: Option[ApplicationHealthService])
    extends FoxImplicits
    with DataSetDeleter
    with LazyLogging {

  /* Note that this must stay in sync with the front-end constant
    compare https://github.com/scalableminds/webknossos/issues/5223 */
  private val MaxMagForAgglomerateMapping = 16

  private lazy val shardHandleCache = new DataCubeCache(maxCacheSize)
  private lazy val bucketProviderCache = new BucketProviderCache(maxEntries = 5000)

  def handleDataRequest(request: DataServiceDataRequest): Fox[Array[Byte]] = {
    val bucketQueue = request.cuboid.allBucketsInCuboid

    if (!request.cuboid.hasValidDimensions) {
      Fox.failure("Invalid cuboid dimensions (must be > 0 and <= 512).")
    } else if (request.cuboid.isSingleBucket(DataLayer.bucketLength) && request.subsamplingStrides == Vec3Int(1, 1, 1)) {
      bucketQueue.headOption.toFox.flatMap { bucket =>
        handleBucketRequest(request, bucket)
      }
    } else {
      Fox.sequence {
        bucketQueue.toList.map { bucket =>
          handleBucketRequest(request, bucket).map(r => bucket -> r)
        }
      }.map(buckets => cutOutCuboid(request, buckets.flatten))
    }
  }

  def handleDataRequests(requests: List[DataServiceDataRequest]): Fox[(Array[Byte], List[Int])] = {
    def convertIfNecessary(isNecessary: Boolean,
                           inputArray: Array[Byte],
                           conversionFunc: Array[Byte] => Array[Byte]): Array[Byte] =
      if (isNecessary) conversionFunc(inputArray) else inputArray

    val requestsCount = requests.length
    val requestData = requests.zipWithIndex.map {
      case (request, index) =>
        for {
          data <- handleDataRequest(request)
          mappedData = agglomerateServiceOpt.map { agglomerateService =>
            convertIfNecessary(
              request.settings.appliedAgglomerate.isDefined && request.dataLayer.category == Category.segmentation && request.cuboid.mag.maxDim <= MaxMagForAgglomerateMapping,
              data,
              agglomerateService.applyAgglomerate(request)
            )
          }.getOrElse(data)
          resultData = convertIfNecessary(request.settings.halfByte, mappedData, convertToHalfByte)
        } yield (resultData, index)
    }

    Fox.sequenceOfFulls(requestData).map { l =>
      val bytesArrays = l.map { case (byteArray, _) => byteArray }
      val foundIndices = l.map { case (_, index)    => index }
      val notFoundIndices = List.range(0, requestsCount).diff(foundIndices)
      (bytesArrays.appendArrays, notFoundIndices)
    }
  }

  private def handleBucketRequest(request: DataServiceDataRequest, bucket: BucketPosition): Fox[Array[Byte]] =
    if (request.dataLayer.doesContainBucket(bucket) && request.dataLayer.containsResolution(bucket.mag)) {
      val readInstruction =
        DataReadInstruction(dataBaseDir, request.dataSource, request.dataLayer, bucket, request.settings.version)
      val bucketProvider = bucketProviderCache.getOrLoadAndPut(request.dataLayer)(dataLayer =>
        dataLayer.bucketProvider(dataVaultServiceOpt))
      bucketProvider.load(readInstruction, shardHandleCache).futureBox.flatMap {
        case Failure(msg, Full(e: InternalError), _) =>
          applicationHealthService.foreach(a => a.pushError(e))
          logger.warn(
            s"Caught internal error: $msg while loading a bucket for layer ${request.dataLayer.name} of dataset ${request.dataSource.id}")
          Fox.failure(e.getMessage)
        case Full(data) =>
          if (data.length == 0) {
            val msg =
              s"Bucket provider returned Full, but data is zero-length array. Layer ${request.dataLayer.name} of dataset ${request.dataSource.id}, ${request.cuboid}"
            logger.warn(msg)
            Fox.failure(msg)

          } else Fox.successful(data)
        case other => other.toFox
      }
    } else Fox.empty

  /**
    * Given a list of loaded buckets, cut out the data of the cuboid
    */
  private def cutOutCuboid(request: DataServiceDataRequest, rs: List[(BucketPosition, Array[Byte])]): Array[Byte] = {
    val bytesPerElement = request.dataLayer.bytesPerElement
    val cuboid = request.cuboid
    val subsamplingStrides = request.subsamplingStrides

    val resultVolume = Vec3Int(
      math.ceil(cuboid.width.toDouble / subsamplingStrides.x.toDouble).toInt,
      math.ceil(cuboid.height.toDouble / subsamplingStrides.y.toDouble).toInt,
      math.ceil(cuboid.depth.toDouble / subsamplingStrides.z.toDouble).toInt
    )
    val result = new Array[Byte](resultVolume.x * resultVolume.y * resultVolume.z * bytesPerElement)
    val bucketLength = DataLayer.bucketLength

    rs.reverse.foreach {
      case (bucket, data) =>
        val xRemainder = cuboid.topLeft.voxelXInMag % subsamplingStrides.x
        val yRemainder = cuboid.topLeft.voxelYInMag % subsamplingStrides.y
        val zRemainder = cuboid.topLeft.voxelZInMag % subsamplingStrides.z

        val xMin = math
          .ceil(
            (math
              .max(cuboid.topLeft.voxelXInMag, bucket.topLeft.voxelXInMag)
              .toDouble - xRemainder) / subsamplingStrides.x.toDouble)
          .toInt * subsamplingStrides.x + xRemainder
        val yMin = math
          .ceil(
            (math
              .max(cuboid.topLeft.voxelYInMag, bucket.topLeft.voxelYInMag)
              .toDouble - yRemainder) / subsamplingStrides.y.toDouble)
          .toInt * subsamplingStrides.y + yRemainder
        val zMin = math
          .ceil(
            (math
              .max(cuboid.topLeft.voxelZInMag, bucket.topLeft.voxelZInMag)
              .toDouble - zRemainder) / subsamplingStrides.z.toDouble)
          .toInt * subsamplingStrides.z + zRemainder

        val xMax = math.min(cuboid.bottomRight.voxelXInMag, bucket.topLeft.voxelXInMag + bucketLength)
        val yMax = math.min(cuboid.bottomRight.voxelYInMag, bucket.topLeft.voxelYInMag + bucketLength)
        val zMax = math.min(cuboid.bottomRight.voxelZInMag, bucket.topLeft.voxelZInMag + bucketLength)

        for {
          z <- zMin until zMax by subsamplingStrides.z
          y <- yMin until yMax by subsamplingStrides.y
          // if subsamplingStrides.x == 1, we can bulk copy a row of voxels and do not need to iterate in the x dimension
          x <- xMin until xMax by (if (subsamplingStrides.x == 1) xMax else subsamplingStrides.x)
        } {
          val dataOffset =
            (x % bucketLength +
              y % bucketLength * bucketLength +
              z % bucketLength * bucketLength * bucketLength) * bytesPerElement

          val rx = (x - cuboid.topLeft.voxelXInMag) / subsamplingStrides.x
          val ry = (y - cuboid.topLeft.voxelYInMag) / subsamplingStrides.y
          val rz = (z - cuboid.topLeft.voxelZInMag) / subsamplingStrides.z

          val resultOffset = (rx + ry * resultVolume.x + rz * resultVolume.x * resultVolume.y) * bytesPerElement
          if (subsamplingStrides.x == 1) {
            // bulk copy a row of voxels
            System.arraycopy(data, dataOffset, result, resultOffset, (xMax - x) * bytesPerElement)
          } else {
            // copy single voxel
            System.arraycopy(data, dataOffset, result, resultOffset, bytesPerElement)
          }
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

  def clearCache(organizationName: String, dataSetName: String, layerName: Option[String]): (Int, Int) = {
    def dataCubeMatchPredicate(cubeKey: CachedCube) =
      cubeKey.dataSourceName == dataSetName && cubeKey.organization == organizationName && layerName.forall(
        _ == cubeKey.dataLayerName)

    def agglomerateFileMatchPredicate(agglomerateKey: AgglomerateFileKey) =
      agglomerateKey.dataSetName == dataSetName && agglomerateKey.organizationName == organizationName && layerName
        .forall(_ == agglomerateKey.layerName)

    val closedAgglomerateFileHandleCount =
      agglomerateServiceOpt.map(_.agglomerateFileCache.clear(agglomerateFileMatchPredicate)).getOrElse(0)
    val closedDataCubeHandleCount = shardHandleCache.clear(dataCubeMatchPredicate)
    (closedAgglomerateFileHandleCount, closedDataCubeHandleCount)
  }

}
