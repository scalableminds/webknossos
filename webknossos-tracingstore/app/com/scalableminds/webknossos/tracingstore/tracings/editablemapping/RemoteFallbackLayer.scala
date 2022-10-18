package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.util.cache.AlfuFoxCache
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.option2Fox
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.ElementClass
import com.scalableminds.webknossos.datastore.models.WebKnossosDataRequest
import com.scalableminds.webknossos.tracingstore.{TSRemoteDatastoreClient, TSRemoteWebKnossosClient}

import scala.concurrent.ExecutionContext

case class RemoteFallbackLayer(organizationName: String,
                               dataSetName: String,
                               layerName: String,
                               elementClass: ElementClass)

trait FallbackDataHelper {
  def remoteDatastoreClient: TSRemoteDatastoreClient
  def remoteWebKnossosClient: TSRemoteWebKnossosClient

  private lazy val fallbackDataCache: AlfuFoxCache[FallbackDataKey, (Array[Byte], List[Int])] =
    AlfuFoxCache(maxEntries = 3000)

  def remoteFallbackLayerFromVolumeTracing(tracing: VolumeTracing, tracingId: String)(
      implicit ec: ExecutionContext): Fox[RemoteFallbackLayer] =
    for {
      layerName <- tracing.fallbackLayer.toFox ?~> "This feature is only defined on volume annotations with fallback segmentation layer."
      dataSetId <- remoteWebKnossosClient.getDataSourceIdForTracing(tracingId)
    } yield RemoteFallbackLayer(dataSetId.team, dataSetId.name, layerName, tracing.elementClass)

  def getFallbackDataFromDatastore(
      remoteFallbackLayer: RemoteFallbackLayer,
      dataRequests: List[WebKnossosDataRequest],
      userToken: Option[String])(implicit ec: ExecutionContext): Fox[(Array[Byte], List[Int])] =
    fallbackDataCache.getOrLoad(FallbackDataKey(remoteFallbackLayer, dataRequests, userToken),
                                k => remoteDatastoreClient.getData(k.remoteFallbackLayer, k.dataRequests, k.userToken))
}
