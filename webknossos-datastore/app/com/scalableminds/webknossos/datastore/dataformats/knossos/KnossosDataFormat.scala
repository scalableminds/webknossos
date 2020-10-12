package com.scalableminds.webknossos.datastore.dataformats.knossos

import java.io.File
import java.nio.file.Path

import com.scalableminds.webknossos.datastore.models.datasource.{Category, DataLayer, ElementClass, SegmentationLayer}
import com.scalableminds.util.geometry.{BoundingBox, Point3D}
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.ExtendedTypes._
import com.scalableminds.webknossos.datastore.services.{DataSourceImportReport, DataSourceImporter}
import net.liftweb.common.{Box, Empty, Full}

object KnossosDataFormat extends DataSourceImporter {

  val cubeLength = 128

  val dataFileExtension = "raw"

  def exploreLayer(name: String, baseDir: Path, previous: Option[DataLayer])(
      implicit report: DataSourceImportReport[Path]): Box[DataLayer] = {
    val previousSections = previous.flatMap {
      case l: KnossosLayer => Some(l.sections)
      case _               => None
    }

    val inDBdefaultViewConfiguration = previous.flatMap(_.adminViewConfiguration)

    (for {
      elementClass <- guessElementClass(baseDir)
      category = guessLayerCategory(name, elementClass)
      sections <- exploreSections(baseDir, previousSections)
    } yield {
      category match {
        case Category.segmentation =>
          val mappings = exploreMappings(baseDir)
          val largestSegmentId = previous match {
            case Some(l: SegmentationLayer) => l.largestSegmentId
            case _                          => SegmentationLayer.defaultLargestSegmentId
          }
          KnossosSegmentationLayer(name,
                                   sections,
                                   elementClass,
                                   mappings,
                                   largestSegmentId,
                                   inDBdefaultViewConfiguration)
        case _ =>
          KnossosDataLayer(name, category, sections, elementClass, inDBdefaultViewConfiguration)
      }
    }).passFailure { f =>
      report.error(layer => s"Error processing layer '$layer' - ${f.msg}")
    }
  }

  private def exploreSections(baseDir: Path, previous: Option[List[KnossosSection]]): Box[List[KnossosSection]] = {

    def sectionDirFilter(path: Path): Boolean =
      PathUtils.listDirectories(path).map(_.exists(p => p.getFileName.toString.toIntOpt.isDefined)).getOrElse(false)

    PathUtils.listDirectoriesRecursive(baseDir, 2, sectionDirFilter).map { sectionDirs =>
      sectionDirs.map { sectionDir =>
        val sectionName = baseDir.relativize(sectionDir).toString
        val previousSection = previous.flatMap(_.find(_.name == sectionName))
        exploreSection(sectionName, sectionDir, previousSection)
      }
    }
  }

  private def exploreSection(name: String, baseDir: Path, previous: Option[KnossosSection]): KnossosSection = {
    val resolutions = exploreResolutions(baseDir)
    KnossosSection(name, resolutions, previous.map(_.boundingBox).getOrElse(BoundingBox.empty))
  }

  private def exploreResolutions(baseDir: Path): List[Either[Int, Point3D]] =
    PathUtils
      .listDirectories(baseDir, resolutionDirFilter)
      .map { resolutionDirs =>
        resolutionDirs.map(parseResolutionName(_).get)
      }
      .getOrElse(Nil)

  private def guessElementClass(baseDir: Path)(
      implicit report: DataSourceImportReport[Path]): Box[ElementClass.Value] = {

    def toInt(d: Double) = if (d.isWhole) Full(d.toInt) else Empty

    PathUtils.lazyFileStreamRecursive(baseDir, PathUtils.fileExtensionFilter(dataFileExtension)) { path =>
      for {
        dataFile <- Box(path.toStream.headOption) ?~ "Could not determine elementClass - No data file found"
        fileSize = new File(dataFile.toString).length()
        bytesPerElementDouble = fileSize.toDouble / math.pow(cubeLength, 3)
        elementClass <- toInt(bytesPerElementDouble).flatMap(ElementClass.guessFromBytesPerElement) ?~ s"Could not determine elementClass - Invalid data file size ($fileSize)"
      } yield {
        elementClass
      }
    }
  }
}
