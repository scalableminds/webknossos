package com.scalableminds.webknossos.datastore.models

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.webknossos.datastore.geometry.AdditionalCoordinateProto
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.datastore.models.requests.{Cuboid, DataServiceRequestSettings}
import play.api.libs.json.{Json, OFormat}

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

  def cuboid(dataLayer: DataLayer): Cuboid = Cuboid(position, width, height, depth)
}

case class WebknossosDataRequest(
    position: Vec3Int,
    mag: Vec3Int,
    cubeSize: Int,
    fourBit: Option[Boolean],
    applyAgglomerate: Option[String],
    additionalCoordinates: Option[Seq[AdditionalCoordinate]],
    version: Option[Long]
) extends AbstractDataRequest {

  def cuboid(dataLayer: DataLayer): Cuboid =
    Cuboid(VoxelPosition(position.x, position.y, position.z, mag), cubeSize, cubeSize, cubeSize)

  def settings: DataServiceRequestSettings =
    DataServiceRequestSettings(halfByte = fourBit.getOrElse(false), applyAgglomerate, version, additionalCoordinates)
}

object WebknossosDataRequest {
  implicit val jsonFormat: OFormat[WebknossosDataRequest] = Json.format[WebknossosDataRequest]
}

case class WebknossosAdHocMeshRequest(
    position: Vec3Int, // In mag1
    mag: Vec3Int,
    cubeSize: Vec3Int, // In target mag
    segmentId: Long,
    voxelSizeFactorInUnit: Vec3Double, // assumed to be in dataset’s unit
    mapping: Option[String] = None,
    mappingType: Option[String] = None,
    additionalCoordinates: Option[Seq[AdditionalCoordinate]] = None,
    findNeighbors: Boolean = true
) {
  def cuboid(dataLayer: DataLayer): Cuboid =
    Cuboid(VoxelPosition(position.x, position.y, position.z, mag), cubeSize.x, cubeSize.y, cubeSize.z)
}

object WebknossosAdHocMeshRequest {
  implicit val jsonFormat: OFormat[WebknossosAdHocMeshRequest] = Json.format[WebknossosAdHocMeshRequest]
}

case class RawCuboidRequest(
    position: Vec3Int,
    cubeSize: Vec3Int,
    mag: Vec3Int,
    additionalCoordinates: Option[Seq[AdditionalCoordinate]]
) extends AbstractDataRequest {
  override def cuboid(dataLayer: DataLayer): Cuboid =
    Cuboid(VoxelPosition(position.x, position.y, position.z, mag), cubeSize.x, cubeSize.y, cubeSize.z)

  override def settings: DataServiceRequestSettings =
    DataServiceRequestSettings(additionalCoordinates = additionalCoordinates)
}

object RawCuboidRequest {
  implicit val jsonFormat: OFormat[RawCuboidRequest] = Json.format[RawCuboidRequest]
}

object DataRequestCollection {
  type DataRequestCollection = List[AbstractDataRequest]

  implicit def requestToCollection(request: AbstractDataRequest): DataRequestCollection = List(request)
}

case class AdditionalCoordinate(
    name: String,
    value: Int
) {
  override def toString = s"$name=$value"
}

object AdditionalCoordinate {
  implicit val jsonFormat: OFormat[AdditionalCoordinate] = Json.format[AdditionalCoordinate]

  def toProto(acOpt: Option[Seq[AdditionalCoordinate]]): Seq[AdditionalCoordinateProto] =
    acOpt match {
      case Some(additionalCoordinates) =>
        additionalCoordinates.map(ac => AdditionalCoordinateProto(ac.name, ac.value))
      case None => Seq()
    }

  def hasNegativeValue(acOpt: Option[Seq[AdditionalCoordinate]]): Boolean =
    acOpt match {
      case Some(additionalCoordinates) => additionalCoordinates.exists(_.value < 0)
      case None                        => false
    }
}
