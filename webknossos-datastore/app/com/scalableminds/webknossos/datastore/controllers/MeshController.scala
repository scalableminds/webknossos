package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.services._
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}

import scala.concurrent.ExecutionContext.Implicits.global

class MeshController @Inject()(
    accessTokenService: DataStoreAccessTokenService,
    meshFileService: MeshFileService,
)(implicit bodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  override def allowRemoteOrigin: Boolean = true

  def listMeshFiles(token: Option[String],
                    organizationName: String,
                    dataSetName: String,
                    dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          meshFiles <- meshFileService.exploreMeshFiles(organizationName, dataSetName, dataLayerName)
        } yield Ok(Json.toJson(meshFiles))
      }
    }

  def listMeshChunksForSegmentV0(token: Option[String],
                                 organizationName: String,
                                 dataSetName: String,
                                 dataLayerName: String): Action[ListMeshChunksRequest] =
    Action.async(validateJson[ListMeshChunksRequest]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          positions <- meshFileService.listMeshChunksForSegmentV0(organizationName,
                                                                  dataSetName,
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
                                         dataSetName: String,
                                         dataLayerName: String,
                                         formatVersion: Int): Action[ListMeshChunksRequest] =
    Action.async(validateJson[ListMeshChunksRequest]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          positions <- formatVersion match {
            case 3 =>
<<<<<<< HEAD
              meshFileService.listMeshChunksForSegmentV3(organizationName, dataSetName, dataLayerName, request.body) ?~> Messages(
                "mesh.file.listChunks.failed",
                request.body.segmentId.toString,
                request.body.meshFile) ?~> Messages("mesh.file.load.failed", request.body.segmentId.toString) ~> BAD_REQUEST
||||||| parent of 734c590d9... add route for mapped segment
              mappingName match {
                case Some(mapping) =>
                  for {
                    agglomerateService <- binaryDataServiceHolder.binaryDataService.agglomerateServiceOpt.toFox
                    agglomerateIds: List[Long] <- agglomerateService
                      .agglomerateIdsForSegmentIds(
                        AgglomerateFileKey(
                          organizationName,
                          dataSetName,
                          dataLayerName,
                          mapping
                        ),
                        List(request.body.segmentId)
                      )
                      .toFox

                    unmappedChunks <- Fox.serialCombined(agglomerateIds)(segmentId =>
                      meshFileService.listMeshChunksForSegmentV3(organizationName,
                                                                 dataSetName,
                                                                 dataLayerName,
                                                                 ListMeshChunksRequest(request.body.meshFile,
                                                                                       segmentId)) ?~> Messages(
                        "mesh.file.listChunks.failed",
                        request.body.segmentId.toString,
                        request.body.meshFile) ?~> Messages("mesh.file.load.failed", request.body.segmentId.toString) ~> BAD_REQUEST)

                  } yield unmappedChunks
                case None =>
                  meshFileService.listMeshChunksForSegmentV3(organizationName, dataSetName, dataLayerName, request.body) ?~> Messages(
                    "mesh.file.listChunks.failed",
                    request.body.segmentId.toString,
                    request.body.meshFile) ?~> Messages("mesh.file.load.failed", request.body.segmentId.toString) ~> BAD_REQUEST
              }
=======
              mappingName match {
                case Some(mapping) =>
                  for {
                    agglomerateService <- binaryDataServiceHolder.binaryDataService.agglomerateServiceOpt.toFox
                    agglomerateIds: List[Long] <- agglomerateService
                      .agglomerateIdsForSegmentIds(
                        AgglomerateFileKey(
                          organizationName,
                          dataSetName,
                          dataLayerName,
                          mapping
                        ),
                        List(request.body.segmentId)
                      )
                      .toFox

                    unmappedChunks <- Fox.serialCombined(agglomerateIds)(segmentId =>
                      meshFileService.listMeshChunksForSegmentV3(organizationName,
                                                                 dataSetName,
                                                                 dataLayerName,
                                                                 ListMeshChunksRequest(request.body.meshFile,
                                                                                       segmentId)) ?~> Messages(
                        "mesh.file.listChunks.failed",
                        request.body.segmentId.toString,
                        request.body.meshFile) ?~> Messages("mesh.file.load.failed", request.body.segmentId.toString) ~> BAD_REQUEST)
                    chunkInfo = unmappedChunks.reduce(_.merge(_))
                  } yield chunkInfo
                case None =>
                  meshFileService.listMeshChunksForSegmentV3(organizationName, dataSetName, dataLayerName, request.body) ?~> Messages(
                    "mesh.file.listChunks.failed",
                    request.body.segmentId.toString,
                    request.body.meshFile) ?~> Messages("mesh.file.load.failed", request.body.segmentId.toString) ~> BAD_REQUEST
              }
>>>>>>> 734c590d9... add route for mapped segment
            case _ => Fox.failure("Wrong format version") ~> BAD_REQUEST
          }
        } yield Ok(Json.toJson(positions))
      }
    }

  def readMeshChunkV0(token: Option[String],
                      organizationName: String,
                      dataSetName: String,
                      dataLayerName: String): Action[MeshChunkDataRequestV0] =
    Action.async(validateJson[MeshChunkDataRequestV0]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          (data, encoding) <- meshFileService.readMeshChunkV0(organizationName,
                                                              dataSetName,
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
                              dataSetName: String,
                              dataLayerName: String,
                              formatVersion: Int): Action[MeshChunkDataRequestV3] =
    Action.async(validateJson[MeshChunkDataRequestV3]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          (data, encoding) <- formatVersion match {
            case 3 =>
              meshFileService.readMeshChunkV3(organizationName, dataSetName, dataLayerName, request.body) ?~> "mesh.file.loadChunk.failed"
            case _ => Fox.failure("Wrong format version") ~> BAD_REQUEST
          }
        } yield {
          if (encoding.contains("gzip")) {
            Ok(data).withHeaders("Content-Encoding" -> "gzip")
          } else Ok(data)
        }
      }
    }
}
