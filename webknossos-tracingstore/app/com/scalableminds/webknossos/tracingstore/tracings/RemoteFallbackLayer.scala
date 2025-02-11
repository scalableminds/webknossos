package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.option2Fox
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.ElementClassProto
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.WebknossosDataRequest
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayerLike, DataSourceId}
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.FallbackDataKey
import com.scalableminds.webknossos.tracingstore.{TSRemoteDatastoreClient, TSRemoteWebknossosClient}

import scala.concurrent.ExecutionContext

case class RemoteFallbackLayer(
    organizationId: String,
    datasetDirectoryName: String,
    layerName: String,
    elementClass: ElementClassProto
)

object RemoteFallbackLayer extends ProtoGeometryImplicits {
  def fromDataLayerAndDataSource(dataLayer: DataLayerLike, dataSource: DataSourceId): RemoteFallbackLayer =
    RemoteFallbackLayer(dataSource.organizationId, dataSource.directoryName, dataLayer.name, dataLayer.elementClass)
}
trait FallbackDataHelper {
  def remoteDatastoreClient: TSRemoteDatastoreClient
  def remoteWebknossosClient: TSRemoteWebknossosClient

  private lazy val fallbackDataCache: AlfuCache[FallbackDataKey, (Array[Byte], List[Int])] =
    AlfuCache(maxCapacity = 3000)

  def remoteFallbackLayerFromVolumeTracing(tracing: VolumeTracing, tracingId: String)(implicit
      ec: ExecutionContext
  ): Fox[RemoteFallbackLayer] =
    for {
      layerName <-
        tracing.fallbackLayer.toFox ?~> "This feature is only defined on volume annotations with fallback segmentation layer."
      datasetId <- remoteWebknossosClient.getDataSourceIdForTracing(tracingId)
    } yield RemoteFallbackLayer(datasetId.organizationId, datasetId.directoryName, layerName, tracing.elementClass)

  def getFallbackDataFromDatastore(
      remoteFallbackLayer: RemoteFallbackLayer,
      dataRequests: List[WebknossosDataRequest]
  )(implicit ec: ExecutionContext, tc: TokenContext): Fox[(Array[Byte], List[Int])] =
    fallbackDataCache.getOrLoad(
      FallbackDataKey(remoteFallbackLayer, dataRequests, tc.userTokenOpt),
      k => remoteDatastoreClient.getData(k.remoteFallbackLayer, k.dataRequests)
    )
}
