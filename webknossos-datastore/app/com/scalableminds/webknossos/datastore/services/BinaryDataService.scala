package com.scalableminds.webknossos.datastore.services

import java.io.File
import java.nio.file.{Files, Path}

import com.scalableminds.util.geometry.{Point3D, Vector3I}
import com.scalableminds.util.tools.ExtendedTypes.ExtendedArraySeq
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.{Category, DataLayer, ElementClass}
import com.scalableminds.webknossos.datastore.models.requests.{DataReadInstruction, DataServiceDataRequest}
import com.scalableminds.webknossos.datastore.storage.{AgglomerateFileKey, CachedCube, DataCubeCache}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Full

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration._

class BinaryDataService(dataBaseDir: Path,
                        loadTimeout: FiniteDuration,
                        maxCacheSize: Int,
                        val agglomerateService: AgglomerateService)
    extends FoxImplicits
    with LazyLogging {

  lazy val cache = new DataCubeCache(maxCacheSize)

  def handleDataRequest(request: DataServiceDataRequest): Fox[Array[Byte]] = {
    val bucketQueue = request.cuboid.allBucketsInCuboid

    if (!request.cuboid.hasValidDimensions) {
      Fox.failure("Invalid cuboid dimensions (must be > 0 and <= 512).")
    } else if (request.cuboid.isSingleBucket(DataLayer.bucketLength) && request.voxelDimensions == Vector3I(1, 1, 1)) {
      bucketQueue.headOption.toFox.flatMap { bucket =>
        handleBucketRequest(request, bucket)
      }
    } else {
      Fox
        .serialSequence(bucketQueue.toList) { bucket =>
          handleBucketRequest(request, bucket).map(r => bucket -> r)
        }
        .map(buckets => cutOutCuboid(request, buckets.flatten))
    }
  }

  def handleDataRequests(requests: List[DataServiceDataRequest]): Fox[(Array[Byte], List[Int])] = {
    def convertIfNecessary[T](isNecessary: Boolean,
                              inputArray: Array[Byte],
                              conversionFunc: Array[Byte] => Array[Byte]): Array[Byte] =
      if (isNecessary) conversionFunc(inputArray) else inputArray

    val requestsCount = requests.length
    val requestData = requests.zipWithIndex.map {
      case (request, index) =>
        for {
          data <- handleDataRequest(request)
          mappedData = convertIfNecessary(
            request.settings.appliedAgglomerate.isDefined && request.dataLayer.category == Category.segmentation && request.cuboid.resolution.maxDim <= 16,
            data,
            agglomerateService.applyAgglomerate(request)
          )
          convertedData = convertIfNecessary(
            request.dataLayer.elementClass == ElementClass.uint64 && request.dataLayer.category == Category.segmentation,
            mappedData,
            convertToUInt32)
          resultData = convertIfNecessary(request.settings.halfByte, convertedData, convertToHalfByte)
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
    if (request.dataLayer.doesContainBucket(bucket) && request.dataLayer.containsResolution(bucket.resolution)) {
      val readInstruction =
        DataReadInstruction(dataBaseDir, request.dataSource, request.dataLayer, bucket, request.settings.version)

      request.dataLayer.bucketProvider.load(readInstruction, cache, loadTimeout)
    } else {
      Fox.empty
    }

  /**
    * Given a list of loaded buckets, cutout the data of the cuboid
    */
  private def cutOutCuboid(request: DataServiceDataRequest, rs: List[(BucketPosition, Array[Byte])]): Array[Byte] = {
    val bytesPerElement = request.dataLayer.bytesPerElement
    val cuboid = request.cuboid
    val voxelDimensions = request.voxelDimensions

    val resultVolume = Point3D(
      math.ceil(cuboid.width.toDouble / voxelDimensions.x.toDouble).toInt,
      math.ceil(cuboid.height.toDouble / voxelDimensions.y.toDouble).toInt,
      math.ceil(cuboid.depth.toDouble / voxelDimensions.z.toDouble).toInt
    )
    val result = new Array[Byte](resultVolume.x * resultVolume.y * resultVolume.z * bytesPerElement)
    val bucketLength = DataLayer.bucketLength

    rs.reverse.foreach {
      case (bucket, data) =>
        val xRemainder = cuboid.topLeft.x % voxelDimensions.x
        val yRemainder = cuboid.topLeft.y % voxelDimensions.y
        val zRemainder = cuboid.topLeft.z % voxelDimensions.z

        val xMin = math
          .ceil((math.max(cuboid.topLeft.x, bucket.topLeft.x).toDouble - xRemainder) / voxelDimensions.x.toDouble)
          .toInt * voxelDimensions.x + xRemainder
        val yMin = math
          .ceil((math.max(cuboid.topLeft.y, bucket.topLeft.y).toDouble - yRemainder) / voxelDimensions.y.toDouble)
          .toInt * voxelDimensions.y + yRemainder
        val zMin = math
          .ceil((math.max(cuboid.topLeft.z, bucket.topLeft.z).toDouble - zRemainder) / voxelDimensions.z.toDouble)
          .toInt * voxelDimensions.z + zRemainder

        val xMax = math.min(cuboid.bottomRight.x, bucket.topLeft.x + bucketLength)
        val yMax = math.min(cuboid.bottomRight.y, bucket.topLeft.y + bucketLength)
        val zMax = math.min(cuboid.bottomRight.z, bucket.topLeft.z + bucketLength)

        for {
          z <- zMin until zMax by voxelDimensions.z
          y <- yMin until yMax by voxelDimensions.y
          // if voxelDimensions.x == 1, we can bulk copy a row of voxels and do not need to iterate in the x dimension
          x <- xMin until xMax by (if (voxelDimensions.x == 1) xMax else voxelDimensions.x)
        } {
          val dataOffset =
            (x % bucketLength +
              y % bucketLength * bucketLength +
              z % bucketLength * bucketLength * bucketLength) * bytesPerElement

          val rx = (x - cuboid.topLeft.x) / voxelDimensions.x
          val ry = (y - cuboid.topLeft.y) / voxelDimensions.y
          val rz = (z - cuboid.topLeft.z) / voxelDimensions.z

          val resultOffset = (rx + ry * resultVolume.x + rz * resultVolume.x * resultVolume.y) * bytesPerElement
          if (voxelDimensions.x == 1) {
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

  private def convertToUInt32(a: Array[Byte]) = {
    val result = new Array[Byte](a.length / 2)

    for (i <- a.indices by 8) {
      for (j <- 0 until 4) {
        result(i / 2 + j) = a(i + j)
      }
    }
    result
  }

  def clearCache(organizationName: String, dataSetName: String, layerName: Option[String]) = {
    def matchingPredicate(cubeKey: CachedCube) =
      cubeKey.dataSourceName == dataSetName && cubeKey.organization == organizationName && layerName.forall(
        _ == cubeKey.dataLayerName)

    def matchingAgglomerate(agglomerateKey: AgglomerateFileKey) =
      agglomerateKey.dataSourceName == dataSetName && agglomerateKey.organization == organizationName && layerName
        .forall(_ == agglomerateKey.dataLayerName)

    agglomerateService.agglomerateFileCache.clear(matchingAgglomerate)
    cache.clear(matchingPredicate)
  }

  def deleteOnDisk(organizationName: String, dataSetName: String): Fox[Unit] = {
    val dataSourcePath = dataBaseDir.resolve(organizationName).resolve(dataSetName)
    val trashPath: Path = dataBaseDir.resolve(organizationName).resolve(".trash")
    val targetPath = trashPath.resolve(dataSetName)
    new File(trashPath.toString).mkdirs()

    logger.info(s"Deleting dataset by moving it from $dataSourcePath to $targetPath...")

    try {
      val path = Files.move(
        dataSourcePath,
        targetPath
      )
      if (path == null) {
        throw new Exception("Deleting dataset failed")
      }
      logger.info(s"Successfully moved dataset from $dataSourcePath to $targetPath...")
      Fox.successful(())
    } catch {
      case e: Exception => Fox.failure(s"Deleting dataset failed: ${e.toString}", Full(e))
    }
  }
}
