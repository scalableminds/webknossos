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
                 ): Path = {
    baseDir
      .resolve(dataSourceId.map(_.team).getOrElse(""))
      .resolve(dataSourceId.map(_.name).getOrElse(""))
      .resolve(dataLayerName.getOrElse(""))
      .resolve(if (resolutionAsTriple) s"${cube.resolution.x}-${cube.resolution.y}-${cube.resolution.z}" else cube.resolution.maxDim.toString)
      .resolve(s"z${cube.z}")
      .resolve(s"y${cube.y}")
      .resolve(s"x${cube.x}.${dataFileExtension}")
  }

  def wkwHeaderFilePath(
                         resolution: Int,
                         dataSourceId: Option[DataSourceId] = None,
                         dataLayerName: Option[String] = None,
                         baseDir: Path = Paths.get("")
                       ): Path = {
    baseDir
      .resolve(dataSourceId.map(_.team).getOrElse(""))
      .resolve(dataSourceId.map(_.name).getOrElse(""))
      .resolve(dataLayerName.getOrElse(""))
      .resolve(resolution.toString)
      .resolve(s"header.${dataFileExtension}")
  }

  def parseWKWFilePath(path: String): Option[BucketPosition] = {
    val CubeRx = s".*(\\d+)/z(\\d+)/y(\\d+)/x(\\d+).${dataFileExtension}".r
    path match {
      case CubeRx(res, z, y, x) =>
        Some(new BucketPosition(
          x.toInt * DataLayer.bucketLength,
          y.toInt * DataLayer.bucketLength,
          z.toInt * DataLayer.bucketLength,
          Point3D(res.toInt, res.toInt, res.toInt)))
      case _ =>
        None
    }
  }

  def voxelTypeToElementClass(voxelType: VoxelType.Value): Box[ElementClass.Value] = {
    voxelType match {
      case VoxelType.UInt8 => Full(ElementClass.uint8)
      case VoxelType.UInt16 => Full(ElementClass.uint16)
      case VoxelType.UInt32 => Full(ElementClass.uint32)
      case VoxelType.UInt64 => Full(ElementClass.uint64)
      case _ => Failure("VoxelType is not supported.")
    }
  }

  def elementClassToVoxelType(elementClass: ElementClass.Value): (VoxelType.Value, Int) = {
    elementClass match {
      case ElementClass.uint8 => (VoxelType.UInt8, 1)
      case ElementClass.uint16 => (VoxelType.UInt16, 1)
      case ElementClass.uint24 => (VoxelType.UInt8, 3)
      case ElementClass.uint32 => (VoxelType.UInt32, 1)
      case ElementClass.uint64 => (VoxelType.UInt64, 1)
    }
  }
}
