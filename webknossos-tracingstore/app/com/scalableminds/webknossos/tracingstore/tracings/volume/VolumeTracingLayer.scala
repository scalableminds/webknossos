package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.geometry.{BoundingBox, Point3D}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.BucketProvider
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.storage.DataCubeCache
import com.scalableminds.webknossos.tracingstore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.tracingstore.tracings.{
  FossilDBClient,
  TemporaryTracingStore,
  TemporaryVolumeDataStore
}
import sun.reflect.generics.reflectiveObjects.NotImplementedException

import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration

trait AbstractVolumeTracingBucketProvider extends BucketProvider with VolumeTracingBucketHelper with FoxImplicits {

  def bucketStreamWithVersion(resolution: Int,
                              version: Option[Long] = None): Iterator[(BucketPosition, Array[Byte], Long)]
}

class VolumeTracingBucketProvider(layer: VolumeTracingLayer) extends AbstractVolumeTracingBucketProvider {

  val volumeDataStore: FossilDBClient = layer.volumeDataStore
  val volumeDataCache: TemporaryVolumeDataStore = layer.volumeDataCache

  override def load(readInstruction: DataReadInstruction, cache: DataCubeCache, timeout: FiniteDuration)(
      implicit ec: ExecutionContext): Fox[Array[Byte]] =
    loadBucket(layer, readInstruction.bucket, readInstruction.version)

  override def bucketStream(resolution: Int, version: Option[Long] = None): Iterator[(BucketPosition, Array[Byte])] =
    bucketStream(layer, resolution, version)

  def bucketStreamWithVersion(resolution: Int,
                              version: Option[Long] = None): Iterator[(BucketPosition, Array[Byte], Long)] =
    bucketStreamWithVersion(layer, resolution, version)
}

class TemporaryVolumeTracingBucketProvider(layer: VolumeTracingLayer) extends AbstractVolumeTracingBucketProvider {

  val volumeDataStore: FossilDBClient = layer.volumeDataStore
  val volumeDataCache: TemporaryVolumeDataStore = layer.volumeDataCache
  val temporaryTracingStore: TemporaryTracingStore[VolumeTracing] = layer.temporaryTracingStore

  override def load(readInstruction: DataReadInstruction, cache: DataCubeCache, timeout: FiniteDuration)(
      implicit ec: ExecutionContext): Fox[Array[Byte]] =
    for {
      _ <- assertTracingStillInCache(layer)
      data <- loadBucket(layer, readInstruction.bucket, readInstruction.version)
    } yield data

  private def assertTracingStillInCache(layer: VolumeTracingLayer)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- bool2Fox(temporaryTracingStore.contains(layer.name)) ?~> "Temporary Volume Tracing expired"
    } yield ()

  override def bucketStream(resolution: Int, version: Option[Long] = None): Iterator[(BucketPosition, Array[Byte])] =
    bucketStreamFromCache(layer, resolution)

  def bucketStreamWithVersion(resolution: Int,
                              version: Option[Long] = None): Iterator[(BucketPosition, Array[Byte], Long)] =
    throw new NotImplementedException // Temporary Volume Tracings do not support versioning
}

case class VolumeTracingLayer(
    name: String,
    boundingBox: BoundingBox,
    elementClass: ElementClass.Value,
    largestSegmentId: Long,
    isTemporaryTracing: Boolean = false,
    defaultViewConfiguration: Option[SegmentationLayerViewConfiguration] = None
)(implicit val volumeDataStore: FossilDBClient,
  implicit val volumeDataCache: TemporaryVolumeDataStore,
  implicit val temporaryTracingStore: TemporaryTracingStore[VolumeTracing])
    extends SegmentationLayer {

  def lengthOfUnderlyingCubes(resolution: Point3D): Int = DataLayer.bucketLength

  val dataFormat: DataFormat.Value = DataFormat.tracing

  val volumeBucketProvider: AbstractVolumeTracingBucketProvider =
    if (isTemporaryTracing)
      new TemporaryVolumeTracingBucketProvider(this)
    else
      new VolumeTracingBucketProvider(this)

  val bucketProvider: BucketProvider = volumeBucketProvider

  val mappings: Option[Set[String]] = None

  val resolutions: List[Point3D] = List(Point3D(1, 1, 1))
  override def containsResolution(resolution: Point3D) = true
}
