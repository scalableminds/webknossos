package com.scalableminds.webknossos.datastore.services

import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.util.requestparsing.{DatasetURIParser, ObjectId}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.inbox.InboxDataSource
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSource, DataSourceId}
import com.scalableminds.webknossos.datastore.storage.TemporaryStore
import com.typesafe.scalalogging.LazyLogging
import org.apache.pekko.actor.ActorSystem
import play.api.i18n.{Messages, MessagesProvider}

import scala.concurrent.ExecutionContext

/* This class is used to resolve legacy dataset addressing by caching a mapping from the datasource id
   based on what is given by the URI path to a DatasetIdWithPath that contains the actual id of the dataset . */
class DatasetIdRepository @Inject()(
    remoteWebknossosClient: DSRemoteWebknossosClient,
    @Named("webknossos-datastore") val system: ActorSystem
)(implicit ec: ExecutionContext)
    extends TemporaryStore[DataSourceId, ObjectId](system)
    with LazyLogging
    with FoxImplicits
    with DatasetURIParser {

  def getDatasetIdFromIdOrName(datasetIdOrName: String, organizationId: String): Fox[ObjectId] = {
    val dataSourceId = DataSourceId(datasetIdOrName, organizationId)
    find(dataSourceId) match {
      case Some(datasetId) => Fox.successful(datasetId)
      case None =>
        val (maybeId, _) = getDatasetIdOrNameFromURIPath(datasetIdOrName)
        val resolvedId = maybeId match {
          case Some(id) => Fox.successful(id)
          case None     => remoteWebknossosClient.resolveDatasetNameToId(organizationId, datasetIdOrName)
        }
        resolvedId.map(insert(dataSourceId, _)).flatMap(_ => resolvedId)
    }
  }
}
