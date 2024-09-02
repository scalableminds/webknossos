package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.ExtendedTypes.ExtendedArraySeq
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.helpers.DatasetDeleter
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.{Category, DataLayer, DataSourceId}
import com.scalableminds.webknossos.datastore.models.requests.{DataReadInstruction, DataServiceDataRequest}
import com.scalableminds.webknossos.datastore.storage._
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Failure, Full}
import ucar.ma2.{Array => MultiArray}
import net.liftweb.common.Box.tryo

import java.nio.file.Path
import scala.concurrent.ExecutionContext

class BinaryDataService(val dataBaseDir: Path,
                        val agglomerateServiceOpt: Option[AgglomerateService],
                        remoteSourceDescriptorServiceOpt: Option[RemoteSourceDescriptorService],
                        val applicationHealthService: Option[ApplicationHealthService],
                        sharedChunkContentsCache: Option[AlfuCache[String, MultiArray]],
                        datasetErrorLoggingService: Option[DatasetErrorLoggingService])(implicit ec: ExecutionContext)
    extends FoxImplicits
    with DatasetDeleter
    with LazyLogging {

  /* Note that this must stay in sync with the front-end constant MAX_MAG_FOR_AGGLOMERATE_MAPPING
     compare https://github.com/scalableminds/webknossos/issues/5223 */
  private val MaxMagForAgglomerateMapping = 16

  private lazy val bucketProviderCache = new BucketProviderCache(maxEntries = 5000)

  def handleDataRequest(request: DataServiceDataRequest): Fox[Array[Byte]] = {
    val bucketQueue = request.cuboid.allBucketsInCuboid

    if (!request.cuboid.hasValidDimensions) {
      Fox.failure("Invalid cuboid dimensions (must be > 0 and <= 512).")
    } else if (request.cuboid.isSingleBucket(DataLayer.bucketLength)) {
      bucketQueue.headOption.toFox.flatMap { bucket =>
        handleBucketRequest(request, bucket.copy(additionalCoordinates = request.settings.additionalCoordinates))
      }
    } else {
      Fox.sequence {
        bucketQueue.toList.map { bucket =>
          handleBucketRequest(request, bucket.copy(additionalCoordinates = request.settings.additionalCoordinates))
            .map(r => bucket -> r)
        }
      }.map(buckets => cutOutCuboid(request, buckets.flatten))
    }
  }

  def handleDataRequests(requests: List[DataServiceDataRequest]): Fox[(Array[Byte], List[Int])] = {
    def convertIfNecessary(isNecessary: Boolean,
                           inputArray: Array[Byte],
                           conversionFunc: Array[Byte] => Box[Array[Byte]]): Box[Array[Byte]] =
      if (isNecessary) conversionFunc(inputArray) else Full(inputArray)

    val requestsCount = requests.length
    val requestData = requests.zipWithIndex.map {
      case (request, index) =>
        for {
          data <- handleDataRequest(request)
          mappedData <- agglomerateServiceOpt.map { agglomerateService =>
            convertIfNecessary(
              request.settings.appliedAgglomerate.isDefined && request.dataLayer.category == Category.segmentation && request.cuboid.mag.maxDim <= MaxMagForAgglomerateMapping,
              data,
              agglomerateService.applyAgglomerate(request)
            )
          }.getOrElse(Full(data)) ?~> "Failed to apply agglomerate mapping"
          resultData <- convertIfNecessary(request.settings.halfByte, mappedData, convertToHalfByte)
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
      // dataSource is null and unused for volume tracings. Insert dummy DataSourceId (also unused in that case)
      val dataSourceId = if (request.dataSource != null) request.dataSource.id else DataSourceId("", "")
      val bucketProvider =
        bucketProviderCache.getOrLoadAndPut((dataSourceId, request.dataLayer.bucketProviderCacheKey))(_ =>
          request.dataLayer.bucketProvider(remoteSourceDescriptorServiceOpt, dataSourceId, sharedChunkContentsCache))
      bucketProvider.load(readInstruction).futureBox.flatMap {
        case Failure(msg, Full(e: InternalError), _) =>
          applicationHealthService.foreach(a => a.pushError(e))
          logger.error(
            s"Caught internal error: $msg while loading a bucket for layer ${request.dataLayer.name} of dataset ${request.dataSource.id}")
          Fox.failure(e.getMessage)
        case f: Failure =>
          if (datasetErrorLoggingService.exists(_.shouldLog(request.dataSource.id.team, request.dataSource.id.name))) {
            logger.error(
              s"Bucket loading for layer ${request.dataLayer.name} of dataset ${request.dataSource.id.team}/${request.dataSource.id.name} at ${readInstruction.bucket} failed: ${Fox
                .failureChainAsString(f, includeStackTraces = true)}")
            datasetErrorLoggingService.foreach(_.registerLogged(request.dataSource.id.team, request.dataSource.id.name))
          }
          f.toFox
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
    val subsamplingStrides = Vec3Int.ones

    val resultShape = Vec3Int(cuboid.width, cuboid.height, cuboid.depth)
    val result = new Array[Byte](cuboid.volume * bytesPerElement)
    val bucketLength = DataLayer.bucketLength

    rs.reverse.foreach {
      case (bucket, data) =>
        val xMin = math.max(cuboid.topLeft.voxelXInMag, bucket.topLeft.voxelXInMag)
        val yMin = math.max(cuboid.topLeft.voxelYInMag, bucket.topLeft.voxelYInMag)
        val zMin = math.max(cuboid.topLeft.voxelZInMag, bucket.topLeft.voxelZInMag)

        val xMax = math.min(cuboid.bottomRight.voxelXInMag, bucket.topLeft.voxelXInMag + bucketLength)
        val yMax = math.min(cuboid.bottomRight.voxelYInMag, bucket.topLeft.voxelYInMag + bucketLength)
        val zMax = math.min(cuboid.bottomRight.voxelZInMag, bucket.topLeft.voxelZInMag + bucketLength)

        for {
          z <- zMin until zMax
          y <- yMin until yMax
          // We can bulk copy a row of voxels and do not need to iterate in the x dimension
        } {
          val dataOffset =
            (xMin % bucketLength +
              y % bucketLength * bucketLength +
              z % bucketLength * bucketLength * bucketLength) * bytesPerElement

          val rx = (xMin - cuboid.topLeft.voxelXInMag) / subsamplingStrides.x
          val ry = (y - cuboid.topLeft.voxelYInMag) / subsamplingStrides.y
          val rz = (z - cuboid.topLeft.voxelZInMag) / subsamplingStrides.z

          val resultOffset = (rx + ry * resultShape.x + rz * resultShape.x * resultShape.y) * bytesPerElement
          System.arraycopy(data, dataOffset, result, resultOffset, (xMax - xMin) * bytesPerElement)
        }
    }
    result
  }

  private def convertToHalfByte(a: Array[Byte]): Box[Array[Byte]] = tryo {
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

  def clearCache(organizationId: String, datasetName: String, layerName: Option[String]): (Int, Int, Int) = {
    val dataSourceId = DataSourceId(datasetName, organizationId)

    def agglomerateFileMatchPredicate(agglomerateKey: AgglomerateFileKey) =
      agglomerateKey.datasetName == datasetName && agglomerateKey.organizationId == organizationId && layerName.forall(
        _ == agglomerateKey.layerName)

    def bucketProviderPredicate(key: (DataSourceId, String)): Boolean =
      key._1 == DataSourceId(datasetName, organizationId) && layerName.forall(_ == key._2)

    val closedAgglomerateFileHandleCount =
      agglomerateServiceOpt.map(_.agglomerateFileCache.clear(agglomerateFileMatchPredicate)).getOrElse(0)

    val clearedBucketProviderCount = bucketProviderCache.clear(bucketProviderPredicate)

    def chunkContentsPredicate(key: String): Boolean =
      key.startsWith(s"${dataSourceId.toString}") && layerName.forall(l =>
        key.startsWith(s"${dataSourceId.toString}__$l"))

    val removedChunksCount = sharedChunkContentsCache.map(_.clear(chunkContentsPredicate)).getOrElse(0)

    (closedAgglomerateFileHandleCount, clearedBucketProviderCount, removedChunksCount)
  }

}
