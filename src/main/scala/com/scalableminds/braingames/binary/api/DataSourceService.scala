/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.api

import java.io.File
import java.nio.file.{Files, Path, Paths}

import com.scalableminds.braingames.binary.models._
import java.util.UUID
import java.util.zip.ZipFile

import com.scalableminds.braingames.binary.formats.knossos.{KnossosDataLayer, KnossosDataLayerSection}
import com.scalableminds.braingames.binary.formats.rocksdb.RocksDbDataLayer
import com.typesafe.config.Config
import com.scalableminds.util.tools.{Fox, FoxImplicits, ProgressState}
import com.scalableminds.braingames.binary.repository.DataSourceInbox
import com.scalableminds.braingames.binary.store.{DataStore, FileDataStore}
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

  def createUserDataLayer(baseDataSource: DataSource, initialContent: Option[File]): Fox[UserDataLayer] = {
    val category = DataLayer.SEGMENTATION.category
    val name = userDataLayerName()
    val basePath = userDataLayerFolder(name).toAbsolutePath
    val fallbackLayer = baseDataSource.getByCategory(category)
    val preliminaryDataLayer = RocksDbDataLayer(
      name,
      category,
      fallbackLayer.map(l => l.elementClass).getOrElse(DataLayer.SEGMENTATION.defaultElementClass),
      true,
      fallbackLayer.map(l => FallbackLayer(baseDataSource.id, l.name)),
      List(1),
      baseDataSource.boundingBox,
      baseDataSource.getByCategory(category).flatMap(_.nextSegmentationId),
      fallbackLayer.map(_.mappings).getOrElse(Nil)
    )

    PathUtils.ensureDirectory(basePath)

    initialContent match {
      case Some(zip) =>
        Fox.failure("Initial content is currently not supported.")
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
