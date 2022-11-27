package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.BucketProvider
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.{ElementClass, _}
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.storage.{DataCubeCache, FileSystemService}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.tracingstore.tracings.{FossilDBClient, TemporaryTracingStore, TemporaryVolumeDataStore}
import sun.reflect.generics.reflectiveObjects.NotImplementedException

import scala.concurrent.ExecutionContext

trait AbstractVolumeTracingBucketProvider extends BucketProvider with VolumeTracingBucketHelper with FoxImplicits {

  override def fileSystemServiceOpt: Option[FileSystemService] = None

  def bucketStreamWithVersion(version: Option[Long] = None): Iterator[(BucketPosition, Array[Byte], Long)]
}

class VolumeTracingBucketProvider(layer: VolumeTracingLayer) extends AbstractVolumeTracingBucketProvider {

  val volumeDataStore: FossilDBClient = layer.volumeDataStore
  val volumeDataCache: TemporaryVolumeDataStore = layer.volumeDataCache

  override def load(readInstruction: DataReadInstruction, cache: DataCubeCache)(
      implicit ec: ExecutionContext): Fox[Array[Byte]] =
    loadBucket(layer, readInstruction.bucket, readInstruction.version)

  override def bucketStream(version: Option[Long] = None): Iterator[(BucketPosition, Array[Byte])] =
    bucketStream(layer, version)

  def bucketStreamWithVersion(version: Option[Long] = None): Iterator[(BucketPosition, Array[Byte], Long)] =
    bucketStreamWithVersion(layer, version)
}

class TemporaryVolumeTracingBucketProvider(layer: VolumeTracingLayer) extends AbstractVolumeTracingBucketProvider {

  val volumeDataStore: FossilDBClient = layer.volumeDataStore
  val volumeDataCache: TemporaryVolumeDataStore = layer.volumeDataCache
  val temporaryTracingStore: TemporaryTracingStore[VolumeTracing] = layer.temporaryTracingStore

  override def load(readInstruction: DataReadInstruction, cache: DataCubeCache)(
      implicit ec: ExecutionContext): Fox[Array[Byte]] =
    for {
      _ <- assertTracingStillInCache(layer)
      data <- loadBucket(layer, readInstruction.bucket, readInstruction.version)
    } yield data

  private def assertTracingStillInCache(layer: VolumeTracingLayer)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- bool2Fox(temporaryTracingStore.contains(layer.name)) ?~> "Temporary Volume Tracing expired"
    } yield ()

  override def bucketStream(version: Option[Long] = None): Iterator[(BucketPosition, Array[Byte])] =
    bucketStreamFromCache(layer)

  def bucketStreamWithVersion(version: Option[Long] = None): Iterator[(BucketPosition, Array[Byte], Long)] =
    throw new NotImplementedException // Temporary Volume Tracings do not support versioning
}

case class VolumeTracingLayer(
    name: String,
    volumeTracingService: VolumeTracingService,
    isTemporaryTracing: Boolean = false,
    includeFallbackDataIfAvailable: Boolean = false,
    tracing: VolumeTracing,
    userToken: Option[String],
)(implicit val volumeDataStore: FossilDBClient,
  implicit val volumeDataCache: TemporaryVolumeDataStore,
  implicit val temporaryTracingStore: TemporaryTracingStore[VolumeTracing])
    extends SegmentationLayer
    with ProtoGeometryImplicits {

  override val boundingBox: BoundingBox = tracing.boundingBox
  override val elementClass: ElementClass.Value = tracing.elementClass
  override val largestSegmentId: Option[Long] = tracing.largestSegmentId
  override val defaultViewConfiguration: Option[LayerViewConfiguration] = None
  override val adminViewConfiguration: Option[LayerViewConfiguration] = None
  override val mappings: Option[Set[String]] = None

  lazy val volumeResolutions: List[Vec3Int] = tracing.resolutions.map(vec3IntFromProto).toList

  def lengthOfUnderlyingCubes(resolution: Vec3Int): Int = DataLayer.bucketLength

  val dataFormat: DataFormat.Value = DataFormat.tracing

  val volumeBucketProvider: AbstractVolumeTracingBucketProvider =
    if (isTemporaryTracing)
      new TemporaryVolumeTracingBucketProvider(this)
    else
      new VolumeTracingBucketProvider(this)

  override def bucketProvider(fileSystemServiceOpt: Option[FileSystemService]): BucketProvider = volumeBucketProvider

  def bucketProvider: AbstractVolumeTracingBucketProvider = volumeBucketProvider

  override val resolutions: List[Vec3Int] =
    if (volumeResolutions.nonEmpty) volumeResolutions else List(Vec3Int(1, 1, 1))

  override def containsResolution(resolution: Vec3Int) =
    true // allow requesting buckets of all resolutions. database takes care of missing.
}
