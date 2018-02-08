/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.dataformats.wkw

import java.nio.file.Path

import com.scalableminds.webknossos.datastore.models.datasource.{Category, DataLayer, DataResolution, SegmentationLayer}
import com.scalableminds.util.geometry.{BoundingBox, Point3D}
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.ExtendedTypes._
import com.scalableminds.webknossos.datastore.services.{DataSourceImportReport, DataSourceImporter}
import com.scalableminds.webknossos.wrap.{VoxelType, WKWHeader}
import net.liftweb.common.{Box, Failure, Full}

object WKWDataFormat extends DataSourceImporter with WKWDataFormatHelper {

  def exploreLayer(name: String, baseDir: Path, previous: Option[DataLayer])(implicit report: DataSourceImportReport[Path]): Box[DataLayer] = {
    (for {
      resolutions <- exploreResolutions(baseDir, previous.map(_.resolutions))
      (voxelType, wkwResolutions) <- extractHeaderParameters(resolutions)
      elementClass <- voxelTypeToElementClass(voxelType)
    } yield {
      val category = guessLayerCategory(name, elementClass)
      val boundingBox = previous.map(_.boundingBox).orElse(guessBoundingBox(baseDir, wkwResolutions.headOption)).getOrElse(BoundingBox.empty)
      category match {
        case Category.segmentation =>
          val mappings = exploreMappings(baseDir)
          val largestSegmentId = previous match {
            case Some(l: SegmentationLayer) => l.largestSegmentId
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

  private def exploreResolutions(baseDir: Path, previous: Option[List[DataResolution]])(implicit report: DataSourceImportReport[Path]): Box[List[(Int, WKWHeader, Point3D)]] = {
    def resolutionDirFilter(path: Path): Boolean = path.getFileName.toString.toIntOpt.isDefined

    PathUtils.listDirectories(baseDir, resolutionDirFilter).flatMap { resolutions =>

      val resolutionHeaders = resolutions.map { resolution =>
        val resolutionInt = resolution.getFileName.toString.toInt
        WKWHeader(resolution.resolve("header.wkw").toFile).map{ header =>
          val previousResolution = previous.flatMap(_.find(_.resolution == resolutionInt))
          val scale = previousResolution.map(_.scale).getOrElse(Point3D(resolutionInt, resolutionInt, resolutionInt))
          (resolutionInt, header, scale)
        }.passFailure { f =>
          report.error(section => s"Error processing resolution '$resolution' - ${f.msg}")
        }
      }

      resolutionHeaders.toSingleBox("Error reading resolutions")
    }
  }

  private def extractHeaderParameters(resolutions: List[(Int, WKWHeader, Point3D)])(implicit report: DataSourceImportReport[Path]): Box[(VoxelType.Value, List[WKWResolution])] = {
    val headers = resolutions.map(_._2)
    val voxelTypes = headers.map(_.voxelType).toSet
    val bucketLengths = headers.map(_.numVoxelsPerBlockDimension).toSet
    val wkwResolutions = resolutions.map{ resolution =>
      WKWResolution(resolution._1, resolution._2.numVoxelsPerBlockDimension * resolution._2.numBlocksPerCubeDimension, Some(resolution._3))
    }

    if (voxelTypes.size == 1 && bucketLengths == Set(32)) {
      Full((voxelTypes.head, wkwResolutions))
    } else {
      if (voxelTypes.size != 1) report.error(layer => s"Error processing layer '$layer' - all resolutions must have the same voxelType")
      if (bucketLengths != Set(32)) report.error(layer => s"Error processing layer '$layer' - all resolutions must have a bucketLength of 32")
      Failure("Error extracting parameters from header.wkw")
    }
  }

  private def guessBoundingBox(baseDir: Path, resolutionOption: Option[WKWResolution]) = {
    def getIntFromFilePath(path: Path) = path.getFileName.toString.replaceAll(".wkw", "").substring(1).toInt

    def minMaxValue(path: Path, minMax: (Int, Int)) =
      (Math.min(minMax._1, getIntFromFilePath(path)), Math.max(minMax._2, getIntFromFilePath(path) + 1))

    for {
      resolution <- resolutionOption
      multiplier = resolution.cubeLength * resolution.resolution

      resolutionDirs <- PathUtils.listDirectories(baseDir, filterGen(""))
      resolutionDir <- resolveHead(baseDir, resolutionDirs)

      zDirs <- PathUtils.listDirectories(resolutionDir, filterGen("z"))
      zHeadDir <- resolveHead(resolutionDir, zDirs)

      yDirs <- PathUtils.listDirectories(zHeadDir, filterGen("y"))
      yHeadDir <- resolveHead(zHeadDir, yDirs)

      xFiles <- PathUtils.listFiles(yHeadDir, filterGen("x"))
      xFile <- xFiles.headOption

      (zMin, zMax) = zDirs.foldRight((getIntFromFilePath(zHeadDir), 0))(minMaxValue)
      (yMin, yMax) = yDirs.foldRight((getIntFromFilePath(yHeadDir), 0))(minMaxValue)
      (xMin, xMax) = xFiles.foldRight((getIntFromFilePath(xFile), 0))(minMaxValue)
    } yield {
      BoundingBox(Point3D(xMin * multiplier, yMin * multiplier, zMin * multiplier), xMax * multiplier, yMax * multiplier, zMax * multiplier)
    }
  }

  private def filterGen(dimension: String) = (path: Path) => {
    path.getFileName.toString.matches(dimension + "\\d+.*")
  }

  private def resolveHead(baseDir: Path, paths: List[Path]) = {
    for {
      headDirPath <- paths.headOption
    } yield {
      baseDir.resolve(headDirPath.getFileName)
    }
  }
}
