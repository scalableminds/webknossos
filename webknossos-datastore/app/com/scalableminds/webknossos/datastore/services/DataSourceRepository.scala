package com.scalableminds.webknossos.datastore.services

import akka.actor.ActorSystem
import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.webknossos.datastore.models.datasource.inbox.InboxDataSource
import com.scalableminds.webknossos.datastore.models.datasource.{DataSource, DataSourceId}
import com.scalableminds.webknossos.datastore.storage.TemporaryStore
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import scala.concurrent.ExecutionContext.Implicits.global

class DataSourceRepository @Inject()(
    webKnossosServer: DataStoreWkRpcClient,
    @Named("webknossos-datastore") val system: ActorSystem
) extends TemporaryStore[DataSourceId, InboxDataSource](system)
    with FoxImplicits {

  def findUsable(id: DataSourceId): Option[DataSource] =
    find(id).flatMap(_.toUsable)

  def updateDataSource(dataSource: InboxDataSource): Fox[Unit] =
    for {
      _ <- Fox.successful(())
      _ = insert(dataSource.id, dataSource)
      _ <- webKnossosServer.reportDataSource(dataSource)
    } yield ()

  def updateDataSources(dataSources: List[InboxDataSource]): Fox[Unit] =
    for {
      _ <- Fox.successful(())
      _ = removeAll
      _ = dataSources.foreach(dataSource => insert(dataSource.id, dataSource))
      _ <- webKnossosServer.reportDataSources(dataSources)
    } yield ()
}
