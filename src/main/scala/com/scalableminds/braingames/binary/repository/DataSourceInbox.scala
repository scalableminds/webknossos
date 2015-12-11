/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.repository

import com.scalableminds.braingames.binary.models._
import com.scalableminds.util.tools.{FoxImplicits, Fox}
import net.liftweb.common._
import com.scalableminds.braingames.binary.models.UnusableDataSource
import akka.actor.ActorSystem
import play.api.i18n.{MessagesApi, Messages, I18nSupport}
import play.api.libs.concurrent.Execution.Implicits._

object DataSourceInbox{
  def create(repo: DataSourceRepository, server: String, s: ActorSystem)(messagesApi: MessagesApi) = new DataSourceInbox {
    def messagesApi = messagesApi
    
    val dataSourceInboxHelper = new DataSourceInboxHelper {
      def messagesApi = messagesApi
      
      val system = s
      val serverUrl = server
    }

    val dataSourceRepository = repo
  }
}

trait DataSourceInbox extends FoxImplicits with I18nSupport{

  def dataSourceInboxHelper: DataSourceInboxHelper

  def dataSourceRepository: DataSourceRepository

  def importDataSource(id: String): Fox[Fox[UsableDataSource]] = {
    for{
      ds <- dataSourceRepository.findInboxSource(id) ?~> Messages("dataSource.notFound")
      result <- importDataSource(ds)
    } yield result
  }

  def importDataSource(ds: DataSourceLike): Fox[Fox[UsableDataSource]] = {
    ds match {
      case ibx: UnusableDataSource if !dataSourceInboxHelper.isImportInProgress(ibx.id)=>
        Full(dataSourceInboxHelper.transformToDataSource(ibx))
      case _ : UnusableDataSource =>
        Failure(Messages("dataSource.import.alreadyInProgress"))
      case d: DataSource =>
        // TODO: think about what we should do if an already imported DS gets imported again
        Failure(Messages("dataSource.import.alreadyFinished"))
    }
  }

  def handler = new DataSourceInboxChangeHandler(dataSourceRepository, dataSourceInboxHelper.serverUrl)(messagesApi)

  def progressForImport(id: String) = dataSourceInboxHelper.progressForImport(id)
}