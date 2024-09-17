package com.scalableminds.webknossos.datastore.services

import org.apache.pekko.actor.ActorSystem
import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.webknossos.datastore.models.datasource.inbox.InboxDataSource
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSource, DatasetIdWithPath, LegacyDataSourceId}
import com.scalableminds.webknossos.datastore.storage.TemporaryStore
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import play.api.i18n.{Messages, MessagesProvider}

import scala.concurrent.ExecutionContext

class DataSourceRepository @Inject()(
    remoteWebknossosClient: DSRemoteWebknossosClient,
    @Named("webknossos-datastore") val system: ActorSystem
)(implicit ec: ExecutionContext)
    extends TemporaryStore[DatasetIdWithPath, InboxDataSource](system)
    with LazyLogging
    with FoxImplicits {

  def getDataSourceAndDataLayer(datasetId: DatasetIdWithPath, dataLayerName: String)(
      implicit m: MessagesProvider): Fox[(DataSource, DataLayer)] =
    for {
      dataSource <- findUsable(datasetId).toFox ?~> Messages("dataSource.notFound")
      dataLayer <- dataSource.getDataLayer(dataLayerName) ?~> Messages("dataLayer.notFound", dataLayerName)
    } yield (dataSource, dataLayer)

  def findUsable(datasetId: DatasetIdWithPath): Option[DataSource] =
    find(datasetId).flatMap(_.toUsable)

  def updateDataSource(datasetId: DatasetIdWithPath, dataSource: InboxDataSource): Fox[Unit] =
    for {
      _ <- Fox.successful(())
      _ = insert(datasetId, dataSource)
      _ <- remoteWebknossosClient.reportDataSource(dataSource)
    } yield ()

  def updateDataSources(dataSources: List[InboxDataSource]): Fox[Unit] =
    for {
      _ <- Fox.successful(())
      _ = removeAll()
      _ = dataSources.foreach(dataSource => insert(dataSource.id, dataSource))
      _ <- remoteWebknossosClient.reportDataSources(dataSources)
    } yield ()

  def cleanUpDataSource(dataSourceId: LegacyDataSourceId): Fox[Unit] =
    for {
      _ <- Fox.successful(remove(dataSourceId))
      _ <- remoteWebknossosClient.deleteDataSource(dataSourceId)
    } yield ()
}
