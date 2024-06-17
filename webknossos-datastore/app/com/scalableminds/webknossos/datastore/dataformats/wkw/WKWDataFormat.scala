package com.scalableminds.webknossos.datastore.dataformats.wkw

import java.nio.file.Path
import com.scalableminds.webknossos.datastore.models.datasource.{Category, DataLayer, SegmentationLayer}
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.ExtendedTypes._
import com.scalableminds.webknossos.datastore.dataformats.layers.{WKWDataLayer, WKWResolution, WKWSegmentationLayer}
import com.scalableminds.webknossos.datastore.services.{DataSourceImportReport, DataSourceImporter}
import net.liftweb.common.{Box, Failure, Full}

object WKWDataFormat extends DataSourceImporter with WKWDataFormatHelper {

  def exploreLayer(name: String, baseDir: Path, previous: Option[DataLayer])(
      implicit report: DataSourceImportReport[Path]): Box[DataLayer] =
    (for {
      resolutions <- exploreResolutions(baseDir)
      ((voxelType, voxelSize), wkwResolutions) <- extractHeaderParameters(resolutions)
      elementClass <- VoxelType.toElementClass(voxelType, voxelSize)
    } yield {
      val category = previous.map(_.category).getOrElse(guessLayerCategory(name, elementClass))
      val boundingBox = previous
        .map(_.boundingBox)
        .orElse(guessBoundingBox(baseDir, wkwResolutions.headOption))
        .getOrElse(BoundingBox.empty)
      val defaultViewConfiguration = previous.flatMap(_.defaultViewConfiguration)
      category match {
        case Category.segmentation =>
          val mappings = exploreMappings(baseDir)
          val largestSegmentId = previous match {
            case Some(l: SegmentationLayer) => l.largestSegmentId
            case _                          => None
          }
          WKWSegmentationLayer(
            name,
            boundingBox,
            wkwResolutions,
            elementClass,
            mappings,
            largestSegmentId,
            defaultViewConfiguration
          )
        case _ =>
          WKWDataLayer(
            name,
            category,
            boundingBox,
            wkwResolutions,
            elementClass,
            defaultViewConfiguration
          )
      }
    }).passFailure { f =>
      report.error(layer => s"Error processing layer '$layer' - ${f.msg}")
    }

  private def exploreResolutions(baseDir: Path)(
      implicit report: DataSourceImportReport[Path]): Box[List[(WKWHeader, Vec3Int)]] =
    PathUtils.listDirectories(baseDir, silent = false, magDirFilter).flatMap { resolutionDirs =>
      val resolutionHeaders = resolutionDirs.sortBy(magDirSortingKey).map { resolutionDir =>
        val resolution = magFromPath(resolutionDir).get
        WKWHeader(resolutionDir.resolve(FILENAME_HEADER_WKW).toFile).map { header =>
          (header, resolution)
        }.passFailure { f =>
          report.error(_ => s"Error processing resolution '$resolution' - ${f.msg}")
        }
      }

      resolutionHeaders
        .toSingleBox("Error reading resolutions")
        .flatMap(list =>
          if (list.isEmpty) {
            Failure("No resolutions found. Consider adding resolution directories.")
          } else Full(list))
    }

  private def extractHeaderParameters(resolutions: List[(WKWHeader, Vec3Int)])(
      implicit report: DataSourceImportReport[Path]): Box[((VoxelType.Value, Int), List[WKWResolution])] = {
    val headers = resolutions.map(_._1)
    val voxelTypes = headers.map(_.voxelType).toSet
    val voxelSize = headers.map(_.numBytesPerVoxel).toSet
    val bucketLengths = headers.map(_.numVoxelsPerChunkDimension).toSet
    val wkwResolutions = resolutions.map { resolution =>
      WKWResolution(resolution._2, resolution._1.numVoxelsPerChunkDimension * resolution._1.numVoxelsPerChunkDimension)
    }

    if (voxelTypes.size == 1 && bucketLengths == Set(32)) {
      Full(((voxelTypes.head, voxelSize.head), wkwResolutions))
    } else {
      if (voxelTypes.size != 1)
        report.error(layer => s"Error processing layer '$layer' - all resolutions must have the same voxelType")
      if (bucketLengths != Set(32))
        report.error(layer => s"Error processing layer '$layer' - all resolutions must have a bucketLength of 32")
      Failure("Error extracting parameters from header.wkw")
    }
  }

  private def guessBoundingBox(baseDir: Path, resolutionOption: Option[WKWResolution]) = {
    def getIntFromFilePath(path: Path) = path.getFileName.toString.replaceAll(".wkw", "").substring(1).toInt

    def minMaxValue(path: Path, minMax: (Int, Int)) =
      (Math.min(minMax._1, getIntFromFilePath(path)), Math.max(minMax._2, getIntFromFilePath(path) + 1))

    for {
      resolution <- resolutionOption
      multiplierX = resolution.cubeLength * resolution.resolution.x
      multiplierY = resolution.cubeLength * resolution.resolution.y
      multiplierZ = resolution.cubeLength * resolution.resolution.z

      resolutionDirs <- PathUtils.listDirectories(baseDir, silent = false, filterGen(""))
      resolutionDir <- resolveHead(baseDir, resolutionDirs.sortBy(magDirSortingKey))

      zDirs <- PathUtils.listDirectories(resolutionDir, silent = false, filterGen("z"))
      zHeadDir <- resolveHead(resolutionDir, zDirs)

      yDirs <- PathUtils.listDirectories(zHeadDir, silent = false, filterGen("y"))
      yHeadDir <- resolveHead(zHeadDir, yDirs)

      xFiles <- PathUtils.listFiles(yHeadDir, silent = false, filterGen("x"))
      xFile <- xFiles.headOption

      (zMin, zMax) = zDirs.foldRight((getIntFromFilePath(zHeadDir), 0))(minMaxValue)
      (yMin, yMax) = yDirs.foldRight((getIntFromFilePath(yHeadDir), 0))(minMaxValue)
      (xMin, xMax) = xFiles.foldRight((getIntFromFilePath(xFile), 0))(minMaxValue)
    } yield {
      BoundingBox(
        Vec3Int(xMin * multiplierX, yMin * multiplierY, zMin * multiplierZ),
        xMax * multiplierX - xMin * multiplierX,
        yMax * multiplierY - yMin * multiplierY,
        zMax * multiplierZ - zMin * multiplierZ
      )
    }
  }

  private def filterGen(dimension: String) = (path: Path) => {
    path.getFileName.toString.matches(dimension + "\\d+.*")
  }

  private def resolveHead(baseDir: Path, paths: List[Path]) =
    for {
      headDirPath <- paths.headOption
    } yield {
      baseDir.resolve(headDirPath.getFileName)
    }
}
