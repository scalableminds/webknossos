package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.services._
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}

import scala.concurrent.ExecutionContext

class DSMeshController @Inject()(
    accessTokenService: DataStoreAccessTokenService,
    meshFileService: MeshFileService,
    fullMeshService: DSFullMeshService,
    val dsRemoteWebknossosClient: DSRemoteWebknossosClient,
    val dsRemoteTracingstoreClient: DSRemoteTracingstoreClient,
    val binaryDataServiceHolder: BinaryDataServiceHolder
)(implicit bodyParsers: PlayBodyParsers, ec: ExecutionContext)
    extends Controller
    with MeshMappingHelper
    with FoxImplicits {

  override def allowRemoteOrigin: Boolean = true

  def listMeshFiles(token: Option[String],
                    organizationId: String,
                    datasetDirectoryName: String,
                    dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(
        UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId)),
        urlOrHeaderToken(token, request)) {
        for {
          meshFiles <- meshFileService.exploreMeshFiles(organizationId, datasetDirectoryName, dataLayerName)
        } yield Ok(Json.toJson(meshFiles))
      }
    }

  def listMeshChunksForSegment(token: Option[String],
                               organizationId: String,
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
      accessTokenService.validateAccess(
        UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId)),
        urlOrHeaderToken(token, request)) {
        for {
          _ <- Fox.successful(())
          mappingNameForMeshFile = meshFileService.mappingNameForMeshFile(organizationId,
                                                                          datasetDirectoryName,
                                                                          dataLayerName,
                                                                          request.body.meshFile)
          segmentIds: List[Long] <- segmentIdsForAgglomerateIdIfNeeded(
            organizationId,
            datasetDirectoryName,
            dataLayerName,
            targetMappingName,
            editableMappingTracingId,
            request.body.segmentId,
            mappingNameForMeshFile,
            omitMissing = false,
            urlOrHeaderToken(token, request)
          )
          chunkInfos <- meshFileService.listMeshChunksForSegmentsMerged(organizationId,
                                                                        datasetDirectoryName,
                                                                        dataLayerName,
                                                                        request.body.meshFile,
                                                                        segmentIds)
        } yield Ok(Json.toJson(chunkInfos))
      }
    }

  def readMeshChunk(token: Option[String],
                    organizationId: String,
                    datasetDirectoryName: String,
                    dataLayerName: String): Action[MeshChunkDataRequestList] =
    Action.async(validateJson[MeshChunkDataRequestList]) { implicit request =>
      accessTokenService.validateAccess(
        UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId)),
        urlOrHeaderToken(token, request)) {
        for {
          (data, encoding) <- meshFileService.readMeshChunk(organizationId,
                                                            datasetDirectoryName,
                                                            dataLayerName,
                                                            request.body) ?~> "mesh.file.loadChunk.failed"
        } yield {
          if (encoding.contains("gzip")) {
            Ok(data).withHeaders("Content-Encoding" -> "gzip")
          } else Ok(data)
        }
      }
    }

  def loadFullMeshStl(token: Option[String],
                      organizationId: String,
                      datasetDirectoryName: String,
                      dataLayerName: String): Action[FullMeshRequest] =
    Action.async(validateJson[FullMeshRequest]) { implicit request =>
      accessTokenService.validateAccess(
        UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId)),
        urlOrHeaderToken(token, request)) {
        for {
          data: Array[Byte] <- fullMeshService.loadFor(token: Option[String],
                                                       organizationId,
                                                       datasetDirectoryName,
                                                       dataLayerName,
                                                       request.body) ?~> "mesh.file.loadChunk.failed"

        } yield Ok(data)
      }
    }
}
