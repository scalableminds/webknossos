package com.scalableminds.webknossos.datastore.models

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.tools.JsonAutoFormat
import com.scalableminds.webknossos.datastore.geometry.AdditionalCoordinateProto
import com.scalableminds.webknossos.datastore.helpers.UnsignedLong
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.datastore.models.requests.{Cuboid, DataServiceRequestSettings}
import com.scalableminds.webknossos.datastore.services.mesh.MappingType

trait AbstractDataRequest {

  def cuboid(dataLayer: DataLayer): Cuboid

  def settings: DataServiceRequestSettings
}

case class DataRequest(
    position: VoxelPosition,
    width: Int,
    height: Int,
    depth: Int,
    settings: DataServiceRequestSettings = DataServiceRequestSettings()
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
) extends AbstractDataRequest derives JsonAutoFormat {

  def cuboid(dataLayer: DataLayer): Cuboid =
    Cuboid(VoxelPosition(position.x, position.y, position.z, mag), cubeSize, cubeSize, cubeSize)

  def settings: DataServiceRequestSettings =
    DataServiceRequestSettings(halfByte = fourBit.getOrElse(false), applyAgglomerate, version, additionalCoordinates)
}

case class WebknossosAdHocMeshRequest(
    position: Vec3Int, // In mag1
    mag: Vec3Int,
    cubeSize: Vec3Int, // In target mag
    segmentId: UnsignedLong,
    voxelSizeFactorInUnit: Vec3Double, // assumed to be in dataset’s unit
    mapping: Option[String] = None,
    mappingType: Option[MappingType.Value] = None,
    additionalCoordinates: Option[Seq[AdditionalCoordinate]] = None,
    annotationVersion: Option[Long],
    findNeighbors: Boolean = true
) derives JsonAutoFormat {
  def cuboid: Cuboid =
    Cuboid(VoxelPosition(position.x, position.y, position.z, mag), cubeSize.x, cubeSize.y, cubeSize.z)
}

case class RawCuboidRequest(
    position: Vec3Int,
    cubeSize: Vec3Int,
    mag: Vec3Int,
    additionalCoordinates: Option[Seq[AdditionalCoordinate]]
) extends AbstractDataRequest derives JsonAutoFormat {
  override def cuboid(dataLayer: DataLayer): Cuboid =
    Cuboid(VoxelPosition(position.x, position.y, position.z, mag), cubeSize.x, cubeSize.y, cubeSize.z)

  override def settings: DataServiceRequestSettings =
    DataServiceRequestSettings(additionalCoordinates = additionalCoordinates)
}

case class AdditionalCoordinate(
    name: String,
    value: Int,
    // Number of consecutive values to read along this axis instead of just one; must be absent/1
    // or exactly DataLayer.bucketLength, and only one additional axis may be batched at a time.
    // The batch is packed into the byte position normally occupied by z, so callers must only
    // request it for datasets whose z is degenerate — that isn't re-validated on the read path.
    length: Option[Int] = None
) derives JsonAutoFormat {
  override def toString: String = s"$name=$value"
}

object AdditionalCoordinate {

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
