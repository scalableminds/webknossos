/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.dataformats.wkw

import java.nio.file.Path

import com.scalableminds.braingames.binary.`import`.{DataSourceImportReport, DataSourceImporter}
import com.scalableminds.braingames.binary.dataformats.knossos.KnossosSegmentationLayer
import com.scalableminds.braingames.binary.models.datasource.{Category, DataLayer, ElementClass, SegmentationLayer}
import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.ExtendedTypes._
import com.scalableminds.webknossos.wrap.{VoxelType, WKWHeader}
import net.liftweb.common.{Box, Failure, Full}

object WKWDataFormat extends DataSourceImporter {

  val dataFileExtension = "wkw"

  def exploreLayer(name: String, baseDir: Path, previous: Option[DataLayer])(implicit report: DataSourceImportReport[Path]): Box[DataLayer] = {
    (for {
      header <- readWKWHeader(baseDir)
      elementClass <- voxelTypeToElementClass(header.voxelType)
    } yield {
      val category = guessLayerCategory(name, elementClass)
      val lengthOfUnderlyingCubes = header.numBlocksPerCubeDimension * header.numVoxelsPerBlockDimension
      val resolutions = exploreResolutions(baseDir)
      category match {
        case Category.segmentation =>
          val mappings = exploreMappings(baseDir)
          val largestSegmentId = previous match {
            case Some(l: KnossosSegmentationLayer) => l.largestSegmentId
            case _ => SegmentationLayer.defaultLargestSegmentId
          }
          WKWSegmentationLayer(name, BoundingBox.empty, resolutions, elementClass, lengthOfUnderlyingCubes, mappings, largestSegmentId)
        case _ =>
          WKWDataLayer(name, category, BoundingBox.empty, resolutions, elementClass, lengthOfUnderlyingCubes)
      }
    }).passFailure { f =>
      report.error(layer => s"Error processing layer '$layer' - ${f.msg}")
    }
  }

  private def readWKWHeader(baseDir: Path): Box[WKWHeader] = {
    PathUtils.lazyFileStreamRecursive(baseDir, PathUtils.fileExtensionFilter(dataFileExtension)) { path =>
      for {
        dataFile <- Box(path.toStream.headOption) ?~ "Could not determine elementClass - No data file found"
        wkwHeader <- WKWHeader(dataFile.toFile)
      } yield {
        wkwHeader
      }
    }
  }

  private def voxelTypeToElementClass(voxelType: VoxelType.Value): Box[ElementClass.Value] = {
    voxelType match {
      case VoxelType.UInt8 => Full(ElementClass.uint8)
      case VoxelType.UInt16 => Full(ElementClass.uint16)
      case VoxelType.UInt32 => Full(ElementClass.uint32)
      case VoxelType.UInt64 => Full(ElementClass.uint64)
      case _ => Failure("VoxelType is not supported.")
    }
  }
}
