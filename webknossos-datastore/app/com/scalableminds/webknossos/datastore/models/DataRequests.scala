package com.scalableminds.webknossos.datastore.models

import com.scalableminds.util.geometry.{Point3D, Vector3I}
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.datastore.models.requests.{Cuboid, DataServiceRequestSettings}
import play.api.libs.json.Json

trait AbstractDataRequest {

  def cuboid(dataLayer: DataLayer): Cuboid

  def settings: DataServiceRequestSettings
}

case class DataRequest(
    position: VoxelPosition,
    width: Int,
    height: Int,
    depth: Int,
    settings: DataServiceRequestSettings = DataServiceRequestSettings.default
) extends AbstractDataRequest {

  def cuboid(dataLayer: DataLayer) = Cuboid(position, width, height, depth)
}

case class WebKnossosDataRequest(
    position: Point3D,
    zoomStep: Int,
    cubeSize: Int,
    fourBit: Option[Boolean],
    applyAgglomerate: Option[String],
    version: Option[Long]
) extends AbstractDataRequest {

  def cuboid(dataLayer: DataLayer) =
    Cuboid(new VoxelPosition(position.x, position.y, position.z, dataLayer.lookUpResolution(zoomStep)),
           cubeSize,
           cubeSize,
           cubeSize)

  def settings = DataServiceRequestSettings(halfByte = fourBit.getOrElse(false), applyAgglomerate, version)
}

object WebKnossosDataRequest {
  implicit val format = Json.format[WebKnossosDataRequest]
}

case class WebKnossosIsosurfaceRequest(
    position: Point3D,
    zoomStep: Int,
    cubeSize: Point3D,
    segmentId: Long,
    voxelDimensions: Vector3I,
    mapping: Option[String] = None
) {
  def cuboid(dataLayer: DataLayer) =
    Cuboid(new VoxelPosition(position.x, position.y, position.z, dataLayer.lookUpResolution(zoomStep)),
           cubeSize.x,
           cubeSize.y,
           cubeSize.z)
}

object WebKnossosIsosurfaceRequest {
  implicit val format = Json.format[WebKnossosIsosurfaceRequest]
}

object DataRequestCollection {

  type DataRequestCollection = List[AbstractDataRequest]

  implicit def requestToCollection(request: AbstractDataRequest): DataRequestCollection = List(request)
}
