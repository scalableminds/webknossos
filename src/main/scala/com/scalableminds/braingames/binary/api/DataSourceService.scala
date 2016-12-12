/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.api

import java.io.File
import java.nio.file.{Files, Path, Paths}

import com.scalableminds.braingames.binary.models._
import java.util.UUID
import java.util.zip.ZipFile

import com.scalableminds.braingames.binary.SaveBlock
import com.typesafe.config.Config
import com.scalableminds.util.tools.{Fox, FoxImplicits, ProgressState}
import com.scalableminds.braingames.binary.repository.DataSourceInbox
import com.scalableminds.braingames.binary.store.{DataStore, FileDataStore}
import com.scalableminds.util.geometry.Point3D
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.util.io.{PathUtils, ZipIO}
import net.liftweb.common.{Box, Full}
import org.apache.commons.io.IOUtils
import com.typesafe.scalalogging.LazyLogging

trait DataSourceService extends FoxImplicits with LazyLogging{

  def config: Config

  def dataSourceInbox: DataSourceInbox

  lazy val userBaseFolder = PathUtils.ensureDirectory(Paths.get(config.getString("braingames.binary.userBaseFolder")))

  def userDataLayerFolder(name: String): Path = userBaseFolder.resolve(name)

  def userDataLayerName(): String = {
    UUID.randomUUID().toString
  }

  def saveToFile(
                  file: File,
                  baseDataSource: DataSource,
                  dataLayer: DataLayer,
                  section: DataLayerSection): Fox[DataLayerSection] = {

    val dataStore = new FileDataStore
    try {
      val dataInfo = SaveBlock(baseDataSource, dataLayer, section, 1, Point3D(0,0,0), Array.empty)
      val zip = new ZipFile(file)
      val resolutions = ZipIO.withUnziped(zip, includeHiddenFiles = false) { entries =>
        Fox.serialSequence(entries) { e =>
          val fileName = e.getName
          val stream = zip.getInputStream(e)
          DataStore.knossosDirToCube(dataInfo, Paths.get(fileName)).map {
            case (resolution, point) =>
              val currentBlock = dataInfo.copy(
                block = point, resolution = resolution, data = IOUtils.toByteArray(stream))
              dataStore.save(currentBlock).map(_ => resolution)
          }.getOrElse(Fox.empty)
        }
      }
      resolutions.map{ res =>
        val rs = res.flatten.distinct.sorted
        section.copy(resolutions = rs)
      }
    } catch {
      case e: Exception =>
        logger.error("Exception: " + e)
        Fox.failure("dataStore.upload.zipInvalid", Full(e))
    }
  }

  def createUserDataLayer(baseDataSource: DataSource, initialContent: Option[File]): Fox[UserDataLayer] = {
    val category = DataLayer.SEGMENTATION.category
    val name = userDataLayerName()
    val basePath = userDataLayerFolder(name).toAbsolutePath
    val section = DataLayerSection("1", "1", List(1), baseDataSource.boundingBox, baseDataSource.boundingBox)
    val fallbackLayer = baseDataSource.getByCategory(category)
    val preliminaryDataLayer = DataLayer(
      name,
      category,
      basePath.toString,
      None,
      fallbackLayer.map(l => l.elementClass).getOrElse(DataLayer.SEGMENTATION.defaultElementClass),
      isWritable = true,
      _isCompressed = Some(true),
      fallback = fallbackLayer.map(l => FallbackLayer(baseDataSource.id, l.name)),
      sections = List(section),
      nextSegmentationId = baseDataSource.getByCategory(category).flatMap(_.nextSegmentationId),
      fallbackLayer.map(_.mappings).getOrElse(List.empty)
    )

    PathUtils.ensureDirectory(basePath)

    initialContent match {
      case Some(zip) =>
        saveToFile(zip, baseDataSource, preliminaryDataLayer, section)
          .map { section =>
            UserDataLayer(baseDataSource.id, preliminaryDataLayer.copy(sections = List(section)))
          }
      case _ =>
        Fox.successful(UserDataLayer(baseDataSource.id, preliminaryDataLayer))
    }
  }

  def importDataSource(id: String): Fox[Fox[UsableDataSource]] = {
    dataSourceInbox.importDataSource(id)
  }

  def progressForImport(id: String): ProgressState =
    dataSourceInbox.progressForImport(id)

}
