/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.formats.knossos

import java.io.FileWriter
import java.nio.file.{Files, Path}

import com.scalableminds.braingames.binary.models._
import com.scalableminds.braingames.binary.repository.mapping.{MappingParser, MappingPrinter}
import com.scalableminds.braingames.binary.repository.{DataSourceType, DataSourceTypeHandler}
import com.scalableminds.braingames.binary.requester.DataRequester
import com.scalableminds.util.geometry.{BoundingBox, Scale}
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.ExtendedTypes.ExtendedListOfBoxes
import com.scalableminds.util.tools.ProgressTracking.ProgressTracker
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}
import play.api.i18n.{I18nSupport, Messages, MessagesApi}

import scala.concurrent.ExecutionContext.Implicits._


class KnossosDataSourceType(val messagesApi: MessagesApi) extends DataSourceType with KnossosDataSourceTypeHandler {
  val name = KnossosDataSourceType.name
}

object KnossosDataSourceType {
  val name = "knossos"
}

trait KnossosDataSourceTypeHandler extends DataSourceTypeHandler with I18nSupport with FoxImplicits with LazyLogging {

  private val maxRecursiveLayerDepth = 2

  private val DEFAULT_PRIORITY = 0

  def mappingsDirectory = "mappings"

  def mappingFileExtension = "json"

  def fileExtension = "raw"

  def importDataSource(dataRequester: DataRequester, unusableDataSource: UnusableDataSource, progressTracker: ProgressTracker)
                      (implicit messages: Messages): Fox[DataSource] = {
    dataSourceFromFile(unusableDataSource.sourceFolder)
  }

  protected def createSection(path: Path, settings: DataLayerSectionSettings): Box[DataLayerSection] = {
    for {
      bboxSmall <- BoundingBox.createFrom(settings.bboxSmall) ?~! Messages("dataset.section.bboxsmall.invalid")
      bboxBig <- BoundingBox.createFrom(settings.bboxBig)  ?~! Messages("dataset.section.bboxbig.invalid")
    } yield {
      DataLayerSection(
                        path.toString,
                        settings.sectionId getOrElse path.getFileName.toString,
                        settings.resolutions,
                        bboxSmall,
                        bboxBig)
    }
  }

  protected def extractSections(base: Path): Fox[List[DataLayerSection]] = {
    extractSectionSettings(base).flatMap { sectionSettingsMap =>
      Fox.combined(sectionSettingsMap.map {
        case (path, settings) => createSection(base.relativize(path), settings).toFox
      }.toList)
    }
  }

  protected def extractSectionSettings(base: Path): Fox[Map[Path, DataLayerSectionSettings]] = {

    def extract(path: Path, depth: Int = 0): List[Box[(Path, DataLayerSectionSettings)]] = {
      if (depth > maxRecursiveLayerDepth) {
        List.empty
      } else {
        val head = DataLayerSectionSettings.fromSettingsFileIn(path, base).map(path -> _)
        val tail = PathUtils.listDirectories(path) match {
          case Full(dirs) => dirs.flatMap(d => extract(d, depth + 1))
          case f: Failure => List(f)
          case Empty => List(Empty)
        }
        head :: tail
      }
    }

    extract(base).combine.map(_.toMap).toFox
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

  protected def normalizeMappingsRec(mappings: List[DataLayerMapping],
                                     finished: Map[String, DataLayerMapping]): List[DataLayerMapping] = {
    mappings match {
      case Nil =>
        finished.values.toList

      case _ =>
        val keys = finished.keys.toList
        val (now, later) = mappings.partition(_.parent.forall(keys.contains))

        if (now.isEmpty) {
          finished.values.toList
        } else {
          val normalized = now.map {
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
    normalizeMappingsRec(mappings, Map.empty).map {
      mapping =>
        val filename = mapping.name.replaceAll("[^a-zA-Z0-9.-]", "_")
        val path = base.resolve(s"$filename.$mappingFileExtension")
        PathUtils.fileOption(path).foreach {
          file =>
            MappingPrinter.print(mapping, new FileWriter(file))
        }
        Full(mapping.copy(path = Some(path.toString), classes = None))
    }.toSingleBox("Error normalizing mappings")
  }

  protected def extractMappings(base: Path): Fox[List[DataLayerMapping]] = {
    val sourceDir = base.resolve(mappingsDirectory)
    val targetDir = sourceDir.resolve("target")

    if(base.resolve(mappingsDirectory).toFile.exists()) {
      for {
        files <- PathUtils.listFiles(base.resolve(mappingsDirectory)).toFox
        mappings <- Fox.combined(files
                                   .filter(_.toString.toLowerCase.endsWith(s".$mappingFileExtension"))
                                   .map(mappingFile => MappingParser.parse(mappingFile).toFox))
        _ = PathUtils.ensureDirectory(targetDir)
        normalizedMapping <- normalizeMappings(targetDir, mappings)
      } yield normalizedMapping
    } else {
      Fox.successful(Nil)
    }
  }

  protected def extractLayer(layer: Path, dataSourcePath: Path): Fox[DataLayer] = {
    for {
      settings <- DataLayerSettings.fromSettingsFileIn(layer, dataSourcePath).toFox
      sections <- extractSections(layer)
      mappings <- extractMappings(layer)
    } yield {
      logger.info("Found Layer: " + settings)
      val dataLayerPath = layer.toAbsolutePath.toString
      KnossosDataLayer(layer.getFileName.toString,
                settings.typ,
                dataLayerPath,
                settings.flags,
                settings.`class`,
                isWritable = false,
                settings.fallback,
                sections,
                settings.largestValue.map(_ + 1),
                mappings)
    }
  }

  protected def extractLayers(path: Path, dataSourcePath: Path): Fox[List[DataLayer]] = {
    for {
      dirs <- PathUtils.listDirectories(path).toFox
      parsedLayerSettings = dirs.map(layerPath => extractLayer(layerPath, dataSourcePath))
      _ = dirs.nonEmpty ?~> Messages("dataSet.import.noLayers")
      layerSettings <- Fox.combined(parsedLayerSettings)
    } yield layerSettings
  }

  protected def dataSourceFromFile(path: Path): Fox[DataSource] = {
    def extractDSSettingsIfPossible: Box[DataSource] = {
      DataSourceSettings.fromSettingsFileIn(path, path) match {
        case Full(settings) =>
          Full(DataSource(
                           settings.id getOrElse path.getFileName.toString,
                           path.toAbsolutePath.toString,
                           settings.scale,
                           settings.priority.getOrElse(DEFAULT_PRIORITY),
                           Nil))
        case Empty =>
          // If there is no config file present, we are using some default settings
          Full(DataSource(path.getFileName.toString,
                          path.toAbsolutePath.toString,
                          Scale.default,
                          DEFAULT_PRIORITY,
                          Nil))
        case f: Failure =>
          f
      }
    }

    if (Files.isDirectory(path)) {
      for {
        dataSource <- extractDSSettingsIfPossible.toFox
        layers <- extractLayers(path, path.toAbsolutePath) ?~> Messages("dataSet.import.noLayers")
      } yield dataSource.copy(dataLayers = layers)
    } else
      Fox.failure(Messages("dataSet.import.directoryEmpty"))
  }
}