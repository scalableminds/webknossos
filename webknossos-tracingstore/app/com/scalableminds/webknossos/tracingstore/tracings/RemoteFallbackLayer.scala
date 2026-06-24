package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.ElementClassProto
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.WebknossosDataRequest
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, ElementClass}
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.FallbackDataKey
import com.scalableminds.webknossos.tracingstore.{TSRemoteDatastoreClient, TSRemoteWebknossosClient}
import com.scalableminds.util.tools.Box

import scala.concurrent.ExecutionContext

case class RemoteFallbackLayer(datasetId: ObjectId, layerName: String, elementClass: ElementClassProto)

object RemoteFallbackLayer extends ProtoGeometryImplicits {
  def fromDataLayerAndDatasetId(dataLayer: DataLayer, datasetId: ObjectId): Box[RemoteFallbackLayer] = {
    val elementClassProtoBox = ElementClass.toProto(dataLayer.elementClass)
    elementClassProtoBox.map(elementClassProto => RemoteFallbackLayer(datasetId, dataLayer.name, elementClassProto))
  }
}
trait FallbackDataHelper extends FoxImplicits {
  def remoteDatastoreClient: TSRemoteDatastoreClient
  def remoteWebknossosClient: TSRemoteWebknossosClient

  private lazy val fallbackBucketDataCache: AlfuCache[FallbackDataKey, (Array[Byte], Seq[Int], Seq[Int])] =
    AlfuCache(maxCapacity = 3000)

  def remoteFallbackLayerForVolumeTracing(tracing: VolumeTracing, annotationId: ObjectId)(implicit
      ec: ExecutionContext
  ): Fox[RemoteFallbackLayer] =
    for {
      layerName <-
        tracing.fallbackLayer.toFox ?~> "This feature is only defined on volume annotations with fallback segmentation layer."
      datasetId <- remoteWebknossosClient.getDatasetIdForAnnotation(annotationId)
    } yield RemoteFallbackLayer(datasetId, layerName, tracing.elementClass)

  def getFallbackBucketFromDataStore(remoteFallbackLayer: RemoteFallbackLayer, dataRequest: WebknossosDataRequest)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Array[Byte]] =
    for {
      (data, emptyBucketIndices, failureBucketIndices) <- fallbackBucketDataCache.getOrLoad(
        FallbackDataKey(remoteFallbackLayer, dataRequest, tc.userTokenOpt),
        k => remoteDatastoreClient.getData(k.remoteFallbackLayer, Seq(k.dataRequest))
      )
      dataOrEmpty <- if (emptyBucketIndices.isEmpty) Fox.successful(data) else Fox.empty
      _ <- Fox.fromBool(failureBucketIndices.isEmpty) ?~> Msg.Annotation.Volume.fallbackDataLoadingFailed
    } yield dataOrEmpty

  // Get multiple buckets at once: pro: fewer requests, con: no tracingstore-side caching
  def getFallbackBucketsFromDataStore(
      remoteFallbackLayer: RemoteFallbackLayer,
      dataRequests: Seq[WebknossosDataRequest]
  )(using tc: TokenContext): Fox[(Array[Byte], Seq[Int], Seq[Int])] =
    remoteDatastoreClient.getData(remoteFallbackLayer, dataRequests)
}
