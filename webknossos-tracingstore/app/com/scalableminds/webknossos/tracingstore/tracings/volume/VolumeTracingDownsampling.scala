package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.{BucketPosition, UnsignedIntegerArray}
import com.scalableminds.webknossos.datastore.models.datasource.{DataSource, DataSourceLike, ElementClass}
import com.scalableminds.webknossos.tracingstore.TracingStoreWkRpcClient
import com.scalableminds.webknossos.tracingstore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.tracingstore.tracings.{
  KeyValueStoreImplicits,
  ProtoGeometryImplicits,
  TracingDataStore,
  VersionedKeyValuePair
}

import scala.collection.mutable
import scala.concurrent.ExecutionContext
import scala.reflect.ClassTag

trait VolumeTracingDownsampling
    extends BucketKeys
    with ProtoGeometryImplicits
    with VolumeBucketCompression
    with KeyValueStoreImplicits {

  val tracingDataStore: TracingDataStore
  val tracingStoreWkRpcClient: TracingStoreWkRpcClient
  def saveBucket(dataLayer: VolumeTracingLayer,
                 bucket: BucketPosition,
                 data: Array[Byte],
                 version: Long,
                 toCache: Boolean = false): Fox[Unit]

  private def fillMapWithInitialBucketsInplace(bucketDataMap: mutable.HashMap[BucketPosition, Array[Byte]],
                                               tracingId: String,
                                               dataLayer: VolumeTracingLayer): Unit = {
    val data: List[VersionedKeyValuePair[Array[Byte]]] =
      tracingDataStore.volumeData.getMultipleKeys(tracingId, Some(tracingId))
    data.foreach { keyValuePair: VersionedKeyValuePair[Array[Byte]] =>
      val bucketPosition = parseBucketKey(keyValuePair.key).map(_._2)
      bucketPosition.foreach {
        bucketDataMap(_) = decompressIfNeeded(keyValuePair.value,
                                              expectedUncompressedBucketSizeFor(dataLayer),
                                              s"bucket $bucketPosition during downsampling")
      }
    }
  }

  def downsampleWithLayer(tracingId: String, tracing: VolumeTracing, dataLayer: VolumeTracingLayer)(
      implicit ec: ExecutionContext): Fox[Unit] = {
    //TODO:
    // - skip if already downsampled
    // - list all keys first, before fetching actual data
    // - update tracing version? can the user restore not-downsampled old versions, what happens?
    val bucketVolume = 32 * 32 * 32
    val originalMag = Point3D(1, 1, 1)
    for {
      requiredMags <- getRequiredMags(tracing)
      elementClass = elementClassFromProto(tracing.elementClass)
      bucketDataMap = new mutable.HashMap[BucketPosition, Array[Byte]]() {
        override def default(key: BucketPosition): Array[Byte] = Array[Byte](0)
      }
      _ = fillMapWithInitialBucketsInplace(bucketDataMap, tracingId, dataLayer)
      originalBucketPositions: List[BucketPosition] = bucketDataMap.keys.toList
      updatedBuckets = new mutable.HashSet[BucketPosition]()
      _ = requiredMags.foldLeft(originalMag) { (previousMag, requiredMag) =>
        downsampleMagFromMag(previousMag,
                             requiredMag,
                             originalBucketPositions,
                             bucketDataMap,
                             updatedBuckets,
                             bucketVolume,
                             elementClass,
                             dataLayer)
        //logger.info(s"bucketDataMap keys: ${bucketDataMap.keys.toList}")
        requiredMag
      }
      _ <- Fox.serialCombined(updatedBuckets.toList) { bucketPosition: BucketPosition =>
        //logger.info(s"saving bucket $bucketPosition")
        saveBucket(dataLayer, bucketPosition, bucketDataMap(bucketPosition), tracing.version)
      }
    } yield ()
  }

  private def downsampleMagFromMag(previousMag: Point3D,
                                   requiredMag: Point3D,
                                   originalBucketPositions: List[BucketPosition],
                                   bucketDataMap: mutable.HashMap[BucketPosition, Array[Byte]],
                                   updatedBuckets: mutable.HashSet[BucketPosition],
                                   bucketVolume: Int,
                                   elementClass: ElementClass.Value,
                                   dataLayer: VolumeTracingLayer): Unit = {
    //logger.info(s"downsampling volume tracing mag $requiredMag from mag $previousMag...")
    val downScaleFactor =
      Point3D(requiredMag.x / previousMag.x, requiredMag.y / previousMag.y, requiredMag.z / previousMag.z)
    downsampledBucketPositions(originalBucketPositions, requiredMag).foreach { downsampledBucketPosition =>
      val sourceBuckets: Seq[BucketPosition] =
        sourceBucketPositionsFor(downsampledBucketPosition, downScaleFactor, previousMag)
      //logger.info(s"source buckets for bucket $downsampledBucketPosition: ${sourceBuckets}")
      val sourceData: Seq[Array[Byte]] = sourceBuckets.map(bucketDataMap(_))
      val downsampledData: Array[Byte] =
        if (sourceData.forall(_.sameElements(Array[Byte](0))))
          Array[Byte](0)
        else {
          val sourceDataFilled = fillZeroedIfNeeded(sourceData, bucketVolume, dataLayer.bytesPerElement)
          val sourceDataTyped = UnsignedIntegerArray.fromByteArray(sourceDataFilled.toArray.flatten, elementClass)
          val dataDownscaledTyped =
            downsampleData(sourceDataTyped.grouped(bucketVolume).toArray, downScaleFactor, bucketVolume)
          UnsignedIntegerArray.toByteArray(dataDownscaledTyped, elementClass)
        }
      bucketDataMap(downsampledBucketPosition) = downsampledData
      updatedBuckets.add(downsampledBucketPosition)
    }
  }

  private def downsampledBucketPositions(originalBucketPositions: List[BucketPosition],
                                         requiredMag: Point3D): Set[BucketPosition] =
    originalBucketPositions.map { bucketPosition: BucketPosition =>
      BucketPosition(
        (bucketPosition.globalX / requiredMag.x / 32) * requiredMag.x * 32,
        (bucketPosition.globalY / requiredMag.y / 32) * requiredMag.y * 32,
        (bucketPosition.globalZ / requiredMag.z / 32) * requiredMag.z * 32,
        requiredMag
      )
    }.toSet

  private def sourceBucketPositionsFor(bucketPosition: BucketPosition,
                                       downScaleFactor: Point3D,
                                       previousMag: Point3D): Seq[BucketPosition] =
    for {
      z <- 0 until downScaleFactor.z
      y <- 0 until downScaleFactor.y
      x <- 0 until downScaleFactor.x
    } yield {
      BucketPosition(
        bucketPosition.globalX + x * bucketPosition.bucketLength * previousMag.x,
        bucketPosition.globalY + y * bucketPosition.bucketLength * previousMag.y,
        bucketPosition.globalZ + z * bucketPosition.bucketLength * previousMag.z,
        previousMag
      )
    }

  private def fillZeroedIfNeeded(sourceData: Seq[Array[Byte]],
                                 bucketVolume: Int,
                                 bytesPerElement: Int): Seq[Array[Byte]] =
    // Reverted buckets and missing buckets arer epresented by a single zero-byte.
    // For downsampling, those need to be replaced with the full bucket volume of zero-bytes.
    sourceData.map { sourceBucketData =>
      if (sourceBucketData.sameElements(Array[Byte](0))) {
        Array.fill[Byte](bucketVolume * bytesPerElement)(0)
      } else sourceBucketData
    }

  private def downsampleData[T: ClassTag](data: Array[Array[T]],
                                          downScaleFactor: Point3D,
                                          bucketVolume: Int): Array[T] = {
    val result = new Array[T](bucketVolume)
    for {
      z <- 0 until 32
      y <- 0 until 32
      x <- 0 until 32
    } {
      val voxelSourceData: IndexedSeq[T] = for {
        z_offset <- 0 until downScaleFactor.z
        y_offset <- 0 until downScaleFactor.y
        x_offset <- 0 until downScaleFactor.x
      } yield {
        val sourceVoxelPosition =
          Point3D(x * downScaleFactor.x + x_offset, y * downScaleFactor.y + y_offset, z * downScaleFactor.z + z_offset)
        val sourceBucketPosition =
          Point3D(sourceVoxelPosition.x / 32, sourceVoxelPosition.y / 32, sourceVoxelPosition.z / 32)
        val sourceVoxelPositionInSourceBucket =
          Point3D(sourceVoxelPosition.x % 32, sourceVoxelPosition.y % 32, sourceVoxelPosition.z % 32)
        val sourceBucketIndex = sourceBucketPosition.x + sourceBucketPosition.y * downScaleFactor.y + sourceBucketPosition.z * downScaleFactor.y * downScaleFactor.z
        val sourceVoxelIndex = sourceVoxelPositionInSourceBucket.x + sourceVoxelPositionInSourceBucket.y * 32 + sourceVoxelPositionInSourceBucket.z * 32 * 32
        data(sourceBucketIndex)(sourceVoxelIndex)
      }
      result(x + y * 32 + z * 32 * 32) = mode(voxelSourceData)
    }
    result
  }

  private def mode[T](items: Seq[T]): T =
    items.groupBy(i => i).mapValues(_.size).maxBy(_._2)._1

  private def getRequiredMags(tracing: VolumeTracing): Fox[Seq[Point3D]] =
    for {
      dataSource: DataSourceLike <- tracingStoreWkRpcClient.getDataSource(tracing.organizationName, tracing.dataSetName)
      mags = dataSource.dataLayers.flatMap(_.resolutions).distinct.sortBy(_.maxDim).filterNot(_.maxDim == 1)
    } yield mags

}
