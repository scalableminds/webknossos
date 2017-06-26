package com.scalableminds.braingames.datastore.tracings.volume

import com.scalableminds.braingames.binary.models.datasource.{DataSource, DataSourceId, SegmentationLayer}
import play.api.libs.json.Json

case class VolumeTracing(
                          dataSource: DataSourceId,
                          dataLayer: VolumeTracingLayer,
                          activeSegmentId: Long,
                          fallbackLayerName: Option[String],
                          zoomLevel: Double = 0.0,
                          timestamp: Long = System.currentTimeMillis()
                        ) {

  def id: String = dataLayer.name

  def dataLayerWithFallback(dataSource: DataSource): SegmentationLayer = {
    fallbackLayerName.flatMap(dataSource.getDataLayer) match {
      case Some(fallbackLayer) =>
        fallbackLayer match {
          case layer: SegmentationLayer if dataLayer.elementClass == layer.elementClass =>
            new FallbackLayerAdapter(dataLayer, layer)
          case _ =>
            dataLayer
        }
      case _ =>
        dataLayer
    }
  }
}

object VolumeTracing {
  implicit def volumeTracingFormat = Json.format[VolumeTracing]
}
