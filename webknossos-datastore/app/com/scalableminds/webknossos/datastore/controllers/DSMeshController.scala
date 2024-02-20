package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.services._
import com.scalableminds.webknossos.datastore.storage.AgglomerateFileKey
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}

import scala.concurrent.ExecutionContext

class DSMeshController @Inject()(
    accessTokenService: DataStoreAccessTokenService,
    meshFileService: MeshFileService,
    fullMeshService: FullMeshService,
    dsRemoteWebKnossosClient: DSRemoteWebKnossosClient,
    dsRemoteTracingstoreClient: DSRemoteTracingstoreClient,
    binaryDataServiceHolder: BinaryDataServiceHolder
)(implicit bodyParsers: PlayBodyParsers, ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  override def allowRemoteOrigin: Boolean = true

  def testAdHocStl: Action[AnyContent] = Action.async { implicit request =>
    val organizationName = "sample_organization"
    val datasetName = "l4_sample_zarr3_sharded"
    val layerName = "segmentation"
    val segmentId = 1997
    val seedPosition = Vec3Int(3455, 3455, 1023)

    val stlRequest = FullMeshRequest(
      None,
      None,
      segmentId,
      None,
      None,
      None,
      Some(Vec3Int(4, 4, 1)),
      Some(seedPosition),
      None
    )
    for {
      data: Array[Byte] <- fullMeshService
        .loadFor(None, organizationName, datasetName, layerName, stlRequest) ?~> "mesh.file.loadChunk.failed"
    } yield Ok(data)
  }

  def testStl: Action[AnyContent] = Action.async { implicit request =>
    val organizationName = "sample_organization"
    val datasetName = "l4dense_mesh_test"
    val layerName = "segmentation"
    val meshfileName = "meshfile_4-4-2"

    val stlRequest = FullMeshRequest(
      Some(meshfileName),
      None,
      55834,
      None,
      None,
      None,
      None,
      None,
      None
    )
    for {
      data: Array[Byte] <- fullMeshService
        .loadFor(None, organizationName, datasetName, layerName, stlRequest) ?~> "mesh.file.loadChunk.failed"
    } yield Ok(data)
  }

  def listMeshFiles(token: Option[String],
                    organizationName: String,
                    datasetName: String,
                    dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          meshFiles <- meshFileService.exploreMeshFiles(organizationName, datasetName, dataLayerName)
        } yield Ok(Json.toJson(meshFiles))
      }
    }

  def listMeshChunksForSegmentV0(token: Option[String],
                                 organizationName: String,
                                 datasetName: String,
                                 dataLayerName: String): Action[ListMeshChunksRequest] =
    Action.async(validateJson[ListMeshChunksRequest]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          positions <- meshFileService.listMeshChunksForSegmentV0(organizationName,
                                                                  datasetName,
                                                                  dataLayerName,
                                                                  request.body) ?~> Messages(
            "mesh.file.listChunks.failed",
            request.body.segmentId.toString,
            request.body.meshFile) ?~> Messages("mesh.file.load.failed", request.body.segmentId.toString) ~> BAD_REQUEST
        } yield Ok(Json.toJson(positions))
      }
    }

  def listMeshChunksForSegmentForVersion(token: Option[String],
                                         organizationName: String,
                                         datasetName: String,
                                         dataLayerName: String,
                                         formatVersion: Int,
                                         /* If targetMappingName is set, assume that meshfile contains meshes for
                                           the oversegmentation. Collect mesh chunks of all *unmapped* segment ids
                                           belonging to the supplied agglomerate id.
                                           If it is not set, use meshfile as is, assume passed id is present in meshfile
                                          */
                                         targetMappingName: Option[String],
                                         editableMappingTracingId: Option[String]): Action[ListMeshChunksRequest] =
    Action.async(validateJson[ListMeshChunksRequest]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          positions <- formatVersion match {
            case 3 =>
              targetMappingName match {
                case None =>
                  meshFileService.listMeshChunksForSegmentV3(organizationName, datasetName, dataLayerName, request.body) ?~> Messages(
                    "mesh.file.listChunks.failed",
                    request.body.segmentId.toString,
                    request.body.meshFile) ?~> Messages("mesh.file.load.failed", request.body.segmentId.toString) ~> BAD_REQUEST
                case Some(mapping) =>
                  for {
                    segmentIds: List[Long] <- segmentIdsForAgglomerateId(organizationName,
                                                                         datasetName,
                                                                         dataLayerName,
                                                                         mapping,
                                                                         editableMappingTracingId,
                                                                         request.body.segmentId,
                                                                         urlOrHeaderToken(token, request))
                    meshChunksForUnmappedSegments = segmentIds.map(
                      segmentId =>
                        meshFileService
                          .listMeshChunksForSegmentV3(organizationName,
                                                      datasetName,
                                                      dataLayerName,
                                                      ListMeshChunksRequest(request.body.meshFile, segmentId))
                          .toOption)
                    meshChunksForUnmappedSegmentsFlat = meshChunksForUnmappedSegments.flatten
                    _ <- bool2Fox(meshChunksForUnmappedSegmentsFlat.nonEmpty) ?~> "zero chunks" ?~> "mesh.file.listChunks.failed"
                    chunkInfos = meshChunksForUnmappedSegmentsFlat.reduce(_.merge(_))
                  } yield chunkInfos
              }
            case _ => Fox.failure("Wrong format version") ~> BAD_REQUEST
          }
        } yield Ok(Json.toJson(positions))
      }
    }

  private def segmentIdsForAgglomerateId(organizationName: String,
                                         datasetName: String,
                                         dataLayerName: String,
                                         mappingName: String,
                                         editableMappingTracingId: Option[String],
                                         agglomerateId: Long,
                                         token: Option[String]): Fox[List[Long]] = {
    val agglomerateFileKey = AgglomerateFileKey(
      organizationName,
      datasetName,
      dataLayerName,
      mappingName
    )
    editableMappingTracingId match {
      case Some(tracingId) =>
        for {
          tracingstoreUri <- dsRemoteWebKnossosClient.getTracingstoreUri
          segmentIdsResult <- dsRemoteTracingstoreClient.getEditableMappingSegmentIdsForAgglomerate(tracingstoreUri,
                                                                                                    tracingId,
                                                                                                    agglomerateId,
                                                                                                    token)
          segmentIds <- if (segmentIdsResult.agglomerateIdIsPresent)
            Fox.successful(segmentIdsResult.segmentIds)
          else
            for {
              agglomerateService <- binaryDataServiceHolder.binaryDataService.agglomerateServiceOpt.toFox
              localSegmentIds <- agglomerateService.segmentIdsForAgglomerateId(
                agglomerateFileKey,
                agglomerateId
              )
            } yield localSegmentIds
        } yield segmentIds
      case _ =>
        for {
          agglomerateService <- binaryDataServiceHolder.binaryDataService.agglomerateServiceOpt.toFox
          segmentIds <- agglomerateService.segmentIdsForAgglomerateId(
            agglomerateFileKey,
            agglomerateId
          )
        } yield segmentIds
    }
  }

  def readMeshChunkV0(token: Option[String],
                      organizationName: String,
                      datasetName: String,
                      dataLayerName: String): Action[MeshChunkDataRequestV0] =
    Action.async(validateJson[MeshChunkDataRequestV0]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          (data, encoding) <- meshFileService.readMeshChunkV0(organizationName,
                                                              datasetName,
                                                              dataLayerName,
                                                              request.body) ?~> "mesh.file.loadChunk.failed"
        } yield {
          if (encoding.contains("gzip")) {
            Ok(data).withHeaders("Content-Encoding" -> "gzip")
          } else Ok(data)
        }
      }
    }

  def readMeshChunkForVersion(token: Option[String],
                              organizationName: String,
                              datasetName: String,
                              dataLayerName: String,
                              formatVersion: Int): Action[MeshChunkDataRequestV3List] =
    Action.async(validateJson[MeshChunkDataRequestV3List]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          (data, encoding) <- formatVersion match {
            case 3 =>
              meshFileService.readMeshChunkV3(organizationName, datasetName, dataLayerName, request.body) ?~> "mesh.file.loadChunk.failed"
            case _ => Fox.failure("Wrong format version") ~> BAD_REQUEST
          }
        } yield {
          if (encoding.contains("gzip")) {
            Ok(data).withHeaders("Content-Encoding" -> "gzip")
          } else Ok(data)
        }
      }
    }

  def loadFullMeshStl(token: Option[String],
                      organizationName: String,
                      datasetName: String,
                      dataLayerName: String): Action[FullMeshRequest] =
    Action.async(validateJson[FullMeshRequest]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          data: Array[Byte] <- fullMeshService.loadFor(token: Option[String],
                                                       organizationName,
                                                       datasetName,
                                                       dataLayerName,
                                                       request.body) ?~> "mesh.file.loadChunk.failed"

        } yield Ok(data)
      }
    }
}
