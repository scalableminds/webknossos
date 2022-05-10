package com.scalableminds.webknossos.tracingstore

import com.google.inject.Inject
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.DataRequestCollection.DataRequestCollection
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.RemoteFallbackLayer
import com.typesafe.scalalogging.LazyLogging
import play.api.inject.ApplicationLifecycle

class TSRemoteDatastoreClient @Inject()(
    rpc: RPC,
    config: TracingStoreConfig,
    val lifecycle: ApplicationLifecycle
) extends LazyLogging {

  private val datastoreUrl: String = config.Tracingstore.WebKnossos.uri

  def getAgglomerateSkeleton(userToken: Option[String],
                             remoteFallbackLayer: RemoteFallbackLayer,
                             mappingName: String,
                             agglomerateId: Long): Fox[Array[Byte]] =
    rpc(s"${remoteLayerUri(remoteFallbackLayer)}/agglomerates/$mappingName/skeleton/$agglomerateId")
      .addQueryStringOptional("token", userToken)
      .getWithBytesResponse

  def getData(remoteFallbackLayer: RemoteFallbackLayer,
              dataRequests: DataRequestCollection): Fox[(Array[Byte], List[Int])] = ???

  def getAgglomerateIdsForSegmentIds(remoteFallbackLayer: RemoteFallbackLayer,
                                     mappingName: String,
                                     segmentIdsOrdered: List[Long]): Fox[List[Long]] = ???

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

  private def remoteLayerUri(remoteLayer: RemoteFallbackLayer): String =
    s"$datastoreUrl/data/datasets/${remoteLayer.organizationName}/${remoteLayer.dataSetName}/layers/${remoteLayer.layerName}"
}
