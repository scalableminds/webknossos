package com.scalableminds.datastore.services

import braingames.binary.models.{DataSourceRepository => AbstractDataSourceRepository, UnusableDataSource, UsableDataSource, DataSourceLike, InMemoryInboxSourceRepository}
import braingames.util.FoxImplicits
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
    Logger.debug("Available datasets: " + dataSources.map(_.id).mkString(", "))
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
