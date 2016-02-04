/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.repository

import java.nio.file.{Files, Path}
import javax.inject.Inject
import play.api.i18n.{I18nSupport, MessagesApi, Messages}
import java.io.FileWriter

import com.scalableminds.braingames.binary.models._
import com.scalableminds.braingames.binary.repository.mapping.{MappingPrinter, MappingParser}
import com.scalableminds.util.geometry.{Scale, BoundingBox}
import com.scalableminds.util.tools.ProgressTracking.ProgressTracker
import com.scalableminds.util.tools.{FoxImplicits, Fox}
import com.scalableminds.util.tools.JsonHelper
import com.scalableminds.util.io.PathUtils
import net.liftweb.common.{Empty, Box, Full, Failure}
import org.apache.commons.io.{FileUtils, FilenameUtils}
import scala.collection.breakOut
import scala.concurrent.ExecutionContext.Implicits._
import play.api.libs.json._


class KnossosDataSourceType(val messagesApi: MessagesApi) extends DataSourceType with KnossosDataSourceTypeHandler{
  val name = "knossos"
}

trait KnossosDataSourceTypeHandler extends DataSourceTypeHandler with I18nSupport with FoxImplicits{
  import com.scalableminds.braingames.binary.Logger._

  private val maxRecursiveLayerDepth = 2
  
  def mappingsDirectory = "mappings"
  
  def mappingFileExtension = "json"
  
  def fileExtension = "raw"

  def importDataSource(unusableDataSource: UnusableDataSource, progressTracker: ProgressTracker): Fox[DataSource] = {
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
        createSection(base.relativize(path), settings)
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

  protected def normalizeClasses(classes: List[List[Long]], parentClasses: List[List[Long]]): Box[List[List[Long]]] = {

/*    import scala.collection.mutable.{Map => MutableMap}
    
    def find(m: MutableMap[Long, Long])(key: Long): Long = {
      val parent = m.getOrElse(key, key)
      if(parent == key)
        key
      else
        find(m)(parent)
    }

    def union(m: MutableMap[Long, Long])(a: Long, b: Long): Long = {
      val roots = List(find(m)(a), find(m)(b))
      m.put(roots.max, roots.min)
      m.put(roots.min, roots.min)
      roots.min
    }

    if(classes.reduceLeft((a, b) => a.union(b)).size != classes.foldLeft(0)((a, b) => a + b.size)) {
      Failure("Invalid mapping")
    } else {
      val parentClassesMap = parentClasses.map{
        c =>
          val minId = c.min
          c.map(_ -> minId)
      }.flatten.toMap

      val classesMap = MutableMap[Long, Long]()

      classes.foreach{
        c =>
          c.map(id => parentClassesMap.getOrElse(id, id)).reduceLeft(union(classesMap))
      }

      Full(classesMap.mapValues(find(classesMap)).groupBy(_._2).values.map(_.keys.toList.sorted).toList)
    }*/

    Full(classes)
  }

  protected def normalizeMappingsRec(mappings: List[DataLayerMapping], finished: Map[String, DataLayerMapping]): List[DataLayerMapping] = {
    mappings match {
      case Nil =>
        finished.values.toList

      case _ =>
        val keys = finished.keys.toList
        val (now, later) = mappings.partition(_.parent.map(keys.contains(_)).getOrElse(true))
        
        if(now.isEmpty) {
          finished.values.toList
        } else {
          val normalized = now.map{
            m =>
              val parentClasses = m.parent.flatMap(p => finished(p).classes).getOrElse(List())
              val classes = m.classes.getOrElse(List())
              m.name -> m.copy(classes = normalizeClasses(classes, parentClasses))
          }.filterNot(_._2.classes.isEmpty)
          normalizeMappingsRec(later, finished ++ normalized)
        }
    }
  }

  protected def normalizeMappings(base: Path, mappings: List[DataLayerMapping]): Box[List[DataLayerMapping]] = {
    normalizeMappingsRec(mappings, Map.empty).map{
      mapping =>
        val filename = mapping.name.replaceAll("[^a-zA-Z0-9.-]", "_")
        val path = base.resolve(s"$filename.${mappingFileExtension}")
        PathUtils.fileOption(path).foreach {
          file =>
            MappingPrinter.print(mapping, new FileWriter(file))
        }
        Full(mapping.copy(path = Some(path.toString), classes = None))
    }.toSingleBox("Error normalizing mappings")
  }

  protected def extractMappings(base: Path): Box[List[DataLayerMapping]] = {
    val sourceDir = base.resolve(mappingsDirectory)
    val targetDir = sourceDir.resolve("target")

    val mappings = PathUtils.listFiles(base.resolve(mappingsDirectory))
      .filter(_.toString.toLowerCase.endsWith(s".${mappingFileExtension}"))
      .map {
        mappingFile =>
          MappingParser.parse(mappingFile)
      }.toSingleBox(Messages("dataSet.import.layerMappingFailed"))
    
    PathUtils.ensureDirectory(targetDir)
    mappings.flatMap(normalizeMappings(targetDir, _))
  }

  protected def extractLayer(layer: Path, dataSourcePath: String) = {
    for {
      settings <- DataLayerSettings.fromSettingsFileIn(layer)
      sections <- extractSections(layer)
      mappings <- extractMappings(layer)
    } yield {
      logger.info("Found Layer: " + settings)
      val dataLayerPath = layer.toAbsolutePath.toString
      DataLayer(layer.getFileName.toString, settings.typ, dataLayerPath, settings.flags, settings.`class`, isWritable=false, settings.fallback, sections, settings.largestValue.map(_ + 1), mappings)
    }
  }

  protected def extractLayers(path: Path, dataSourcePath: String) = {
    val parsedLayerSettings = PathUtils.listDirectories(path).map(layerPath => extractLayer(layerPath, dataSourcePath))
    parsedLayerSettings.toSingleBox(Messages("dataSet.import.layerSettingsFailed"))
  }

  protected def dataSourceFromFile(path: Path): Box[DataSource] = {

    if (Files.isDirectory(path)) {
      val dataSource: DataSource = DataSourceSettings.fromSettingsFileIn(path) match {
        case Full(settings) =>
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
      Failure(Messages("dataSet.import.directoryEmpty"))
  }
}