package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, MagLocator}
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService
import com.scalableminds.webknossos.tracingstore.tracings.{FossilDBClient, TemporaryTracingService}
import ucar.ma2.{Array => MultiArray}

import scala.concurrent.ExecutionContext

trait AbstractVolumeTracingBucketProvider extends BucketProvider with VolumeTracingBucketHelper with FoxImplicits {

  def bucketStreamWithVersion(version: Option[Long] = None): Iterator[(BucketPosition, Array[Byte], Long)]

  def bucketStream(version: Option[Long] = None): Iterator[(BucketPosition, Array[Byte])]
}

class VolumeTracingBucketProvider(layer: VolumeTracingLayer)(implicit val ec: ExecutionContext)
    extends AbstractVolumeTracingBucketProvider {

  val volumeDataStore: FossilDBClient = layer.volumeDataStore
  val temporaryTracingService: TemporaryTracingService = layer.temporaryTracingService

  override def load(readInstruction: DataReadInstruction)(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    loadBucket(layer, readInstruction.bucket, readInstruction.version)

  override def bucketStream(version: Option[Long] = None): Iterator[(BucketPosition, Array[Byte])] =
    bucketStream(layer, version)

  override def bucketStreamWithVersion(version: Option[Long] = None): Iterator[(BucketPosition, Array[Byte], Long)] =
    bucketStreamWithVersion(layer, version)
}

class TemporaryVolumeTracingBucketProvider(layer: VolumeTracingLayer)(implicit val ec: ExecutionContext)
    extends AbstractVolumeTracingBucketProvider {

  val volumeDataStore: FossilDBClient = layer.volumeDataStore
  val temporaryTracingService: TemporaryTracingService = layer.temporaryTracingService

  override def load(readInstruction: DataReadInstruction)(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    for {
      _ <- temporaryTracingService.assertTracingStillPresent(layer.name)
      data <- loadBucket(layer, readInstruction.bucket, readInstruction.version)
    } yield data

  override def bucketStream(version: Option[Long] = None): Iterator[(BucketPosition, Array[Byte])] =
    bucketStreamFromTemporaryStore(layer)

  override def bucketStreamWithVersion(version: Option[Long] = None): Iterator[(BucketPosition, Array[Byte], Long)] =
    throw new UnsupportedOperationException // Temporary Volume Tracings do not support versioning
}

case class VolumeTracingLayer(
    name: String,
    annotationId: String,
    volumeTracingService: VolumeTracingService,
    temporaryTracingService: TemporaryTracingService,
    isTemporaryTracing: Boolean = false,
    includeFallbackDataIfAvailable: Boolean = false,
    tracing: VolumeTracing,
    tokenContext: TokenContext,
    additionalAxes: Option[Seq[AdditionalAxis]],
    volumeDataStore: FossilDBClient,
)(implicit val ec: ExecutionContext)
    extends SegmentationLayer
    with ProtoGeometryImplicits {

  override val boundingBox: BoundingBox = tracing.boundingBox
  override val elementClass: ElementClass.Value = tracing.elementClass
  override val largestSegmentId: Option[Long] = tracing.largestSegmentId
  override val defaultViewConfiguration: Option[LayerViewConfiguration] = None
  override val adminViewConfiguration: Option[LayerViewConfiguration] = None
  override val mappings: Option[Set[String]] = None
  override val coordinateTransformations: Option[List[CoordinateTransformation]] = None
  override val mags: List[MagLocator] = List.empty // MagLocators do not apply for annotation layers

  private lazy val volumeMags: List[Vec3Int] = tracing.mags.map(vec3IntFromProto).toList

  lazy val tracingId: String = name

  override def bucketProviderCacheKey: String = s"$name-withFallbackData=$includeFallbackDataIfAvailable"

  def lengthOfUnderlyingCubes(mag: Vec3Int): Int = DataLayer.bucketLength

  val dataFormat: DataFormat.Value = DataFormat.tracing

  val volumeBucketProvider: AbstractVolumeTracingBucketProvider =
    if (isTemporaryTracing)
      new TemporaryVolumeTracingBucketProvider(this)
    else
      new VolumeTracingBucketProvider(this)

  override def bucketProvider(remoteSourceDescriptorServiceOpt: Option[RemoteSourceDescriptorService],
                              dataSourceId: DataSourceId,
                              sharedChunkContentsCache: Option[AlfuCache[String, MultiArray]]): BucketProvider =
    volumeBucketProvider

  def bucketProvider: AbstractVolumeTracingBucketProvider = volumeBucketProvider

  override val resolutions: List[Vec3Int] =
    if (volumeMags.nonEmpty) volumeMags else List(Vec3Int.ones)

  override def containsMag(mag: Vec3Int) =
    true // allow requesting buckets of all mags. database takes care of missing.

  def bucketStream: Iterator[(BucketPosition, Array[Byte])] = bucketProvider.bucketStream(Some(tracing.version))
}
