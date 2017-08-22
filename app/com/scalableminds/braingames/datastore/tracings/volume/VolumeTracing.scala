/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings.volume

import com.scalableminds.braingames.binary.models.datasource.{DataSource, SegmentationLayer}
import com.scalableminds.braingames.binary.storage.kvstore.VersionedKeyValueStore
import com.scalableminds.braingames.datastore.tracings.Tracing
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json.Json

case class VolumeTracing(
                          dataSetName: String,
                          activeSegmentId: Option[Long] = None,
                          dataLayer: VolumeTracingLayer,
                          editPosition: Point3D,
                          editRotation: Vector3D,
                          zoomLevel: Double,
                          fallbackLayer: Option[String],
                          version: Long = 0L,
                          timestamp: Long = System.currentTimeMillis()
                        ) extends Tracing with LazyLogging {

  def id: String = dataLayer.name

  override def volumes: List[Volume] = List(Volume(s"$id.zip"))

  def boundingBox: Option[BoundingBox] = None

  def dataLayerWithFallback(dataSource: DataSource): SegmentationLayer = {
    fallbackLayer.flatMap(dataSource.getDataLayer).map {
      case layer: SegmentationLayer if dataLayer.elementClass == layer.elementClass =>
        new FallbackLayerAdapter(dataLayer, layer)
      case _ =>
        logger.error(s"Fallback layer is not a segmentation layer and thus being ignored. " +
          s"DataSource: ${dataSource.id}. DataLayer: $id. FallbackLayer: $fallbackLayer.")
        dataLayer
    }.getOrElse(dataLayer)
  }
}

object VolumeTracing {
  implicit def volumeTracingFormat(implicit volumeDataStore: VersionedKeyValueStore) = Json.format[VolumeTracing]
}

case class AbstractVolumeTracing(
                                  dataSetName: String,
                                  dataLayer: AbstractVolumeTracingLayer,
                                  fallbackLayer: Option[String],
                                  editPosition: Point3D,
                                  editRotation: Vector3D = Vector3D(),
                                  zoomLevel: Double = AbstractVolumeTracing.defaultZoomLevel,
                                  version: Long = 0L,
                                  activeSegmentId: Option[Long] = None,
                                  timestamp: Long = System.currentTimeMillis()
                                )

object AbstractVolumeTracing {

  val defaultZoomLevel: Double = 2.0

  implicit val abstractVolumeTracingFormat = Json.format[AbstractVolumeTracing]
}
