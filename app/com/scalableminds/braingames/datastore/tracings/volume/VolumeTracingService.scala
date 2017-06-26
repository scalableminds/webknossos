package com.scalableminds.braingames.datastore.tracings.volume

import java.util.UUID

import com.google.inject.Inject
import com.scalableminds.braingames.binary.models.BucketPosition
import com.scalableminds.braingames.binary.models.datasource.{DataLayer, DataSource, SegmentationLayer}
import com.scalableminds.braingames.binary.models.requests.ReadInstruction
import com.scalableminds.braingames.binary.store.kvstore.VersionedKeyValueStore
import com.scalableminds.util.tools.Fox
import net.liftweb.common.{Box, Full}
import play.api.libs.json.JsValue

class VolumeTracingService @Inject()(
                                      implicit val tracingDataStore: VersionedKeyValueStore
                                    ) extends VolumeTracingBucketHelper {

  def create(dataSource: DataSource): VolumeTracing = {
    val fallbackLayer = dataSource.dataLayers.flatMap {
      case layer: SegmentationLayer => Some(layer)
      case _ => None
    }.headOption

    val tracingLayer = VolumeTracingLayer(
      UUID.randomUUID.toString,
      dataSource.boundingBox,
      fallbackLayer.map(_.elementClass).getOrElse(VolumeTracingLayer.defaultElementClass),
      fallbackLayer.map(_.largestSegmentId).getOrElse(VolumeTracingLayer.defaultLargestSegmentId)
    )

    VolumeTracing(
      dataSource.id,
      tracingLayer,
      tracingLayer.largestSegmentId + 1,
      fallbackLayer.map(_.name))
  }

  def info(tracing: VolumeTracing): Box[JsValue] = ???

  def update(tracing: VolumeTracing, updates: List[VolumeUpdateAction]): Box[Unit] = {
    updates.foreach {
      case action: LabelVolumeAction =>
        val resolution = math.pow(2, action.zoomStep).toInt
        val bucket = new BucketPosition(action.position.x, action.position.y, action.position.z, resolution, tracing.dataLayer.lengthOfProvidedBuckets)
        saveBucket(tracing.dataLayer, bucket, action.data)
    }
    Full(())
  }

  def download(tracing: VolumeTracing): Box[Array[Byte]] = ???

  def duplicate(tracing: VolumeTracing): Box[VolumeTracing] = ???

}

trait VolumeTracingBucketHelper {

  private def mortonEncode(x: Long, y: Long, z: Long): Long = {
    var morton = 0L
    val bitLength = math.ceil(math.log(List(x, y, z).max + 1) / math.log(2)).toInt

    (0 until bitLength).foreach { i =>
      morton |= ((x & (1L << i)) << (2 * i)) |
        ((y & (1L << i)) << (2 * i + 1)) |
        ((z & (1L << i)) << (2 * i + 2))
    }
    morton
  }

  private def buildBucketKey(dataLayerName: String, bucket: BucketPosition): String = {
    val mortonIndex = mortonEncode(bucket.x, bucket.y, bucket.z)
    s"tracing-data/volumes/$dataLayerName-${bucket.resolution}-${mortonIndex}-${bucket.x}_${bucket.y}_${bucket.z}"
  }

  def loadBucket(dataLayerName: String, bucket: BucketPosition)(implicit tracingDataStore: VersionedKeyValueStore): Box[Array[Byte]] = {
    val key = buildBucketKey(dataLayerName, bucket)
    tracingDataStore.get(key).map(_.value)
  }

  def saveBucket(dataLayer: VolumeTracingLayer, bucket: BucketPosition, data: Array[Byte])(implicit tracingDataStore: VersionedKeyValueStore): Box[Unit] = {
    val key = buildBucketKey(dataLayer.name, bucket)
    tracingDataStore.put(key, 1, data)
  }
}
