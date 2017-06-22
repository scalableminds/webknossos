/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.dataformats.knossos

import java.io.File
import java.nio.file.Path

import com.scalableminds.braingames.binary.`import`.{DataSourceImportReport, DataSourceImporter}
import com.scalableminds.braingames.binary.models.datasource.{Category, DataLayer, ElementClass, SegmentationLayer}
import com.scalableminds.util.geometry.{BoundingBox, Point3D}
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.ExtendedTypes._
import net.liftweb.common.{Box, Empty, Full}

object KnossosDataFormat extends DataSourceImporter {

  val cubeLength = 128

  val dataFileExtension = "raw"

  def exploreLayer(name: String, baseDir: Path, previous: Option[DataLayer])(implicit report: DataSourceImportReport[Path]): Box[DataLayer] = {
    val previousSections = previous match {
      case Some(l: KnossosDataLayer) => Some(l.sections)
      case _ => None
    }

    (for {
      elementClass <- guessElementClass(baseDir)
      category = guessLayerCategory(name, elementClass)
      sections <- exploreSections(baseDir, previousSections)
    } yield {
      category match {
        case Category.segmentation =>
          val mappings = exploreMappings(baseDir)
          val largestSegmentId = previous match {
            case Some(l: KnossosSegmentationLayer) => l.largestSegmentId
            case _ => SegmentationLayer.defaultLargestSegmentId
          }
          KnossosSegmentationLayer(name, sections, elementClass, mappings, largestSegmentId)
        case _ =>
          KnossosDataLayer(name, category, sections, elementClass)
      }
    }).passFailure { f =>
      report.error(layer => s"Error processing layer '$layer' - ${f.msg}")
    }
  }

  private def exploreSections(baseDir: Path, previous: Option[List[KnossosSection]]): Box[List[KnossosSection]] = {

    def sectionDirFilter(path: Path): Boolean =
      PathUtils.listDirectories(path).map(_.exists(p => p.getFileName.toString.toIntOpt.isDefined)).getOrElse(false)

    PathUtils.listDirectoriesRecursive(baseDir, 2, sectionDirFilter).map { sectionDirs =>
      sectionDirs.flatMap { sectionDir =>
        val sectionName = baseDir.relativize(sectionDir).toString
        val previousSection = previous.flatMap(_.find(_.name == sectionName))
        exploreSection(sectionName, sectionDir, previousSection)
      }
    }
  }

  private def exploreSection(name: String, baseDir: Path, previous: Option[KnossosSection]): Box[KnossosSection] = {

    def resolutionDirFilter(path: Path): Boolean = path.getFileName.toString.toIntOpt.isDefined

    PathUtils.listDirectories(baseDir, resolutionDirFilter).map { resolutionDirs =>
      val resolutions = resolutionDirs.flatMap(_.getFileName.toString.toIntOpt).toSet
      KnossosSection(name, resolutions, BoundingBox(Point3D(0,0,0),0,0,0))
    }
  }

  private def guessElementClass(baseDir: Path)(implicit report: DataSourceImportReport[Path]): Box[ElementClass.Value] = {

    def toInt(d: Double) = if (d.isWhole) Full(d.toInt) else Empty

    PathUtils.lazyFileStreamRecursive(baseDir, PathUtils.fileExtensionFilter(dataFileExtension)) { path =>
      for {
        dataFile <- Box(path.toStream.headOption) ?~ "Could not determine elementClass - No data file found"
        fileSize = new File(dataFile.toString).length()
        bytesPerElementDouble = fileSize.toDouble / math.pow(cubeLength, 3)
        elementClass <- toInt(bytesPerElementDouble).flatMap(ElementClass.fromBytesPerElement(_)) ?~ s"Could not determine elementClass - Invalid data file size ($fileSize)"
      } yield {
        elementClass
      }
    }
  }
}
