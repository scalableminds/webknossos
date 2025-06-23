package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.objectid.ObjectId
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
import net.liftweb.common.Box
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

  override def load(readInstruction: DataReadInstruction)(implicit ec: ExecutionContext,
                                                          tc: TokenContext): Fox[Array[Byte]] =
    // Don’t use the layer version, because BucketProvider (with layer) may be cached across versions. readInstruction has the current version.
    loadBucket(layer, readInstruction.bucket, readInstruction.version)

  override def loadMultiple(readInstructions: Seq[DataReadInstruction])(implicit ec: ExecutionContext,
                                                                        tc: TokenContext): Fox[Seq[Box[Array[Byte]]]] =
    if (readInstructions.isEmpty) Fox.successful(Seq.empty)
    else {
      for {
        // Don’t use the layer version, because BucketProvider (with layer) may be cached across versions. readInstruction has the current version.
        version <- readInstructions.headOption.map(_.version).toFox
        bucketBoxes <- loadBuckets(layer, readInstructions.map(_.bucket), version)
      } yield bucketBoxes
    }

  override def bucketStream(version: Option[Long] = None): Iterator[(BucketPosition, Array[Byte])] =
    bucketStream(layer, version)

  override def bucketStreamWithVersion(version: Option[Long] = None): Iterator[(BucketPosition, Array[Byte], Long)] =
    bucketStreamWithVersion(layer, version)
}

class TemporaryVolumeTracingBucketProvider(layer: VolumeTracingLayer)(implicit val ec: ExecutionContext)
    extends AbstractVolumeTracingBucketProvider {

  val volumeDataStore: FossilDBClient = layer.volumeDataStore
  val temporaryTracingService: TemporaryTracingService = layer.temporaryTracingService

  override def load(readInstruction: DataReadInstruction)(implicit ec: ExecutionContext,
                                                          tc: TokenContext): Fox[Array[Byte]] =
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
    annotationId: ObjectId,
    volumeTracingService: VolumeTracingService,
    temporaryTracingService: TemporaryTracingService,
    isTemporaryTracing: Boolean = false,
    includeFallbackDataIfAvailable: Boolean = false,
    tracing: VolumeTracing,
    tokenContext: TokenContext,
    additionalAxes: Option[Seq[AdditionalAxis]],
    attachments: Option[DatasetLayerAttachments] = None,
    volumeDataStore: FossilDBClient,
)(implicit val ec: ExecutionContext)
    extends SegmentationLayer
    with ProtoGeometryImplicits
    with VolumeBucketCompression {

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

  lazy val dataFormat: DataFormat.Value = DataFormat.tracing

  lazy val volumeBucketProvider: AbstractVolumeTracingBucketProvider =
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

  lazy val expectedUncompressedBucketSize: Int =
    ElementClass.bytesPerElement(elementClass) * scala.math.pow(DataLayer.bucketLength, 3).intValue

  override def asAbstractLayer: DataLayerLike = ???
}
