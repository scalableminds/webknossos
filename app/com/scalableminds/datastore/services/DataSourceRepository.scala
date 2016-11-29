/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.datastore.services

import com.scalableminds.braingames.binary.models.{DataSourceLike, InMemoryInboxSourceRepository, UnusableDataSource, UsableDataSource, DataSourceRepository => AbstractDataSourceRepository}
import com.scalableminds.util.tools.FoxImplicits
import com.scalableminds.datastore.models.DataSourceDAO
import play.api.libs.concurrent.Execution.Implicits._
import akka.actor.ActorSystem
import com.scalableminds.datastore.DataStorePlugin
import com.typesafe.scalalogging.LazyLogging

class DataSourceRepository(implicit val system: ActorSystem)
  extends AbstractDataSourceRepository
          with InMemoryInboxSourceRepository
          with FoxImplicits
          with LazyLogging {

  def findDataSource(name: String) =
    DataSourceDAO.find(name)

  def findUsableDataSource(name: String) =
    DataSourceDAO.findUsableByName(name).map(_.dataSource)

  def updateDataSources(dataSources: List[DataSourceLike]): Unit = {
    logger.debug("Available datasets: " + dataSources.map(d => d.id + s" (${if(d.isUsable) "active" else "inactive"})").mkString(", "))
    logger.trace("Datasets: " + dataSources.mkString("\n"))
    dataSources.foreach{
      case d: UsableDataSource =>
        DataSourceDAO.updateDataSource(d)
      case d: UnusableDataSource =>
        DataSourceDAO.removeByName(d.id)
        DataSourceDAO.insert(d)
    }
    DataStorePlugin.current.map(_.oxalisServer.reportDataSources(dataSources))
  }
}
