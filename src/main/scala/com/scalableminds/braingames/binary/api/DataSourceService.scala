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

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 09.06.13
 * Time: 16:20
 */
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
    val dataLayer = DataLayer(
      name,
      category,
      basePath.path,
      None,
      DataLayer.SEGMENTATION.defaultElementClass,
      isWritable = true,
      fallback = baseDataSource.getByCategory(category).map(l => FallbackLayer(baseDataSource.id, l.name)),
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
