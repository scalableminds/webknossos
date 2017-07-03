package com.scalableminds.braingames.datastore.tracings.volume

import java.util.UUID

import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.braingames.binary.models.BucketPosition
import com.scalableminds.braingames.binary.models.datasource.{DataSource, SegmentationLayer}
import com.scalableminds.braingames.binary.store.kvstore.VersionedKeyValueStore
import net.liftweb.common.{Box, Full}

class VolumeTracingService @Inject()(
                                      @Named("tracing-data-store") implicit val tracingDataStore: VersionedKeyValueStore
                                    ) extends VolumeTracingBucketHelper {

  private def buildTracingKey(id: String): String = s"/tracings/volumes/$id"

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

    val tracing = VolumeTracing(tracingLayer, fallbackLayer.map(_.name), fallbackLayer.map(_.largestSegmentId).getOrElse(0L) + 1)
    tracingDataStore.putJson(buildTracingKey(tracing.id), 1, tracing)
    tracing
  }

  def update(tracing: VolumeTracing, updates: List[VolumeUpdateAction]): Box[Unit] = {
    updates.foreach {
      case action: LabelVolumeAction =>
        val resolution = math.pow(2, action.zoomStep).toInt
        val bucket = new BucketPosition(action.position.x, action.position.y, action.position.z, resolution, tracing.dataLayer.lengthOfProvidedBuckets)
        saveBucket(tracing.dataLayer, bucket, action.data)
    }
    Full(())
  }

  def download(tracing: VolumeTracing): Box[Array[Byte]] = {
    Full(Array.empty)
  }

  def find(id: String): Box[VolumeTracing] = {
    tracingDataStore.getJson[VolumeTracing](buildTracingKey(id)).map(_.value)
  }
}
