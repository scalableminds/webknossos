package com.scalableminds.webknossos.tracingstore

import akka.http.caching.LfuCache
import akka.http.caching.scaladsl.{Cache, CachingSettings}
import com.google.inject.Inject
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.helpers.MissingBucketHeaders
import com.scalableminds.webknossos.datastore.models.{AgglomerateGraph, WebKnossosDataRequest}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.RemoteFallbackLayer
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box
import play.api.http.Status
import play.api.inject.ApplicationLifecycle

import scala.concurrent.duration.DurationInt
import scala.concurrent.{ExecutionContext, Future}

class TSRemoteDatastoreClient @Inject()(
    rpc: RPC,
    remoteWebKnossosClient: TSRemoteWebKnossosClient,
    val lifecycle: ApplicationLifecycle
)(implicit ec: ExecutionContext)
    extends LazyLogging
    with MissingBucketHeaders {

  private lazy val dataStoreUriCache: Cache[(Option[String], String), Box[String]] = {
    val defaultCachingSettings = CachingSettings("")
    val maxEntries = 1000
    val lfuCacheSettings =
      defaultCachingSettings.lfuCacheSettings
        .withInitialCapacity(maxEntries)
        .withMaxCapacity(maxEntries)
        .withTimeToLive(2 hours)
        .withTimeToIdle(1 hour)
    val cachingSettings =
      defaultCachingSettings.withLfuCacheSettings(lfuCacheSettings)
    val lfuCache: Cache[(Option[String], String), Box[String]] = LfuCache(cachingSettings)
    lfuCache
  }

  def fallbackLayerBucket(remoteFallbackLayer: RemoteFallbackLayer,
                          mag: String,
                          cxyz: String,
                          userToken: Option[String]): Fox[Array[Byte]] =
    for {
      remoteLayerUri <- getRemoteLayerUriZarr(remoteFallbackLayer)
      result <- rpc(s"$remoteLayerUri/$mag/$cxyz").addQueryStringOptional("token", userToken).getWithBytesResponse
    } yield result

  def getAgglomerateSkeleton(userToken: Option[String],
                             remoteFallbackLayer: RemoteFallbackLayer,
                             mappingName: String,
                             agglomerateId: Long): Fox[Array[Byte]] =
    for {
      remoteLayerUri <- getRemoteLayerUri(remoteFallbackLayer)
      result <- rpc(s"$remoteLayerUri/agglomerates/$mappingName/skeleton/$agglomerateId")
        .addQueryStringOptional("token", userToken)
        .getWithBytesResponse
    } yield result

  def getData(remoteFallbackLayer: RemoteFallbackLayer,
              dataRequests: List[WebKnossosDataRequest],
              userToken: Option[String]): Fox[(Array[Byte], List[Int])] =
    for {
      remoteLayerUri <- getRemoteLayerUri(remoteFallbackLayer)
      response <- rpc(s"$remoteLayerUri/data").addQueryStringOptional("token", userToken).silent.post(dataRequests)
      _ <- bool2Fox(Status.isSuccessful(response.status))
      bytes = response.bodyAsBytes.toArray
      indices <- parseMissingBucketHeader(response.header(missingBucketsHeader)) ?~> "failed to parse missing bucket header"
    } yield (bytes, indices)

  def getVoxelAtPosition(userToken: Option[String],
                         remoteFallbackLayer: RemoteFallbackLayer,
                         pos: Vec3Int,
                         mag: Vec3Int): Fox[Array[Byte]] =
    for {
      remoteLayerUri <- getRemoteLayerUri(remoteFallbackLayer)
      result <- rpc(s"$remoteLayerUri/data")
        .addQueryStringOptional("token", userToken)
        .addQueryString("x" -> pos.x.toString)
        .addQueryString("y" -> pos.y.toString)
        .addQueryString("z" -> pos.z.toString)
        .addQueryString("width" -> "1")
        .addQueryString("height" -> "1")
        .addQueryString("depth" -> "1")
        .addQueryString("mag" -> mag.toMagLiteral())
        .silent
        .getWithBytesResponse
    } yield result

  def getAgglomerateIdsForSegmentIds(remoteFallbackLayer: RemoteFallbackLayer,
                                     mappingName: String,
                                     segmentIdsOrdered: List[Long],
                                     userToken: Option[String]): Fox[List[Long]] =
    for {
      remoteLayerUri <- getRemoteLayerUri(remoteFallbackLayer)
      result <- rpc(s"$remoteLayerUri/agglomerates/$mappingName/agglomeratesForSegments")
        .addQueryStringOptional("token", userToken)
        .silent
        .postJsonWithJsonResponse[List[Long], List[Long]](segmentIdsOrdered)
    } yield result

  def getAgglomerateGraph(remoteFallbackLayer: RemoteFallbackLayer,
                          baseMappingName: String,
                          agglomerateId: Long,
                          userToken: Option[String]): Fox[AgglomerateGraph] =
    for {
      remoteLayerUri <- getRemoteLayerUri(remoteFallbackLayer)
      result <- rpc(s"$remoteLayerUri/agglomerates/$baseMappingName/agglomerateGraph/$agglomerateId")
        .addQueryStringOptional("token", userToken)
        .getWithJsonResponse[AgglomerateGraph]
    } yield result

  def getLargestAgglomerateId(remoteFallbackLayer: RemoteFallbackLayer,
                              mappingName: String,
                              userToken: Option[String]): Fox[Long] =
    for {
      remoteLayerUri <- getRemoteLayerUri(remoteFallbackLayer)
      result <- rpc(s"$remoteLayerUri/agglomerates/$mappingName/largestAgglomerateId")
        .addQueryStringOptional("token", userToken)
        .getWithJsonResponse[Long]
    } yield result

  private def getRemoteLayerUri(remoteLayer: RemoteFallbackLayer): Fox[String] =
    for {
      datastoreUri <- dataStoreUriFromCache(remoteLayer.organizationName, remoteLayer.dataSetName).toFox
    } yield
      s"$datastoreUri/data/datasets/${remoteLayer.organizationName}/${remoteLayer.dataSetName}/layers/${remoteLayer.layerName}"

  private def getRemoteLayerUriZarr(remoteLayer: RemoteFallbackLayer): Fox[String] =
    for {
      datastoreUri <- dataStoreUriFromCache(remoteLayer.organizationName, remoteLayer.dataSetName).toFox
    } yield
      s"$datastoreUri/data/datasets/${remoteLayer.organizationName}/${remoteLayer.dataSetName}/layers/${remoteLayer.layerName}"

  private def dataStoreUriFromCache(organizationName: String, dataSetName: String): Future[Box[String]] =
    dataStoreUriCache.getOrLoad(
      (Some(organizationName), dataSetName),
      keyTuple => remoteWebKnossosClient.getDataStoreUriForDataSource(keyTuple._1, keyTuple._2)
    )
}
