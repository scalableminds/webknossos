/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package braingames.binary.repository

import braingames.binary.models._
import braingames.util.{FoxImplicits, Fox}
import net.liftweb.common._
import braingames.binary.models.UnusableDataSource
import akka.actor.ActorSystem
import play.api.libs.concurrent.Execution.Implicits._
import play.api.i18n.Messages

object DataSourceInbox{
  def create(repo: DataSourceRepository, server: String, s: ActorSystem) = new DataSourceInbox {
    val dataSourceInboxHelper = new DataSourceInboxHelper {
      val system = s
      val serverUrl = server
    }

    val dataSourceRepository = repo
  }
}

trait DataSourceInbox extends FoxImplicits{

  def dataSourceInboxHelper: DataSourceInboxHelper

  def dataSourceRepository: DataSourceRepository

  def importDataSource(id: String): Fox[Fox[UsableDataSource]] = {
    for{
      ds <- dataSourceRepository.findInboxSource(id) ?~> Messages("datasource.notFound")
      result <- importDataSource(ds)
    } yield result
  }

  def importDataSource(ds: DataSourceLike): Fox[Fox[UsableDataSource]] = {
    ds match {
      case ibx: UnusableDataSource if !dataSourceInboxHelper.isImportInProgress(ibx.id)=>
        Full(dataSourceInboxHelper.transformToDataSource(ibx))
      case _ : UnusableDataSource =>
        Failure(Messages("datasource.import.alreadyInProgress"))
      case d: DataSource =>
        // TODO: think about what we should do if an already imported DS gets imported again
        Failure(Messages("datasource.import.alreadyFinished"))
    }
  }

  def handler = new DataSourceInboxChangeHandler(dataSourceRepository, dataSourceInboxHelper.serverUrl)

  def progressForImport(id: String) = dataSourceInboxHelper.progressForImport(id)
}