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

case class VolumeTracingDepr(
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
}

/*object VolumeTracingDepr {
  implicit def volumeTracingFormat(implicit volumeDataStore: VersionedKeyValueStore) = Json.format[VolumeTracingDepr]
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

  val defaultZoomLevel: Double = 0.1

  implicit val abstractVolumeTracingFormat = Json.format[AbstractVolumeTracing]
}
*/
