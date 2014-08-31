/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.api

import com.scalableminds.braingames.binary.models._
import java.util.UUID
import com.typesafe.config.Config
import scalax.file.Path
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.braingames.binary.repository.DataSourceInbox
import play.api.libs.concurrent.Execution.Implicits._
import play.api.i18n.Messages
import com.scalableminds.util.io.PathUtils

trait DataSourceService extends FoxImplicits{

  def config: Config

  def dataSourceInbox: DataSourceInbox

  lazy val userBaseFolder = PathUtils.ensureDirectory(Path.fromString(config.getString("braingames.binary.userBaseFolder")))

  def userDataLayerFolder(name: String) = userBaseFolder / name

  def userDataLayerName() = {
    UUID.randomUUID().toString
  }

  def createUserDataLayer(baseDataSource: DataSource): UserDataLayer = {
    val category = DataLayer.SEGMENTATION.category
    val name = userDataLayerName()
    val basePath = userDataLayerFolder(name).toAbsolute
    val sections = DataLayerSection("1", "1", List(1), baseDataSource.boundingBox, baseDataSource.boundingBox)
    val fallbackLayer = baseDataSource.getByCategory(category)
    val dataLayer = DataLayer(
      name,
      category,
      basePath.path,
      None,
      fallbackLayer.map(l => l.elementClass).getOrElse(DataLayer.SEGMENTATION.defaultElementClass),
      isWritable = true,
      fallback = fallbackLayer.map(l => FallbackLayer(baseDataSource.id, l.name)),
      sections = List(sections),
      nextSegmentationId = baseDataSource.getByCategory(category).flatMap(_.nextSegmentationId))

    basePath.createDirectory()
    UserDataLayer(baseDataSource.id, dataLayer)
  }

  def importDataSource(id: String): Fox[Fox[UsableDataSource]] = {
    dataSourceInbox.importDataSource(id)
  }

  def progressForImport(id: String) =
    dataSourceInbox.progressForImport(id)

}
