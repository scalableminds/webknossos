package com.scalableminds.webknossos.datastore.models

import com.scalableminds.util.geometry.Point3D
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
                                  fourBit: Option[Boolean]
                                ) extends AbstractDataRequest {

  def cuboid(dataLayer: DataLayer) = Cuboid(
    new VoxelPosition(position.x, position.y, position.z, dataLayer.lookUpResolution(zoomStep)),
    cubeSize,
    cubeSize,
    cubeSize)

  def settings = DataServiceRequestSettings(halfByte = fourBit.getOrElse(false))
}

object WebKnossosDataRequest {
  implicit val webKnossosDataRequestFormat = Json.format[WebKnossosDataRequest]
}

object DataRequestCollection {

  type DataRequestCollection = List[AbstractDataRequest]

  implicit def requestToCollection(request: AbstractDataRequest): DataRequestCollection = List(request)
}
