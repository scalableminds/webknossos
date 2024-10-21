package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.{BucketPosition, UnsignedIntegerArray}
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayerLike, DataSourceLike, ElementClass}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.ElementClassProto
import com.scalableminds.webknossos.tracingstore.TSRemoteWebknossosClient
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.tracingstore.tracings.{
  FossilDBClient,
  KeyValueStoreImplicits,
  TracingDataStore,
  VersionedKeyValuePair
}
import net.liftweb.common.Empty
import com.scalableminds.webknossos.datastore.geometry.{Vec3IntProto => ProtoPoint3D}
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import net.liftweb.common.Box
import play.api.libs.json.{Format, Json}

import scala.collection.mutable
import scala.concurrent.ExecutionContext
import scala.reflect.ClassTag

object VolumeTracingDownsampling {
  private def magsForVolumeTracingByLayerName(dataSource: DataSourceLike,
                                              fallbackLayerName: Option[String]): List[Vec3Int] = {
    val fallbackLayer: Option[DataLayerLike] =
      fallbackLayerName.flatMap(name => dataSource.dataLayers.find(_.name == name))
    magsForVolumeTracing(dataSource, fallbackLayer)
  }

  def magsForVolumeTracing(dataSource: DataSourceLike, fallbackLayer: Option[DataLayerLike]): List[Vec3Int] = {
    val fallbackLayerMags = fallbackLayer.map(_.resolutions)
    fallbackLayerMags.getOrElse {
      val unionOfAllLayers = dataSource.dataLayers.flatMap(_.resolutions).distinct
      val unionHasDistinctMaxDims = unionOfAllLayers.map(_.maxDim).distinct.length == unionOfAllLayers.length
      if (unionHasDistinctMaxDims) {
        unionOfAllLayers
      } else {
        // If the union of all layer’s mags has conflicting mags (meaning non-distinct maxDims, e.g. 2-2-1 and 2-2-2),
        // instead use one layer as template. Use the layer with the most mags.
        dataSource.dataLayers.maxBy(_.resolutions.length).resolutions.distinct
      }
    }.sortBy(_.maxDim)
  }
}

trait VolumeTracingDownsampling
    extends BucketKeys
    with ProtoGeometryImplicits
    with VolumeBucketCompression
    with KeyValueStoreImplicits
    with FoxImplicits {

  val tracingDataStore: TracingDataStore
  val tracingStoreWkRpcClient: TSRemoteWebknossosClient
  protected def saveBucket(dataLayer: VolumeTracingLayer,
                           bucket: BucketPosition,
                           data: Array[Byte],
                           version: Long,
                           toCache: Boolean = false): Fox[Unit]

  protected def updateSegmentIndex(segmentIndexBuffer: VolumeSegmentIndexBuffer,
                                   bucketPosition: BucketPosition,
                                   bucketBytes: Array[Byte],
                                   previousBucketBytesBox: Box[Array[Byte]],
                                   elementClass: ElementClassProto,
                                   mappingName: Option[String],
                                   editableMappingTracingId: Option[String]): Fox[Unit]

  protected def editableMappingTracingId(tracing: VolumeTracing, tracingId: String): Option[String]

  protected def baseMappingName(tracing: VolumeTracing): Fox[Option[String]]

  protected def volumeSegmentIndexClient: FossilDBClient

  protected def downsampleWithLayer(tracingId: String,
                                    oldTracingId: String,
                                    tracing: VolumeTracing,
                                    dataLayer: VolumeTracingLayer,
                                    tracingService: VolumeTracingService,
                                    userToken: Option[String])(implicit ec: ExecutionContext): Fox[List[Vec3Int]] = {
    val bucketVolume = 32 * 32 * 32
    for {
      _ <- bool2Fox(tracing.version == 0L) ?~> "Tracing has already been edited."
      _ <- bool2Fox(tracing.mags.nonEmpty) ?~> "Cannot downsample tracing with no mag list"
      sourceMag = getSourceMag(tracing)
      magsToCreate <- getMagsToCreate(tracing, oldTracingId)
      elementClass = elementClassFromProto(tracing.elementClass)
      bucketDataMapMutable = new mutable.HashMap[BucketPosition, Array[Byte]]().withDefault(_ => Array[Byte](0))
      _ = fillMapWithSourceBucketsInplace(bucketDataMapMutable, tracingId, dataLayer, sourceMag)
      originalBucketPositions = bucketDataMapMutable.keys.toList
      updatedBucketsMutable = new mutable.ListBuffer[BucketPosition]()
      _ = magsToCreate.foldLeft(sourceMag) { (previousMag, requiredMag) =>
        downsampleMagFromMag(previousMag,
                             requiredMag,
                             originalBucketPositions,
                             bucketDataMapMutable,
                             updatedBucketsMutable,
                             bucketVolume,
                             elementClass,
                             dataLayer)
        requiredMag
      }
      fallbackLayer <- tracingService.getFallbackLayer(oldTracingId) // remote wk does not know the new id yet
      tracing <- tracingService.find(tracingId) ?~> "tracing.notFound"
      segmentIndexBuffer = new VolumeSegmentIndexBuffer(tracingId,
                                                        volumeSegmentIndexClient,
                                                        tracing.version,
                                                        tracingService.remoteDatastoreClient,
                                                        fallbackLayer,
                                                        dataLayer.additionalAxes,
                                                        userToken)
      _ <- Fox.serialCombined(updatedBucketsMutable.toList) { bucketPosition: BucketPosition =>
        for {
          _ <- saveBucket(dataLayer, bucketPosition, bucketDataMapMutable(bucketPosition), tracing.version)
          mappingName <- baseMappingName(tracing)
          _ <- Fox.runIfOptionTrue(tracing.hasSegmentIndex)(
            updateSegmentIndex(
              segmentIndexBuffer,
              bucketPosition,
              bucketDataMapMutable(bucketPosition),
              Empty,
              tracing.elementClass,
              mappingName,
              editableMappingTracingId(tracing, tracingId)
            ))
        } yield ()
      }
      _ <- segmentIndexBuffer.flush()
      _ = logger.debug(s"Downsampled mags $magsToCreate from $sourceMag for volume tracing $tracingId.")
    } yield sourceMag :: magsToCreate
  }

  private def fillMapWithSourceBucketsInplace(bucketDataMap: mutable.Map[BucketPosition, Array[Byte]],
                                              tracingId: String,
                                              dataLayer: VolumeTracingLayer,
                                              sourceMag: Vec3Int): Unit = {
    val data: List[VersionedKeyValuePair[Array[Byte]]] =
      tracingDataStore.volumeData.getMultipleKeys(None, Some(tracingId))
    data.foreach { keyValuePair: VersionedKeyValuePair[Array[Byte]] =>
      val bucketPositionOpt = parseBucketKey(keyValuePair.key, dataLayer.additionalAxes).map(_._2)
      bucketPositionOpt.foreach { bucketPosition =>
        if (bucketPosition.mag == sourceMag) {
          bucketDataMap(bucketPosition) = decompressIfNeeded(keyValuePair.value,
                                                             expectedUncompressedBucketSizeFor(dataLayer),
                                                             s"bucket $bucketPosition during downsampling")
        }
      }
    }
  }

  private def downsampleMagFromMag(previousMag: Vec3Int,
                                   requiredMag: Vec3Int,
                                   originalBucketPositions: List[BucketPosition],
                                   bucketDataMapMutable: mutable.Map[BucketPosition, Array[Byte]],
                                   updatedBucketsMutable: mutable.ListBuffer[BucketPosition],
                                   bucketVolume: Int,
                                   elementClass: ElementClass.Value,
                                   dataLayer: VolumeTracingLayer): Unit = {
    val downScaleFactor =
      Vec3Int(requiredMag.x / previousMag.x, requiredMag.y / previousMag.y, requiredMag.z / previousMag.z)
    downsampledBucketPositions(originalBucketPositions, requiredMag).foreach { downsampledBucketPosition =>
      val sourceBuckets: Seq[BucketPosition] =
        sourceBucketPositionsFor(downsampledBucketPosition, downScaleFactor, previousMag)
      val sourceData: Seq[Array[Byte]] = sourceBuckets.map(bucketDataMapMutable(_))
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
      bucketDataMapMutable(downsampledBucketPosition) = downsampledData
      updatedBucketsMutable += downsampledBucketPosition
    }
  }

  private def downsampledBucketPositions(originalBucketPositions: List[BucketPosition],
                                         requiredMag: Vec3Int): Set[BucketPosition] =
    originalBucketPositions.map { bucketPosition: BucketPosition =>
      BucketPosition(
        (bucketPosition.voxelMag1X / requiredMag.x / 32) * requiredMag.x * 32,
        (bucketPosition.voxelMag1Y / requiredMag.y / 32) * requiredMag.y * 32,
        (bucketPosition.voxelMag1Z / requiredMag.z / 32) * requiredMag.z * 32,
        requiredMag,
        bucketPosition.additionalCoordinates
      )
    }.toSet

  private def sourceBucketPositionsFor(bucketPosition: BucketPosition,
                                       downScaleFactor: Vec3Int,
                                       previousMag: Vec3Int): Seq[BucketPosition] =
    for {
      z <- 0 until downScaleFactor.z
      y <- 0 until downScaleFactor.y
      x <- 0 until downScaleFactor.x
    } yield {
      BucketPosition(
        bucketPosition.voxelMag1X + x * bucketPosition.bucketLength * previousMag.x,
        bucketPosition.voxelMag1Y + y * bucketPosition.bucketLength * previousMag.y,
        bucketPosition.voxelMag1Z + z * bucketPosition.bucketLength * previousMag.z,
        previousMag,
        bucketPosition.additionalCoordinates
      )
    }

  private def fillZeroedIfNeeded(sourceData: Seq[Array[Byte]],
                                 bucketVolume: Int,
                                 bytesPerElement: Int): Seq[Array[Byte]] =
    // Reverted buckets and missing buckets are represented by a single zero-byte.
    // For downsampling, those need to be replaced with the full bucket volume of zero-bytes.
    sourceData.map { sourceBucketData =>
      if (sourceBucketData.sameElements(Array[Byte](0))) {
        Array.fill[Byte](bucketVolume * bytesPerElement)(0)
      } else sourceBucketData
    }

  private def downsampleData[T: ClassTag](data: Array[Array[T]],
                                          downScaleFactor: Vec3Int,
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
          Vec3Int(x * downScaleFactor.x + x_offset, y * downScaleFactor.y + y_offset, z * downScaleFactor.z + z_offset)
        val sourceBucketPosition =
          Vec3Int(sourceVoxelPosition.x / 32, sourceVoxelPosition.y / 32, sourceVoxelPosition.z / 32)
        val sourceVoxelPositionInSourceBucket =
          Vec3Int(sourceVoxelPosition.x % 32, sourceVoxelPosition.y % 32, sourceVoxelPosition.z % 32)
        val sourceBucketIndex = sourceBucketPosition.x + sourceBucketPosition.y * downScaleFactor.y + sourceBucketPosition.z * downScaleFactor.y * downScaleFactor.z
        val sourceVoxelIndex = sourceVoxelPositionInSourceBucket.x + sourceVoxelPositionInSourceBucket.y * 32 + sourceVoxelPositionInSourceBucket.z * 32 * 32
        data(sourceBucketIndex)(sourceVoxelIndex)
      }
      result(x + y * 32 + z * 32 * 32) = mode(voxelSourceData)
    }
    result
  }

  private def mode[T](items: Seq[T]): T =
    items.groupBy(i => i).view.mapValues(_.size).maxBy(_._2)._1

  private def getSourceMag(tracing: VolumeTracing): Vec3Int =
    tracing.mags.minBy(_.maxDim)

  private def getMagsToCreate(tracing: VolumeTracing, oldTracingId: String): Fox[List[Vec3Int]] =
    for {
      requiredMags <- getRequiredMags(tracing, oldTracingId)
      sourceMag = getSourceMag(tracing)
      magsToCreate = requiredMags.filter(_.maxDim > sourceMag.maxDim)
    } yield magsToCreate

  private def getRequiredMags(tracing: VolumeTracing, oldTracingId: String): Fox[List[Vec3Int]] =
    for {
      dataSource: DataSourceLike <- tracingStoreWkRpcClient.getDataSourceForTracing(oldTracingId)
      magsForTracing = VolumeTracingDownsampling.magsForVolumeTracingByLayerName(dataSource, tracing.fallbackLayer)
    } yield magsForTracing.sortBy(_.maxDim)

  protected def restrictMagList(tracing: VolumeTracing, magRestrictions: MagRestrictions): VolumeTracing = {
    val tracingMags =
      resolveLegacyMagList(tracing.mags)
    val allowedMags = magRestrictions.filterAllowed(tracingMags.map(vec3IntFromProto))
    tracing.withMags(allowedMags.map(vec3IntToProto))
  }

  protected def resolveLegacyMagList(mags: Seq[ProtoPoint3D]): Seq[ProtoPoint3D] =
    if (mags.isEmpty) Seq(ProtoPoint3D(1, 1, 1)) else mags
}

object MagRestrictions {
  def empty: MagRestrictions = MagRestrictions(None, None)
  implicit val jsonFormat: Format[MagRestrictions] = Json.format[MagRestrictions]
}

case class MagRestrictions(
    min: Option[Int],
    max: Option[Int]
) {
  def filterAllowed(mags: Seq[Vec3Int]): Seq[Vec3Int] =
    mags.filter(isAllowed)

  def isAllowed(mag: Vec3Int): Boolean =
    min.getOrElse(0) <= mag.maxDim && max.getOrElse(Int.MaxValue) >= mag.maxDim

  def isForbidden(mag: Vec3Int): Boolean = !isAllowed(mag)

  def minStr: Option[String] = min.map(_.toString)
  def maxStr: Option[String] = max.map(_.toString)
}
