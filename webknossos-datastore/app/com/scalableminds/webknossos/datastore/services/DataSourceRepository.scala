package com.scalableminds.webknossos.datastore.services

import akka.actor.ActorSystem
import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.webknossos.datastore.models.datasource.inbox.InboxDataSource
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSource, DataSourceId, SegmentationLayer}
import com.scalableminds.webknossos.datastore.storage.{DataVaultService, TemporaryStore}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.n5.N5Layer
import com.scalableminds.webknossos.datastore.dataformats.precomputed.PrecomputedLayer
import com.scalableminds.webknossos.datastore.dataformats.wkw.WKWLayer
import com.scalableminds.webknossos.datastore.dataformats.zarr.ZarrLayer
import com.typesafe.scalalogging.LazyLogging
import play.api.i18n.{Messages, MessagesProvider}

import scala.concurrent.ExecutionContext.Implicits.global

class DataSourceRepository @Inject()(
    remoteWebKnossosClient: DSRemoteWebKnossosClient,
    dataVaultService: DataVaultService,
    @Named("webknossos-datastore") val system: ActorSystem
) extends TemporaryStore[DataSourceId, InboxDataSource](system)
    with LazyLogging
    with FoxImplicits {

  def getDataSourceAndDataLayer(organizationName: String, dataSetName: String, dataLayerName: String)(
      implicit m: MessagesProvider): Fox[(DataSource, DataLayer)] =
    for {
      dataSource <- findUsable(DataSourceId(dataSetName, organizationName)).toFox ?~> Messages("dataSource.notFound")
      dataLayer <- dataSource.getDataLayer(dataLayerName) ?~> Messages("dataLayer.notFound", dataLayerName)
    } yield (dataSource, dataLayer)

  def invalidateVaultCache(organizationName: String, dataSetName: String, dataLayerName: String)(
      implicit m: MessagesProvider): Fox[Unit] =
    for {
      (_, dataLayer) <- getDataSourceAndDataLayer(organizationName, dataSetName, dataLayerName)
      magsOpt = dataLayer match {
        case layer: N5Layer          => Some(layer.mags)
        case layer: PrecomputedLayer => Some(layer.mags)
        case _: SegmentationLayer    => None
        case _: WKWLayer             => None
        case layer: ZarrLayer        => Some(layer.mags)
        case _                       => None
      }
      _ = magsOpt match {
        case Some(mags) => mags.map(mag => dataVaultService.clearVaultPath(mag))
        case None       => ()
      }
    } yield ()

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
      _ <- remoteWebKnossosClient.deleteDataSource(dataSourceId)
    } yield ()
}
