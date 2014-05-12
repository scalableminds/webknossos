/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.datastore.services

import com.scalableminds.braingames.binary.models.{DataSourceRepository => AbstractDataSourceRepository, UnusableDataSource, UsableDataSource, DataSourceLike, InMemoryInboxSourceRepository}
import com.scalableminds.util.tools.FoxImplicits
import com.scalableminds.datastore.models.DataSourceDAO
import play.api.Logger
import play.api.libs.concurrent.Execution.Implicits._
import akka.actor.ActorSystem
import com.scalableminds.datastore.DataStorePlugin

class DataSourceRepository(implicit val system: ActorSystem) extends AbstractDataSourceRepository with InMemoryInboxSourceRepository with FoxImplicits {

  def findDataSource(name: String) =
    DataSourceDAO.find(name)

  def findUsableDataSource(name: String) =
    DataSourceDAO.findUsableByName(name).map(_.dataSource)

  def updateDataSources(dataSources: List[DataSourceLike]): Unit = {
    Logger.debug("Available datasets: " + dataSources.map(d => d.id + s" (${if(d.isUsable) "active" else "inactive"}})").mkString(", "))
    Logger.trace("Datasets: " + dataSources.mkString("\n"))
    dataSources.map{
      case d: UsableDataSource =>
        DataSourceDAO.updateDataSource(d)
      case d: UnusableDataSource =>
        DataSourceDAO.removeByName(d.id)
        DataSourceDAO.insert(d)
    }
    DataStorePlugin.current.map(_.binaryDataService.oxalisServer.reportDataSouces(dataSources))
  }
}
