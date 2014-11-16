/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.repository

import java.nio.file.{Files, Path}

import com.scalableminds.braingames.binary.models._
import com.scalableminds.util.geometry.{Scale, BoundingBox}
import com.scalableminds.util.tools.ProgressTracking.ProgressTracker
import com.scalableminds.util.io.PathUtils
import net.liftweb.common.{Empty, Box}
import scala.collection.breakOut

object KnossosDataSourceType extends DataSourceType with KnossosDataSourceTypeHandler{
  val name = "knossos"

  def fileExtension = "raw"
}

trait KnossosDataSourceTypeHandler extends DataSourceTypeHandler {
  import com.scalableminds.braingames.binary.Logger._

  private val maxRecursiveLayerDepth = 2

  def importDataSource(unusableDataSource: UnusableDataSource, progressTracker: ProgressTracker): Option[DataSource] = {
    dataSourceFromFile(unusableDataSource.sourceFolder)
  }

  protected def createSection(path: Path, settings: DataLayerSectionSettings): Box[DataLayerSection] = {
    for{
      bboxSmall <- BoundingBox.createFrom(settings.bboxSmall)
      bboxBig <- BoundingBox.createFrom(settings.bboxBig)
    } yield {
      DataLayerSection(
        path.toString,
        settings.sectionId getOrElse path.getFileName.toString,
        settings.resolutions,
        bboxSmall,
        bboxBig)
    }
  }

  protected def extractSections(base: Path): Box[List[DataLayerSection]] = {
    val sectionSettingsMap = extractSectionSettings(base)
    Box.listToListOfBoxes(sectionSettingsMap.map{
      case (path, settings) =>
        createSection(path.relativize(base), settings)
    }.toList).toSingleBox("Failed to create sections")
  }

  protected def extractSectionSettings(base: Path): Map[Path, DataLayerSectionSettings] = {

    def extract(path: Path, depth: Int = 0): List[Option[(Path, DataLayerSectionSettings)]] = {
      if (depth > maxRecursiveLayerDepth) {
        List()
      } else {
        DataLayerSectionSettings.fromSettingsFileIn(path).map(path -> _) ::
          PathUtils.listDirectories(path).toList.flatMap(d => extract(d, depth + 1))
      }
    }

    extract(base).flatten.toMap
  }

  protected def extractLayers(path: Path, dataSourcePath: String) = {
    val result = PathUtils.listDirectories(path).toList.map { layer =>
      for {
        settings <- Box(DataLayerSettings.fromSettingsFileIn(layer))
        sections <- extractSections(layer)
      } yield {
        logger.info("Found Layer: " + settings)
        val dataLayerPath = layer.toAbsolutePath.toString
        DataLayer(layer.getFileName.toString, settings.typ, dataLayerPath, settings.flags, settings.`class`, false, settings.fallback, sections, settings.largestValue.map(_ + 1))
      }
    }
    Box.listToListOfBoxes(result).toSingleBox("Failed to extract layers")
  }

  protected def dataSourceFromFile(path: Path): Box[DataSource] = {
    if (Files.isDirectory(path)) {
      val dataSource: DataSource = DataSourceSettings.fromSettingsFileIn(path) match {
        case Some(settings) =>
          DataSource(
            settings.id getOrElse path.getFileName.toString,
            path.toAbsolutePath.toString,
            settings.scale,
            settings.priority getOrElse 0,
            Nil)
        case _ =>
          DataSource(
            path.getFileName.toString,
            path.toAbsolutePath.toString,
            Scale.default,
            0,
            Nil)
      }

      extractLayers(path, path.toAbsolutePath.toString).map{ layers =>
        dataSource.copy(dataLayers = layers)
      }
    } else
      Empty
  }
}