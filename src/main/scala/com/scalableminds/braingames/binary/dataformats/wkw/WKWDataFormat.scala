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

object WKWDataFormat extends DataSourceImporter with WKWDataFormatHelper {

  def exploreLayer(name: String, baseDir: Path, previous: Option[DataLayer])(implicit report: DataSourceImportReport[Path]): Box[DataLayer] = {
    (for {
      resolutions <- exploreResolutions(baseDir)
      (voxelType, wkwResolutions) <- extractHeaderParameters(resolutions)
      elementClass <- voxelTypeToElementClass(voxelType)
    } yield {
      val category = guessLayerCategory(name, elementClass)
      val boundingBox = previous.map(_.boundingBox).getOrElse(BoundingBox.empty)
      category match {
        case Category.segmentation =>
          val mappings = exploreMappings(baseDir)
          val largestSegmentId = previous match {
            case Some(l: KnossosSegmentationLayer) => l.largestSegmentId
            case _ => SegmentationLayer.defaultLargestSegmentId
          }
          WKWSegmentationLayer(name, boundingBox, wkwResolutions, elementClass, mappings, largestSegmentId)
        case _ =>
          WKWDataLayer(name, category, boundingBox, wkwResolutions, elementClass)
      }
    }).passFailure { f =>
      report.error(layer => s"Error processing layer '$layer' - ${f.msg}")
    }
  }

  private def exploreResolutions(baseDir: Path)(implicit report: DataSourceImportReport[Path]): Box[List[(Int, WKWHeader)]] = {
    def resolutionDirFilter(path: Path): Boolean = path.getFileName.toString.toIntOpt.isDefined

    PathUtils.listDirectories(baseDir, resolutionDirFilter).flatMap { resolutions =>

      val resolutionHeaders = resolutions.map { resolution =>
        val resolutionInt = resolution.getFileName.toString.toInt
        WKWHeader(resolution.resolve("header.wkw").toFile).map(header => resolutionInt -> header).passFailure { f =>
          report.error(section => s"Error processing section '$section' - ${f.msg}")
        }
      }

      if (resolutionHeaders.exists(_.isInstanceOf[Failure])) {
        Failure("Error reading resolutions")
      } else {
        Full(resolutionHeaders.flatten)
      }
    }
  }

  private def extractHeaderParameters(resolutions: List[(Int, WKWHeader)])(implicit report: DataSourceImportReport[Path]): Box[(VoxelType.Value, List[WKWResolution])] = {
    val headers = resolutions.map(_._2)
    val voxelTypes = headers.map(_.voxelType).toSet
    val bucketLengths = headers.map(_.numVoxelsPerBlockDimension).toSet
    val wkwResolutions = resolutions.map(resolution => WKWResolution(resolution._1, resolution._2.numVoxelsPerBlockDimension * resolution._2.numBlocksPerCubeDimension))

    if (voxelTypes.size == 1 && bucketLengths == Set(32)) {
      Full((voxelTypes.head, wkwResolutions))
    } else {
      if (voxelTypes.size != 1) report.error(layer => s"Error processing layer '$layer' - all resolutions must have the same voxelType")
      if (bucketLengths != Set(32)) report.error(layer => s"Error processing layer '$layer' - all resolutions must have a bucketLength of 32")
      Failure("Error extracting parameters from header.wkw")
    }
  }
}
