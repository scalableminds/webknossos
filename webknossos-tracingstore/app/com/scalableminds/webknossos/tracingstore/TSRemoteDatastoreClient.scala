package com.scalableminds.webknossos.tracingstore

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.AgglomerateGraph.AgglomerateGraph
import com.scalableminds.webknossos.datastore.ListOfLong.ListOfLong
import com.scalableminds.webknossos.datastore.geometry.Vec3IntProto
import com.scalableminds.webknossos.datastore.helpers.{
  GetMultipleSegmentIndexParameters,
  GetSegmentIndexParameters,
  MissingBucketHeaders,
  ProtoGeometryImplicits,
  SegmentIndexData
}
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.datastore.models.{VoxelSize, WebknossosDataRequest}
import com.scalableminds.webknossos.datastore.models.datasource.inbox.InboxDataSource
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.services.mesh.FullMeshRequest
import com.scalableminds.webknossos.tracingstore.tracings.RemoteFallbackLayer
import com.typesafe.scalalogging.LazyLogging
import play.api.http.Status
import play.api.inject.ApplicationLifecycle

import scala.concurrent.ExecutionContext
import scala.concurrent.duration.DurationInt

class TSRemoteDatastoreClient @Inject()(
    rpc: RPC,
    remoteWebknossosClient: TSRemoteWebknossosClient,
    val lifecycle: ApplicationLifecycle
)(implicit ec: ExecutionContext)
    extends LazyLogging
    with ProtoGeometryImplicits
    with MissingBucketHeaders {

  private lazy val dataStoreUriCache: AlfuCache[(String, String), String] = AlfuCache()
  private lazy val voxelSizeCache: AlfuCache[ObjectId, VoxelSize] = AlfuCache(timeToLive = 10 minutes)
  private lazy val largestAgglomerateIdCache: AlfuCache[(RemoteFallbackLayer, String, Option[String]), Long] =
    AlfuCache(timeToLive = 10 minutes)

  def getAgglomerateSkeleton(remoteFallbackLayer: RemoteFallbackLayer, mappingName: String, agglomerateId: Long)(
      implicit tc: TokenContext): Fox[Array[Byte]] =
    for {
      remoteLayerUri <- getRemoteLayerUri(remoteFallbackLayer)
      result <- rpc(s"$remoteLayerUri/agglomerates/$mappingName/skeleton/$agglomerateId").withTokenFromContext.getWithBytesResponse
    } yield result

  def getData(remoteFallbackLayer: RemoteFallbackLayer, dataRequests: Seq[WebknossosDataRequest])(
      implicit tc: TokenContext): Fox[(Array[Byte], List[Int])] =
    for {
      remoteLayerUri <- getRemoteLayerUri(remoteFallbackLayer)
      response <- rpc(s"$remoteLayerUri/data").withTokenFromContext.silent.postJson(dataRequests)
      _ <- Fox.fromBool(Status.isSuccessful(response.status))
      bytes = response.bodyAsBytes.toArray
      indices <- parseMissingBucketHeader(response.header(missingBucketsHeader)) ?~> "failed to parse missing bucket header"
    } yield (bytes, indices)

  def getVoxelAtPosition(remoteFallbackLayer: RemoteFallbackLayer, pos: Vec3Int, mag: Vec3Int)(
      implicit tc: TokenContext): Fox[Array[Byte]] =
    for {
      remoteLayerUri <- getRemoteLayerUri(remoteFallbackLayer)
      result <- rpc(s"$remoteLayerUri/data").withTokenFromContext
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
                                     segmentIdsOrdered: List[Long])(implicit tc: TokenContext): Fox[List[Long]] =
    for {
      remoteLayerUri <- getRemoteLayerUri(remoteFallbackLayer)
      segmentIdsOrderedProto = ListOfLong(items = segmentIdsOrdered)
      result <- rpc(s"$remoteLayerUri/agglomerates/$mappingName/agglomeratesForSegments").withTokenFromContext.silent
        .postProtoWithProtoResponse[ListOfLong, ListOfLong](segmentIdsOrderedProto)(ListOfLong)
    } yield result.items.toList

  def getAgglomerateGraph(remoteFallbackLayer: RemoteFallbackLayer, baseMappingName: String, agglomerateId: Long)(
      implicit tc: TokenContext): Fox[AgglomerateGraph] =
    for {
      remoteLayerUri <- getRemoteLayerUri(remoteFallbackLayer)
      result <- rpc(s"$remoteLayerUri/agglomerates/$baseMappingName/agglomerateGraph/$agglomerateId").silent.withTokenFromContext.silent
        .getWithProtoResponse[AgglomerateGraph](AgglomerateGraph)
    } yield result

  def getLargestAgglomerateId(remoteFallbackLayer: RemoteFallbackLayer, mappingName: String)(
      implicit tc: TokenContext): Fox[Long] = {
    val cacheKey = (remoteFallbackLayer, mappingName, tc.userTokenOpt)
    largestAgglomerateIdCache.getOrLoad(
      cacheKey,
      k =>
        for {
          remoteLayerUri <- getRemoteLayerUri(k._1)
          result <- rpc(s"$remoteLayerUri/agglomerates/${k._2}/largestAgglomerateId")
            .addQueryStringOptional("token", k._3)
            .silent
            .getWithJsonResponse[Long]
        } yield result
    )
  }

  def hasSegmentIndexFile(remoteFallbackLayer: RemoteFallbackLayer)(implicit tc: TokenContext): Fox[Boolean] =
    for {
      remoteLayerUri <- getRemoteLayerUri(remoteFallbackLayer)
      hasIndexFile <- rpc(s"$remoteLayerUri/hasSegmentIndex").withTokenFromContext.silent.getWithJsonResponse[Boolean]
    } yield hasIndexFile

  def querySegmentIndexForMultipleSegments(
      remoteFallbackLayer: RemoteFallbackLayer,
      segmentIds: Seq[Long],
      mag: Vec3Int,
      mappingName: Option[String], // should be the baseMappingName in case of editable mappings
      editableMappingTracingId: Option[String])(implicit tc: TokenContext): Fox[Seq[(Long, Set[Vec3IntProto])]] =
    for {
      remoteLayerUri <- getRemoteLayerUri(remoteFallbackLayer)
      result <- rpc(s"$remoteLayerUri/segmentIndex").withTokenFromContext.silent
        .postJsonWithJsonResponse[GetMultipleSegmentIndexParameters, Seq[SegmentIndexData]](
          GetMultipleSegmentIndexParameters(segmentIds.toList,
                                            mag,
                                            additionalCoordinates = None,
                                            mappingName = mappingName,
                                            editableMappingTracingId = editableMappingTracingId))

    } yield result.map(data => (data.segmentId, data.positions.toSet.map(vec3IntToProto)))

  def loadFullMeshStl(remoteFallbackLayer: RemoteFallbackLayer, fullMeshRequest: FullMeshRequest)(
      implicit tc: TokenContext): Fox[Array[Byte]] =
    for {
      remoteLayerUri <- getRemoteLayerUri(remoteFallbackLayer)
      result <- rpc(s"$remoteLayerUri/meshes/fullMesh.stl").withTokenFromContext
        .postJsonWithBytesResponse(fullMeshRequest)
    } yield result

  def voxelSizeForAnnotationWithCache(annotationId: ObjectId)(implicit tc: TokenContext): Fox[VoxelSize] =
    voxelSizeCache.getOrLoad(annotationId, aId => voxelSizeForAnnotation(aId))

  private def voxelSizeForAnnotation(annotationId: ObjectId)(implicit tc: TokenContext): Fox[VoxelSize] =
    for {
      dataSourceId <- remoteWebknossosClient.getDataSourceIdForAnnotation(annotationId)
      dataStoreUri <- dataStoreUriWithCache(dataSourceId.organizationId, dataSourceId.directoryName)
      result <- rpc(
        s"$dataStoreUri/data/datasets/${dataSourceId.organizationId}/${dataSourceId.directoryName}/readInboxDataSource").withTokenFromContext
        .getWithJsonResponse[InboxDataSource]
      scale <- result.voxelSizeOpt.toFox ?~> "could not determine voxel size of dataset"
    } yield scale

  private def getRemoteLayerUri(remoteLayer: RemoteFallbackLayer): Fox[String] =
    for {
      datastoreUri <- dataStoreUriWithCache(remoteLayer.organizationId, remoteLayer.datasetDirectoryName)
    } yield
      s"$datastoreUri/data/datasets/${remoteLayer.organizationId}/${remoteLayer.datasetDirectoryName}/layers/${remoteLayer.layerName}"

  private def dataStoreUriWithCache(organizationId: String, datasetDirectoryName: String): Fox[String] =
    dataStoreUriCache.getOrLoad(
      (organizationId, datasetDirectoryName),
      keyTuple => remoteWebknossosClient.getDataStoreUriForDataSource(keyTuple._1, keyTuple._2))

}
