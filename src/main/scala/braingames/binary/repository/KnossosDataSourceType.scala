/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package braingames.binary.repository

import scalax.file.{PathSet, PathMatcher, Path}
import braingames.binary.models._
import braingames.geometry.{Scale, BoundingBox}
import scala.Some
import braingames.util.PathUtils
import org.apache.commons.io.FileUtils
import play.api.libs.json.Json
import braingames.util.ProgressTracking.ProgressTracker

object KnossosDataSourceType extends DataSourceType with KnossosDataSourceTypeHandler{
  val name = "knossos"

  def fileExtension = "raw"
}

trait KnossosDataSourceTypeHandler extends DataSourceTypeHandler {
  import braingames.binary.Logger._

  private val maxRecursiveLayerDepth = 2

  def importDataSource(unusableDataSource: UnusableDataSource, progressTracker: ProgressTracker): Option[DataSource] = {
    dataSourceFromFile(unusableDataSource.sourceFolder)
  }

  protected def extractSections(base: Path): Iterable[DataLayerSection] = {
    val sectionSettingsMap = extractSectionSettings(base)
    sectionSettingsMap.map {
      case (path, settings) =>
        DataLayerSection(
          path.relativize(base).path,
          settings.sectionId getOrElse path.name,
          settings.resolutions,
          BoundingBox.createFrom(settings.bboxSmall),
          BoundingBox.createFrom(settings.bboxBig))
    }
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
    for {
      layer <- PathUtils.listDirectories(path).toList
      settings <- DataLayerSettings.fromSettingsFileIn(layer)
    } yield {
      logger.info("Found Layer: " + settings)
      val dataLayerPath = layer.toAbsolute.path
      val sections = extractSections(layer).toList
      DataLayer(layer.name, settings.typ, dataLayerPath, settings.flags, settings.`class`, settings.fallback, sections)
    }
  }

  protected def dataSourceFromFile(path: Path): Option[DataSource] = {
    if (path.isDirectory) {
      val dataSource: DataSource = DataSourceSettings.fromSettingsFileIn(path) match {
        case Some(settings) =>
          DataSource(
            settings.id getOrElse path.name,
            path.toAbsolute.path,
            settings.scale,
            settings.priority getOrElse 0,
            Nil)
        case _ =>
          DataSource(
            path.name,
            path.toAbsolute.path,
            Scale.default,
            0,
            Nil)
      }

      val layers = extractLayers(path, path.toAbsolute.path)

      Some(dataSource.copy(dataLayers = layers))
    } else
      None
  }
}