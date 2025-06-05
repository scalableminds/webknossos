package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.ElementClassProto
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.WebknossosDataRequest
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayerLike, DataSourceId, ElementClass}
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.FallbackDataKey
import com.scalableminds.webknossos.tracingstore.{TSRemoteDatastoreClient, TSRemoteWebknossosClient}
import net.liftweb.common.Box

import scala.concurrent.ExecutionContext

case class RemoteFallbackLayer(organizationId: String,
                               datasetDirectoryName: String,
                               layerName: String,
                               elementClass: ElementClassProto)

object RemoteFallbackLayer extends ProtoGeometryImplicits {
  def fromDataLayerAndDataSource(dataLayer: DataLayerLike, dataSource: DataSourceId): Box[RemoteFallbackLayer] = {
    val elementClassProtoBox = ElementClass.toProto(dataLayer.elementClass)
    elementClassProtoBox.map(elementClassProto =>
      RemoteFallbackLayer(dataSource.organizationId, dataSource.directoryName, dataLayer.name, elementClassProto))
  }
}
trait FallbackDataHelper extends FoxImplicits {
  def remoteDatastoreClient: TSRemoteDatastoreClient
  def remoteWebknossosClient: TSRemoteWebknossosClient

  private lazy val fallbackBucketDataCache: AlfuCache[FallbackDataKey, (Array[Byte], List[Int])] =
    AlfuCache(maxCapacity = 3000)

  def remoteFallbackLayerForVolumeTracing(tracing: VolumeTracing, annotationId: ObjectId)(
      implicit ec: ExecutionContext): Fox[RemoteFallbackLayer] =
    for {
      layerName <- tracing.fallbackLayer.toFox ?~> "This feature is only defined on volume annotations with fallback segmentation layer."
      datasetId <- remoteWebknossosClient.getDataSourceIdForAnnotation(annotationId)
    } yield RemoteFallbackLayer(datasetId.organizationId, datasetId.directoryName, layerName, tracing.elementClass)

  def getFallbackBucketFromDataStore(remoteFallbackLayer: RemoteFallbackLayer, dataRequest: WebknossosDataRequest)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[Array[Byte]] =
    for {
      (data, missingBucketIndices) <- fallbackBucketDataCache.getOrLoad(
        FallbackDataKey(remoteFallbackLayer, dataRequest, tc.userTokenOpt),
        k => remoteDatastoreClient.getData(k.remoteFallbackLayer, Seq(k.dataRequest)))
      dataOrEmpty <- if (missingBucketIndices.isEmpty) Fox.successful(data) else Fox.empty
    } yield dataOrEmpty

  // Get multiple buckets at once: pro: fewer requests, con: no tracingstore-side caching
  def getFallbackBucketsFromDataStore(
      remoteFallbackLayer: RemoteFallbackLayer,
      dataRequests: Seq[WebknossosDataRequest])(implicit tc: TokenContext): Fox[(Array[Byte], List[Int])] =
    remoteDatastoreClient.getData(remoteFallbackLayer, dataRequests)
}
