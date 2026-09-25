package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.Msg
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.webknossos.datastore.services.*
import com.scalableminds.webknossos.datastore.services.mesh.{
  DSFullMeshService,
  FullMeshRequest,
  ListMeshChunksForSegmentsRequest,
  ListMeshChunksRequest,
  MeshChunkDataRequestList,
  MeshFileService,
  MeshMappingHelper
}
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}

import scala.concurrent.ExecutionContext

class DSMeshController @Inject() (
    accessTokenService: DataStoreAccessTokenService,
    meshFileService: MeshFileService,
    fullMeshService: DSFullMeshService,
    datasetCache: DatasetCache,
    val dsRemoteWebknossosClient: DSRemoteWebknossosClient,
    val dsRemoteTracingstoreClient: DSRemoteTracingstoreClient,
    val binaryDataServiceHolder: BinaryDataServiceHolder
)(implicit bodyParsers: PlayBodyParsers, ec: ExecutionContext)
    extends Controller
    with MeshMappingHelper {

  override def allowRemoteOrigin: Boolean = true

  def listMeshFiles(datasetId: ObjectId, dataLayerName: String): Action[AnyContent] =
    Action.fox { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          meshFileInfos <- meshFileService.listMeshFiles(dataSource.id, dataLayer)
        } yield Ok(Json.toJson(meshFileInfos))
      }
    }

  def listMeshChunksForSegment(
      datasetId: ObjectId,
      dataLayerName: String,
      /* If targetMappingName is set, assume that meshFile contains meshes for
                                            the oversegmentation. Collect mesh chunks of all *unmapped* segment ids
                                            belonging to the supplied agglomerate id.
                                            If it is not set, use meshFile as is, assume passed id is present in meshFile
                                   Note: in case of an editable mapping, targetMappingName is its baseMapping name.
       */
      targetMappingName: Option[String],
      editableMappingTracingId: Option[String]
  ): Action[ListMeshChunksRequest] =
    Action.fox(validateJson[ListMeshChunksRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          meshFileKey <- meshFileService.lookUpMeshFileKey(dataSource.id, dataLayer, request.body.meshFileName)
          mappingNameForMeshFile <- meshFileService.mappingNameForMeshFile(meshFileKey)
          segmentIds: Seq[Long] <- segmentIdsForAgglomerateIdIfNeeded(
            dataSource.id,
            dataLayer,
            targetMappingName,
            editableMappingTracingId,
            request.body.annotationVersion,
            request.body.segmentId.toLong,
            mappingNameForMeshFile,
            omitMissing = false
          )
          chunkInfos <- meshFileService.listMeshChunksForSegmentsMerged(meshFileKey, segmentIds)
        } yield Ok(Json.toJson(chunkInfos.withSegmentIdsWithoutMesh(segmentIds)))
      }
    }

  /* Lists the mesh chunks of several unmapped segment ids at once. Unlike listMeshChunksForSegment, segments
     without a mesh don't make the request fail. They are listed in segmentIdsWithoutMesh instead.
     Used by the frontend to complete an agglomerate's mesh from segments it hasn't loaded yet.
   */
  def listMeshChunksForSegments(datasetId: ObjectId, dataLayerName: String): Action[ListMeshChunksForSegmentsRequest] =
    Action.fox(validateJson[ListMeshChunksForSegmentsRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          meshFileKey <- meshFileService.lookUpMeshFileKey(dataSource.id, dataLayer, request.body.meshFileName)
          segmentIds = request.body.segmentIds.map(_.toLong)
          chunkInfos <- meshFileService.listMeshChunksForSegmentsMerged(
            meshFileKey,
            segmentIds,
            failOnZeroChunks = false
          )
        } yield Ok(Json.toJson(chunkInfos.withSegmentIdsWithoutMesh(segmentIds)))
      }
    }

  def readMeshChunk(datasetId: ObjectId, dataLayerName: String): Action[MeshChunkDataRequestList] =
    Action.fox(validateJson[MeshChunkDataRequestList]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          meshFileKey <- meshFileService.lookUpMeshFileKey(dataSource.id, dataLayer, request.body.meshFileName)
          (data, encoding) <- meshFileService.readMeshChunk(
            meshFileKey,
            request.body.requests
          ) ?~> Msg.Mesh.File.loadChunkFailed
        } yield
          if (encoding.contains("gzip")) {
            Ok(data).withHeaders("Content-Encoding" -> "gzip")
          } else Ok(data)
      }
    }

  def loadFullMeshStl(datasetId: ObjectId, dataLayerName: String): Action[FullMeshRequest] =
    Action.fox(validateJson[FullMeshRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          data: Array[Byte] <- fullMeshService.loadFor(
            datasetId,
            dataSource,
            dataLayer,
            request.body
          ) ?~> Msg.Mesh.File.loadChunkFailed

        } yield Ok(data)
      }
    }
}
