/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.models

import com.scalableminds.braingames.binary.models.VoxelPosition
import com.scalableminds.braingames.binary.models.requests.{Cuboid, DataServiceRequestSettings}
import com.scalableminds.util.geometry.Point3D
import play.api.libs.json.Json

trait AbstractDataRequest {

  def cuboid: Cuboid

  def settings: DataServiceRequestSettings
}

case class DataRequest(
                        position: VoxelPosition,
                        width: Int,
                        height: Int,
                        depth: Int,
                        settings: DataServiceRequestSettings = DataServiceRequestSettings.default
                      ) extends AbstractDataRequest {

  def cuboid = Cuboid(position, width, height, depth)
}

case class WebKnossosDataRequest(
                                  position: Point3D,
                                  zoomStep: Int,
                                  cubeSize: Int,
                                  fourBit: Option[Boolean]
                                ) extends AbstractDataRequest {

  def cuboid = Cuboid(
    new VoxelPosition(position.x, position.y, position.z, math.pow(2, zoomStep).toInt),
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
