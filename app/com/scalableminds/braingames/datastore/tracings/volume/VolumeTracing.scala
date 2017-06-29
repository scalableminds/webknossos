package com.scalableminds.braingames.datastore.tracings.volume

import com.scalableminds.braingames.binary.models.datasource.{DataSource, DataSourceId, SegmentationLayer}
import com.scalableminds.braingames.binary.store.kvstore.VersionedKeyValueStore
import com.scalableminds.braingames.datastore.tracings.Tracing
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json.Json

case class VolumeTracing(dataLayer: VolumeTracingLayer, fallbackLayerName: Option[String]) extends Tracing with LazyLogging {

  def id: String = dataLayer.name

  def dataLayerWithFallback(dataSource: DataSource): SegmentationLayer = {
    fallbackLayerName.flatMap(dataSource.getDataLayer).map {
      case layer: SegmentationLayer if dataLayer.elementClass == layer.elementClass =>
        new FallbackLayerAdapter(dataLayer, layer)
      case _ =>
        logger.error(s"Fallback layer is not a segmentation layer and thus being ignored. " +
          s"DataSource: ${dataSource.id}. DataLayer: $id. FallbackLayer: $fallbackLayerName.")
          dataLayer
    }.getOrElse(dataLayer)
  }
}

object VolumeTracing {
  implicit def volumeTracingFormat(implicit tracingDataStore: VersionedKeyValueStore) = Json.format[VolumeTracing]
}
