package com.scalableminds.webknossos.tracingstore

import com.google.inject.Inject
import com.scalableminds.util.cache.AlfuFoxCache
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.EditableMapping.AgglomerateGraph
import com.scalableminds.webknossos.datastore.helpers.MissingBucketHeaders
import com.scalableminds.webknossos.datastore.models.WebKnossosDataRequest
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.RemoteFallbackLayer
import com.typesafe.scalalogging.LazyLogging
import play.api.http.Status
import play.api.inject.ApplicationLifecycle

import scala.concurrent.ExecutionContext

class TSRemoteDatastoreClient @Inject()(
    rpc: RPC,
    remoteWebKnossosClient: TSRemoteWebKnossosClient,
    val lifecycle: ApplicationLifecycle
)(implicit ec: ExecutionContext)
    extends LazyLogging
    with MissingBucketHeaders {

  private lazy val dataStoreUriCache: AlfuFoxCache[(String, String), String] = AlfuFoxCache()
  private lazy val largestAgglomerateIdCache: AlfuFoxCache[(RemoteFallbackLayer, String, Option[String]), Long] =
    AlfuFoxCache()

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
        .getWithProtoResponse[AgglomerateGraph](AgglomerateGraph)
    } yield result

  def getLargestAgglomerateId(remoteFallbackLayer: RemoteFallbackLayer,
                              mappingName: String,
                              userToken: Option[String]): Fox[Long] = {
    val cacheKey = (remoteFallbackLayer, mappingName, userToken)
    largestAgglomerateIdCache.getOrLoad(
      cacheKey,
      k =>
        for {
          remoteLayerUri <- getRemoteLayerUri(k._1)
          result <- rpc(s"$remoteLayerUri/agglomerates/${k._2}/largestAgglomerateId")
            .addQueryStringOptional("token", k._3)
            .getWithJsonResponse[Long]
        } yield result
    )
  }

  private def getRemoteLayerUri(remoteLayer: RemoteFallbackLayer): Fox[String] =
    for {
      datastoreUri <- dataStoreUriWithCache(remoteLayer.organizationName, remoteLayer.dataSetName)
    } yield
      s"$datastoreUri/data/datasets/${remoteLayer.organizationName}/${remoteLayer.dataSetName}/layers/${remoteLayer.layerName}"

  private def getRemoteLayerUriZarr(remoteLayer: RemoteFallbackLayer): Fox[String] =
    for {
      datastoreUri <- dataStoreUriWithCache(remoteLayer.organizationName, remoteLayer.dataSetName)
    } yield
      s"$datastoreUri/data/zarr/${remoteLayer.organizationName}/${remoteLayer.dataSetName}/${remoteLayer.layerName}"

  private def dataStoreUriWithCache(organizationName: String, dataSetName: String): Fox[String] =
    dataStoreUriCache.getOrLoad(
      (organizationName, dataSetName),
      keyTuple => remoteWebKnossosClient.getDataStoreUriForDataSource(keyTuple._1, keyTuple._2))

}
