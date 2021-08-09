package com.scalableminds.webknossos.datastore.services

import akka.actor.ActorSystem
import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.webknossos.datastore.models.datasource.inbox.InboxDataSource
import com.scalableminds.webknossos.datastore.models.datasource.{DataSource, DataSourceId}
import com.scalableminds.webknossos.datastore.storage.TemporaryStore
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging

import scala.concurrent.ExecutionContext.Implicits.global

class DataSourceRepository @Inject()(
    remoteWebKnossosClient: DSRemoteWebKnossosClient,
    @Named("webknossos-datastore") val system: ActorSystem
) extends TemporaryStore[DataSourceId, InboxDataSource](system)
    with LazyLogging
    with FoxImplicits {

  def findUsable(id: DataSourceId): Option[DataSource] =
    find(id).flatMap(_.toUsable)

  def updateDataSource(dataSource: InboxDataSource): Fox[Unit] =
    for {
      _ <- Fox.successful(())
      _ = insert(dataSource.id, dataSource)
      _ <- remoteWebKnossosClient.reportDataSource(dataSource)
    } yield ()

  def updateDataSources(dataSources: List[InboxDataSource]): Fox[Unit] =
    for {
      _ <- Fox.successful(())
      _ = removeAll()
      _ = dataSources.foreach(dataSource => insert(dataSource.id, dataSource))
      _ <- remoteWebKnossosClient.reportDataSources(dataSources)
    } yield ()

  def cleanUpDataSource(dataSourceId: DataSourceId): Fox[Unit] =
    for {
      _ <- Fox.successful(remove(dataSourceId))
      _ <- remoteWebKnossosClient.deleteErroneousDataSource(dataSourceId)
    } yield ()
}
