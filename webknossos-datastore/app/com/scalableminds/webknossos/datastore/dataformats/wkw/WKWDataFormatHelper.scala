package com.scalableminds.webknossos.datastore.dataformats.wkw

import java.nio.file.{Path, Paths}

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSourceId, ElementClass}
import com.scalableminds.webknossos.datastore.models.{BucketPosition, CubePosition}
import com.scalableminds.webknossos.wrap.VoxelType
import net.liftweb.common.{Box, Failure, Full}

trait WKWDataFormatHelper {

  val dataFileExtension: String = "wkw"

  def wkwFilePath(
      cube: CubePosition,
      dataSourceId: Option[DataSourceId] = None,
      dataLayerName: Option[String] = None,
      baseDir: Path = Paths.get(""),
      resolutionAsTriple: Option[Boolean] = None
  ): Path =
    baseDir
      .resolve(dataSourceId.map(_.team).getOrElse(""))
      .resolve(dataSourceId.map(_.name).getOrElse(""))
      .resolve(dataLayerName.getOrElse(""))
      .resolve(formatResolution(cube.resolution, resolutionAsTriple))
      .resolve(s"z${cube.z}")
      .resolve(s"y${cube.y}")
      .resolve(s"x${cube.x}.$dataFileExtension")

  private def formatResolution(resolution: Vec3Int, resolutionAsTripleOpt: Option[Boolean] = None): String =
    resolutionAsTripleOpt.map { resolutionAsTriple =>
      if (resolutionAsTriple) s"${resolution.x}-${resolution.y}-${resolution.z}"
      else resolution.maxDim.toString
    }.getOrElse {
      if (resolution.isIsotropic) resolution.maxDim.toString else s"${resolution.x}-${resolution.y}-${resolution.z}"
    }

  def wkwHeaderFilePath(
      resolution: Vec3Int,
      dataSourceId: Option[DataSourceId] = None,
      dataLayerName: Option[String] = None,
      baseDir: Path = Paths.get("")
  ): Path =
    baseDir
      .resolve(dataSourceId.map(_.team).getOrElse(""))
      .resolve(dataSourceId.map(_.name).getOrElse(""))
      .resolve(dataLayerName.getOrElse(""))
      .resolve(formatResolution(resolution))
      .resolve(s"header.$dataFileExtension")

  def parseWKWFilePath(path: String): Option[BucketPosition] = {
    val CubeRx = s"(|.*/)(\\d+|\\d+-\\d+-\\d+)/z(\\d+)/y(\\d+)/x(\\d+).$dataFileExtension".r
    path match {
      case CubeRx(_, resolutionStr, z, y, x) =>
        Vec3Int.fromMagLiteral(resolutionStr, allowScalar = true).map {
          mag => BucketPosition(x.toInt * mag.x * DataLayer.bucketLength,
            y.toInt * mag.y * DataLayer.bucketLength,
            z.toInt * mag.z * DataLayer.bucketLength,
            mag)
        }
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
