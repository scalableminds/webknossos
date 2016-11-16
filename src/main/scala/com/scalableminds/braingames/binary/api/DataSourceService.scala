/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.api

import java.nio.file.{Files, Paths}

import com.scalableminds.braingames.binary.models._
import java.util.UUID
import com.typesafe.config.Config
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.braingames.binary.repository.DataSourceInbox
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.util.io.PathUtils

trait DataSourceService extends FoxImplicits{

  def config: Config

  def dataSourceInbox: DataSourceInbox

  lazy val userBaseFolder = PathUtils.ensureDirectory(Paths.get(config.getString("braingames.binary.userBaseFolder")))

  def userDataLayerFolder(name: String) = userBaseFolder.resolve(name)

  def userDataLayerName() = {
    UUID.randomUUID().toString
  }

  def createUserDataLayer(baseDataSource: DataSource): UserDataLayer = {
    val category = DataLayer.SEGMENTATION.category
    val name = userDataLayerName()
    val basePath = userDataLayerFolder(name).toAbsolutePath
    val sections = DataLayerSection("1", "1", List(1), baseDataSource.boundingBox, baseDataSource.boundingBox)
    val fallbackLayer = baseDataSource.getByCategory(category)
    val dataLayer = DataLayer(
      name,
      category,
      basePath.toString,
      None,
      fallbackLayer.map(l => l.elementClass).getOrElse(DataLayer.SEGMENTATION.defaultElementClass),
      isWritable = true,
      _isCompressed = Some(true),
      fallback = fallbackLayer.map(l => FallbackLayer(baseDataSource.id, l.name)),
      sections = List(sections),
      nextSegmentationId = baseDataSource.getByCategory(category).flatMap(_.nextSegmentationId),
      fallbackLayer.map(_.mappings).getOrElse(List.empty)
    )

    PathUtils.ensureDirectory(basePath)
    UserDataLayer(baseDataSource.id, dataLayer)
  }

  def importDataSource(id: String): Fox[Fox[UsableDataSource]] = {
    dataSourceInbox.importDataSource(id)
  }

  def progressForImport(id: String) =
    dataSourceInbox.progressForImport(id)

}
