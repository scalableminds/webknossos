package com.scalableminds.webknossos.datastore.dataformats.wkw

import java.nio.file.{Path, Paths}

import com.scalableminds.util.geometry.Point3D
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSourceId, ElementClass}
import com.scalableminds.webknossos.datastore.models.{BucketPosition, CubePosition}
import com.scalableminds.webknossos.wrap.VoxelType
import net.liftweb.common.{Box, Failure, Full}

trait WKWDataFormatHelper {

  val dataFileExtension = "wkw"

  def wkwFilePath(
      cube: CubePosition,
      dataSourceId: Option[DataSourceId] = None,
      dataLayerName: Option[String] = None,
      baseDir: Path = Paths.get(""),
      resolutionAsTriple: Boolean = false
  ): Path =
    baseDir
      .resolve(dataSourceId.map(_.team).getOrElse(""))
      .resolve(dataSourceId.map(_.name).getOrElse(""))
      .resolve(dataLayerName.getOrElse(""))
      .resolve(if (resolutionAsTriple) s"${cube.resolution.x}-${cube.resolution.y}-${cube.resolution.z}"
      else cube.resolution.maxDim.toString)
      .resolve(s"z${cube.z}")
      .resolve(s"y${cube.y}")
      .resolve(s"x${cube.x}.${dataFileExtension}")

  def wkwHeaderFilePath(
      resolution: Int,
      dataSourceId: Option[DataSourceId] = None,
      dataLayerName: Option[String] = None,
      baseDir: Path = Paths.get("")
  ): Path =
    baseDir
      .resolve(dataSourceId.map(_.team).getOrElse(""))
      .resolve(dataSourceId.map(_.name).getOrElse(""))
      .resolve(dataLayerName.getOrElse(""))
      .resolve(resolution.toString)
      .resolve(s"header.${dataFileExtension}")

  def parseWKWFilePath(path: String): Option[BucketPosition] = {
    val CubeRx = s".*(\\d+)/z(\\d+)/y(\\d+)/x(\\d+).${dataFileExtension}".r
    path match {
      case CubeRx(res, z, y, x) =>
        Some(
          BucketPosition(x.toInt * DataLayer.bucketLength,
                         y.toInt * DataLayer.bucketLength,
                         z.toInt * DataLayer.bucketLength,
                         Point3D(res.toInt, res.toInt, res.toInt)))
      case _ =>
        None
    }
  }

  def voxelTypeToElementClass(voxelType: VoxelType.Value, voxelSize: Int): Box[ElementClass.Value] =
    (voxelType, voxelSize) match {
      case (VoxelType.UInt8, 1)  => Full(ElementClass.uint8)
      case (VoxelType.UInt16, 2) => Full(ElementClass.uint16)
      case (VoxelType.UInt8, 3)  => Full(ElementClass.uint24)
      case (VoxelType.UInt32, 4) => Full(ElementClass.uint32)
      case (VoxelType.UInt64, 8) => Full(ElementClass.uint64)
      case (VoxelType.Float, 4)  => Full(ElementClass.float)
      case (VoxelType.Double, 8) => Full(ElementClass.double)
      case (VoxelType.Int8, 1)   => Full(ElementClass.int8)
      case (VoxelType.Int16, 2)  => Full(ElementClass.int16)
      case (VoxelType.Int32, 4)  => Full(ElementClass.int32)
      case (VoxelType.Int64, 8)  => Full(ElementClass.int64)
      case _                     => Failure("VoxelType is not supported.")
    }

  def elementClassToVoxelType(elementClass: ElementClass.Value): (VoxelType.Value, Int) =
    elementClass match {
      case ElementClass.uint8  => (VoxelType.UInt8, 1)
      case ElementClass.uint16 => (VoxelType.UInt16, 1)
      case ElementClass.uint24 => (VoxelType.UInt8, 3)
      case ElementClass.uint32 => (VoxelType.UInt32, 1)
      case ElementClass.uint64 => (VoxelType.UInt64, 1)
      case ElementClass.float  => (VoxelType.Float, 1)
      case ElementClass.double => (VoxelType.Double, 1)
      case ElementClass.int8   => (VoxelType.Int8, 1)
      case ElementClass.int16  => (VoxelType.Int16, 1)
      case ElementClass.int32  => (VoxelType.Int32, 1)
      case ElementClass.int64  => (VoxelType.Int64, 1)
    }
}
