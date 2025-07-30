package com.scalableminds.webknossos.datastore.services

import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.inbox.InboxDataSource
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSource, DataSourceId}
import com.scalableminds.webknossos.datastore.storage.TemporaryStore
import com.typesafe.scalalogging.LazyLogging
import org.apache.pekko.actor.ActorSystem
import play.api.i18n.{Messages, MessagesProvider}

import scala.concurrent.ExecutionContext

class DataSourceRepository @Inject()(
    remoteWebknossosClient: DSRemoteWebknossosClient,
    @Named("webknossos-datastore") val actorSystem: ActorSystem
)(implicit ec: ExecutionContext)
    extends TemporaryStore[DataSourceId, InboxDataSource](actorSystem)
    with LazyLogging
    with FoxImplicits {

  def getDataSourceAndDataLayer(organizationId: String, datasetDirectoryName: String, dataLayerName: String)(
      implicit m: MessagesProvider): Fox[(DataSource, DataLayer)] =
    for {
      dataSource <- findUsable(DataSourceId(datasetDirectoryName, organizationId)).toFox ?~> Messages(
        "dataSource.notFound")
      dataLayer <- dataSource.getDataLayer(dataLayerName).toFox ?~> Messages("dataLayer.notFound", dataLayerName)
    } yield (dataSource, dataLayer)

  def findUsable(id: DataSourceId): Option[DataSource] =
    get(id).flatMap(_.toUsable)

  def updateDataSource(dataSource: InboxDataSource): Fox[Unit] =
    for {
      _ <- Fox.successful(())
      _ = insert(dataSource.id, dataSource)
      _ <- remoteWebknossosClient.reportDataSource(dataSource)
    } yield ()

  def updateDataSources(dataSources: List[InboxDataSource], organizationId: Option[String]): Fox[Unit] =
    for {
      _ <- Fox.successful(())
      _ = removeAll()
      _ = dataSources.foreach(dataSource => insert(dataSource.id, dataSource))
      _ <- remoteWebknossosClient.reportDataSources(dataSources, organizationId)
    } yield ()

  def removeDataSource(dataSourceId: DataSourceId): Fox[Unit] =
    for {
      _ <- Fox.successful(remove(dataSourceId))
      _ <- remoteWebknossosClient.deleteDataSource(dataSourceId)
    } yield ()
}
