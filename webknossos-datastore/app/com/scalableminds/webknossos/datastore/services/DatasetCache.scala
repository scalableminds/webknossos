package com.scalableminds.webknossos.datastore.services

import com.google.inject.name.Named
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.DataSource
import com.scalableminds.webknossos.datastore.storage.TemporaryStore
import org.apache.pekko.actor.ActorSystem

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class DatasetCache @Inject()(remoteWebknossosClient: DSRemoteWebknossosClient,
                             @Named("webknossos-datastore") val actorSystem: ActorSystem)(implicit ec: ExecutionContext)
    extends FoxImplicits {

  val cache = new TemporaryStore[ObjectId, DataSource](actorSystem)

  def getById(id: ObjectId): Fox[DataSource] =
    cache.get(id) match {
      case Some(dataSource) => Fox.successful(dataSource)
      case None =>
        for {
          dataSource <- remoteWebknossosClient.getDataset(id.toString)
          _ = cache.insert(id, dataSource)
        } yield dataSource
    }

  def updateById(datasetId: String, dataSource: DataSource): Unit =
    cache.insert(ObjectId(datasetId), dataSource)

}
