package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSource}

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.DurationInt

class DatasetCache @Inject()(remoteWebknossosClient: DSRemoteWebknossosClient)(implicit ec: ExecutionContext)
    extends FoxImplicits {

  lazy val cache: AlfuCache[ObjectId, DataSource] = AlfuCache[ObjectId, DataSource](
    timeToLive = 1 day, // Cache for a longer time, since we invalidate the cache manually
    maxCapacity = 5000
  )

  def getById(id: ObjectId): Fox[DataSource] =
    cache.getOrLoad(id, id => for {
      inboxDataSource <- remoteWebknossosClient.getDataset(id)
      usableDataSource <- inboxDataSource.toUsable.toFox ?~> s"Data source is not usable: ${inboxDataSource.statusOpt}"
    } yield usableDataSource)

  def getWithLayer(id: ObjectId, dataLayerName: String): Fox[(DataSource, DataLayer)] =
    for {
      dataSource <- getById(id)
      dataLayer <- dataSource.getDataLayer(dataLayerName).toFox ?~> "Data layer not found"
    } yield (dataSource, dataLayer)

  def invalidateCache(datasetId: ObjectId): Unit = cache.remove(datasetId)

}
