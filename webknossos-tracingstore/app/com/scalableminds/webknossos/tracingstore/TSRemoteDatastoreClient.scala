package com.scalableminds.webknossos.tracingstore

import com.google.inject.Inject
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.helpers.MissingBucketHeaders
import com.scalableminds.webknossos.datastore.models.WebKnossosDataRequest
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.{AgglomerateGraph, RemoteFallbackLayer}
import com.typesafe.scalalogging.LazyLogging
import play.api.http.Status
import play.api.inject.ApplicationLifecycle

import scala.concurrent.ExecutionContext

class TSRemoteDatastoreClient @Inject()(
    rpc: RPC,
    config: TracingStoreConfig,
    val lifecycle: ApplicationLifecycle
)(implicit ec: ExecutionContext)
    extends LazyLogging
    with MissingBucketHeaders {

  private val datastoreUrl: String = config.Tracingstore.WebKnossos.uri

  def getAgglomerateSkeleton(userToken: Option[String],
                             remoteFallbackLayer: RemoteFallbackLayer,
                             mappingName: String,
                             agglomerateId: Long): Fox[Array[Byte]] =
    rpc(s"${remoteLayerUri(remoteFallbackLayer)}/agglomerates/$mappingName/skeleton/$agglomerateId")
      .addQueryStringOptional("token", userToken)
      .getWithBytesResponse

  def getData(remoteFallbackLayer: RemoteFallbackLayer,
              dataRequests: List[WebKnossosDataRequest]): Fox[(Array[Byte], List[Int])] =
    for {
      response <- rpc(s"${remoteLayerUri(remoteFallbackLayer)}/").post(dataRequests)
      _ <- bool2Fox(Status.isSuccessful(response.status))
      bytes = response.bodyAsBytes.toArray
      indices <- parseMissingBucketHeader(response.header(missingBucketsHeader)) ?~> "failed to parse missing bucket header"
    } yield (bytes, indices)

  def getVoxelAtPosition(userToken: Option[String],
                         remoteFallbackLayer: RemoteFallbackLayer,
                         pos: Vec3Int,
                         mag: Vec3Int): Fox[Array[Byte]] =
    rpc(s"${remoteLayerUri(remoteFallbackLayer)}/data")
      .addQueryStringOptional("token", userToken)
      .addQueryString("x" -> pos.x.toString)
      .addQueryString("y" -> pos.y.toString)
      .addQueryString("z" -> pos.z.toString)
      .addQueryString("width" -> "1")
      .addQueryString("height" -> "1")
      .addQueryString("depth" -> "1")
      .addQueryString("mag" -> mag.toMagLiteral())
      .getWithBytesResponse

  def getAgglomerateIdsForSegmentIds(remoteFallbackLayer: RemoteFallbackLayer,
                                     mappingName: String,
                                     segmentIdsOrdered: List[Long]): Fox[List[Long]] = ???

  private def remoteLayerUri(remoteLayer: RemoteFallbackLayer): String =
    s"$datastoreUrl/data/datasets/${remoteLayer.organizationName}/${remoteLayer.dataSetName}/layers/${remoteLayer.layerName}"

  def getAgglomerateGraph(remoteFallbackLayer: RemoteFallbackLayer,
                          agglomerateId: Long,
                          userToken: Option[String]): Fox[AgglomerateGraph] = ???

  def getLargestAgglomerateId(remoteFallbackLayer: RemoteFallbackLayer, mappingName: String): Fox[Long]
}
