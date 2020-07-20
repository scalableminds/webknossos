package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.geometry.{BoundingBox, Point3D}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.BucketProvider
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.storage.DataCubeCache
import com.scalableminds.webknossos.tracingstore.tracings.{
  FossilDBClient,
  TemporaryVolumeDataStore
}

import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration

class VolumeTracingBucketProvider(layer: VolumeTracingLayer)
    extends BucketProvider
    with VolumeTracingBucketHelper
    with FoxImplicits {

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

class TemporaryVolumeTracingBucketProvider(layer: VolumeTracingLayer)
  extends BucketProvider
    with VolumeTracingBucketHelper
    with FoxImplicits {

  val volumeDataStore: FossilDBClient = layer.volumeDataStore
  val volumeDataCache: TemporaryVolumeDataStore = layer.volumeDataCache

  override def load(readInstruction: DataReadInstruction, cache: DataCubeCache, timeout: FiniteDuration)(
    implicit ec: ExecutionContext): Fox[Array[Byte]] =
    loadBucket(layer, readInstruction.bucket, readInstruction.version)

  override def bucketStream(resolution: Int, version: Option[Long] = None): Iterator[(BucketPosition, Array[Byte])] =
    bucketStreamFromCache(layer, resolution)
}

case class VolumeTracingLayer(
    name: String,
    boundingBox: BoundingBox,
    elementClass: ElementClass.Value,
    largestSegmentId: Long,
    defaultViewConfiguration: Option[SegmentationLayerViewConfiguration] = None
)(implicit val volumeDataStore: FossilDBClient, implicit val volumeDataCache: TemporaryVolumeDataStore)
    extends SegmentationLayer {

  def lengthOfUnderlyingCubes(resolution: Point3D): Int = DataLayer.bucketLength

  val dataFormat: DataFormat.Value = DataFormat.tracing

  val volumeBucketProvider: VolumeTracingBucketProvider = new VolumeTracingBucketProvider(this)

  val temporaryBucketProvider: TemporaryVolumeTracingBucketProvider = new TemporaryVolumeTracingBucketProvider(this)

  val bucketProvider: BucketProvider = volumeBucketProvider

  val mappings: Option[Set[String]] = None

  val resolutions: List[Point3D] = List(Point3D(1, 1, 1))
}
