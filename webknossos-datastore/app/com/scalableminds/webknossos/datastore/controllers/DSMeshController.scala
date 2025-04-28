package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.services._
import com.scalableminds.webknossos.datastore.services.mesh.{
  DSFullMeshService,
  FullMeshRequest,
  ListMeshChunksRequest,
  MeshChunkDataRequestList,
  MeshFileService,
  MeshMappingHelper,
  NeuroglancerMesh,
  NeuroglancerPrecomputedMeshService
}
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}

import scala.concurrent.ExecutionContext

class DSMeshController @Inject()(
    accessTokenService: DataStoreAccessTokenService,
    meshFileService: MeshFileService,
    neuroglancerPrecomputedMeshService: NeuroglancerPrecomputedMeshService,
    fullMeshService: DSFullMeshService,
    val dsRemoteWebknossosClient: DSRemoteWebknossosClient,
    val dsRemoteTracingstoreClient: DSRemoteTracingstoreClient,
    val binaryDataServiceHolder: BinaryDataServiceHolder
)(implicit bodyParsers: PlayBodyParsers, ec: ExecutionContext)
    extends Controller
    with MeshMappingHelper {

  override def allowRemoteOrigin: Boolean = true

  def listMeshFiles(organizationId: String, datasetDirectoryName: String, dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
        for {
          meshFiles <- meshFileService.exploreMeshFiles(organizationId, datasetDirectoryName, dataLayerName)
          neuroglancerMeshFiles <- neuroglancerPrecomputedMeshService.exploreMeshes(organizationId,
                                                                                    datasetDirectoryName,
                                                                                    dataLayerName)
          allMeshFiles = meshFiles ++ neuroglancerMeshFiles
        } yield Ok(Json.toJson(allMeshFiles))
      }
    }

  def listMeshChunksForSegment(organizationId: String,
                               datasetDirectoryName: String,
                               dataLayerName: String,
                               /* If targetMappingName is set, assume that meshfile contains meshes for
                                            the oversegmentation. Collect mesh chunks of all *unmapped* segment ids
                                            belonging to the supplied agglomerate id.
                                            If it is not set, use meshfile as is, assume passed id is present in meshfile
                                   Note: in case of an editable mapping, targetMappingName is its baseMapping name.
                                */
                               targetMappingName: Option[String],
                               editableMappingTracingId: Option[String]): Action[ListMeshChunksRequest] =
    Action.async(validateJson[ListMeshChunksRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
        for {
          _ <- Fox.successful(())
          mappingNameForMeshFile = meshFileService.mappingNameForMeshFile(organizationId,
                                                                          datasetDirectoryName,
                                                                          dataLayerName,
                                                                          request.body.meshFile.name)
          segmentIds: List[Long] <- segmentIdsForAgglomerateIdIfNeeded(
            organizationId,
            datasetDirectoryName,
            dataLayerName,
            targetMappingName,
            editableMappingTracingId,
            request.body.segmentId,
            mappingNameForMeshFile,
            omitMissing = false
          )
          chunkInfos <- request.body.meshFile.fileType match {
            case Some(NeuroglancerMesh.meshTypeName) =>
              neuroglancerPrecomputedMeshService.listMeshChunksForMultipleSegments(request.body.meshFile.path,
                                                                                   segmentIds)
            case _ =>
              meshFileService.listMeshChunksForSegmentsMerged(organizationId,
                                                              datasetDirectoryName,
                                                              dataLayerName,
                                                              request.body.meshFile.name,
                                                              segmentIds)
          }
        } yield Ok(Json.toJson(chunkInfos))
      }
    }

  def readMeshChunk(organizationId: String,
                    datasetDirectoryName: String,
                    dataLayerName: String): Action[MeshChunkDataRequestList] =
    Action.async(validateJson[MeshChunkDataRequestList]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
        for {
          (data, encoding) <- request.body.meshFile.fileType match {
            case Some(NeuroglancerMesh.meshTypeName) =>
              neuroglancerPrecomputedMeshService.readMeshChunk(request.body.meshFile.path, request.body.requests)
            case _ =>
              meshFileService
                .readMeshChunk(organizationId, datasetDirectoryName, dataLayerName, request.body)
                .toFox ?~> "mesh.file.loadChunk.failed"
          }
        } yield {
          if (encoding.contains("gzip")) {
            Ok(data).withHeaders("Content-Encoding" -> "gzip")
          } else Ok(data)
        }
      }
    }

  def loadFullMeshStl(organizationId: String,
                      datasetDirectoryName: String,
                      dataLayerName: String): Action[FullMeshRequest] =
    Action.async(validateJson[FullMeshRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
        for {
          data: Array[Byte] <- fullMeshService.loadFor(organizationId,
                                                       datasetDirectoryName,
                                                       dataLayerName,
                                                       request.body) ?~> "mesh.file.loadChunk.failed"

        } yield Ok(data)
      }
    }
}
