package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.inbox.{
  InboxDataSource,
  InboxDataSourceLike,
  UnusableInboxDataSource
}
import com.scalableminds.webknossos.datastore.models.datasource.{DataSource, DataSourceId}
import com.scalableminds.webknossos.datastore.services._
import play.api.data.Form
import play.api.data.Forms.{longNumber, nonEmptyText, number, tuple}
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, MultipartFormData, PlayBodyParsers}
import java.io.File

import play.api.libs.Files

import scala.concurrent.ExecutionContext.Implicits.global

class DataSourceController @Inject()(
    dataSourceRepository: DataSourceRepository,
    dataSourceService: DataSourceService,
    webKnossosServer: DataStoreWkRpcClient,
    accessTokenService: DataStoreAccessTokenService,
    sampleDatasetService: SampleDataSourceService,
    binaryDataServiceHolder: BinaryDataServiceHolder,
    meshFileService: MeshFileService,
    uploadService: UploadService
)(implicit bodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  def list(): Action[AnyContent] = Action.async { implicit request =>
    {
      accessTokenService.validateAccessForSyncBlock(UserAccessRequest.listDataSources) {
        AllowRemoteOrigin {
          val ds = dataSourceRepository.findAll
          Ok(Json.toJson(ds))
        }
      }
    }
  }

  def read(organizationName: String, dataSetName: String, returnFormatLike: Boolean): Action[AnyContent] =
    Action.async { implicit request =>
      {
        accessTokenService.validateAccessForSyncBlock(
          UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName))) {
          AllowRemoteOrigin {
            val dsOption: Option[InboxDataSource] =
              dataSourceRepository.find(DataSourceId(dataSetName, organizationName))
            dsOption match {
              case Some(ds) =>
                val dslike: InboxDataSourceLike = ds
                if (returnFormatLike) Ok(Json.toJson(dslike))
                else Ok(Json.toJson(ds))
              case _ => Ok
            }
          }
        }
      }
    }

  def triggerInboxCheck(): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessForSyncBlock(UserAccessRequest.administrateDataSources) {
      AllowRemoteOrigin {
        dataSourceService.checkInbox(verbose = true)
        Ok
      }
    }
  }

  def triggerInboxCheckBlocking(): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.administrateDataSources) {
      AllowRemoteOrigin {
        for {
          _ <- dataSourceService.checkInbox(verbose = true)
        } yield Ok
      }
    }
  }

  def uploadChunk: Action[MultipartFormData[Files.TemporaryFile]] = Action.async(parse.multipartFormData) {
    implicit request =>
      val uploadForm = Form(
        tuple(
          "name" -> nonEmptyText.verifying("dataSet.name.invalid", n => n.matches("[A-Za-z0-9_\\-]*")),
          "owningOrganization" -> nonEmptyText,
          "resumableChunkNumber" -> number,
          "resumableChunkSize" -> number,
          "resumableTotalChunks" -> longNumber,
          "totalFileCount" -> number,
          "resumableIdentifier" -> nonEmptyText
        )).fill(("", "", -1, -1, -1, -1, ""))

      accessTokenService.validateAccess(UserAccessRequest.administrateDataSources) {
        AllowRemoteOrigin {
          uploadForm
            .bindFromRequest(request.body.dataParts)
            .fold(
              hasErrors = formWithErrors => Fox.successful(JsonBadRequest(formWithErrors.errors.head.message)),
              success = {
                case (name, organization, chunkNumber, chunkSize, totalChunkCount, totalFileCount, uploadId) =>
                  val id = DataSourceId(name, organization)
                  val resumableUploadInformation = ResumableUploadInformation(chunkSize, totalChunkCount)
                  for {
                    _ <- if (!uploadService.isKnownUpload(uploadId))
                      webKnossosServer.validateDataSourceUpload(id) ?~> "dataSet.upload.validation.failed"
                    else Fox.successful(())
                    chunkFile <- request.body.file("file") ?~> "zip.file.notFound"
                    _ <- uploadService.handleUploadChunk(uploadId,
                                                         id,
                                                         resumableUploadInformation,
                                                         chunkNumber,
                                                         totalFileCount,
                                                         new File(chunkFile.ref.path.toString))
                  } yield {
                    Ok
                  }
              }
            )
        }
      }
  }

  def finishUpload: Action[UploadInformation] = Action.async(validateJson[UploadInformation]) { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.administrateDataSources) {
      AllowRemoteOrigin {
        for {
          (dataSourceId, initialTeams, dataSetSizeBytes) <- uploadService.finishUpload(request.body)
          userTokenOpt = accessTokenService.tokenFromRequest(request)
          _ <- webKnossosServer
            .reportUpload(dataSourceId, initialTeams, dataSetSizeBytes, userTokenOpt) ?~> "setInitialTeams.failed"
        } yield Ok
      }
    }

  }

  def fetchSampleDataSource(organizationName: String, dataSetName: String): Action[AnyContent] = Action.async {
    implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.administrateDataSources) {
        AllowRemoteOrigin {
          for {
            _ <- sampleDatasetService.initDownload(organizationName, dataSetName)
          } yield JsonOk(Json.obj("messages" -> "downloadInitiated"))
        }
      }
  }

  def listSampleDataSources(organizationName: String): Action[AnyContent] = Action.async { implicit request =>
    AllowRemoteOrigin {
      accessTokenService.validateAccessForSyncBlock(UserAccessRequest.administrateDataSources) {
        Ok(Json.toJson(sampleDatasetService.listWithStatus(organizationName)))
      }
    }
  }

  def explore(organizationName: String, dataSetName: String): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessForSyncBlock(
      UserAccessRequest.writeDataSource(DataSourceId(dataSetName, organizationName))) {
      AllowRemoteOrigin {
        for {
          previousDataSource <- dataSourceRepository.find(DataSourceId(dataSetName, organizationName)) ?~ Messages(
            "dataSource.notFound") ~> 404
          (dataSource, messages) <- dataSourceService.exploreDataSource(previousDataSource.id,
                                                                        previousDataSource.toUsable)
          previousDataSourceJson = previousDataSource match {
            case usableDataSource: DataSource => Json.toJson(usableDataSource)
            case unusableDataSource: UnusableInboxDataSource =>
              unusableDataSource.existingDataSourceProperties match {
                case Some(existingConfig) => existingConfig
                case None                 => Json.toJson(unusableDataSource)
              }
          }
        } yield {
          Ok(
            Json.obj(
              "dataSource" -> dataSource,
              "previousDataSource" -> previousDataSourceJson,
              "messages" -> messages.map(m => Json.obj(m._1 -> m._2))
            ))
        }
      }
    }
  }

  def listMappings(
      organizationName: String,
      dataSetName: String,
      dataLayerName: String
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessForSyncBlock(
      UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName))) {
      AllowRemoteOrigin {
        Ok(Json.toJson(dataSourceService.exploreMappings(organizationName, dataSetName, dataLayerName)))
      }
    }
  }

  def listAgglomerates(
      organizationName: String,
      dataSetName: String,
      dataLayerName: String
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessForSyncBlock(
      UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName))) {
      AllowRemoteOrigin {
        Ok(
          Json.toJson(binaryDataServiceHolder.binaryDataService.agglomerateService
            .exploreAgglomerates(organizationName, dataSetName, dataLayerName)))
      }
    }
  }

  def generateAgglomerateSkeleton(
      organizationName: String,
      dataSetName: String,
      dataLayerName: String,
      mappingName: String,
      agglomerateId: Long
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName))) {
      AllowRemoteOrigin {
        for {
          skeleton <- binaryDataServiceHolder.binaryDataService.agglomerateService.generateSkeleton(
            organizationName,
            dataSetName,
            dataLayerName,
            mappingName,
            agglomerateId) ?~> "agglomerateSkeleton.failed"
        } yield Ok(skeleton.toByteArray).as("application/x-protobuf")
      }
    }
  }

  def listMeshFiles(organizationName: String, dataSetName: String, dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessForSyncBlock(
        UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName))) {
        AllowRemoteOrigin {
          Ok(Json.toJson(meshFileService.exploreMeshFiles(organizationName, dataSetName, dataLayerName)))
        }
      }
    }

  def listMeshChunksForSegment(organizationName: String,
                               dataSetName: String,
                               dataLayerName: String): Action[ListMeshChunksRequest] =
    Action.async(validateJson[ListMeshChunksRequest]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName))) {
        AllowRemoteOrigin {
          for {
            positions <- meshFileService.listMeshChunksForSegment(organizationName,
                                                                  dataSetName,
                                                                  dataLayerName,
                                                                  request.body) ?~> "mesh.listChunks.failed"
          } yield Ok(Json.toJson(positions))
        }
      }
    }

  def readMeshChunk(organizationName: String,
                    dataSetName: String,
                    dataLayerName: String): Action[MeshChunkDataRequest] =
    Action.async(validateJson[MeshChunkDataRequest]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName))) {
        AllowRemoteOrigin {
          for {
            (data, encoding) <- meshFileService.readMeshChunk(organizationName,
                                                              dataSetName,
                                                              dataLayerName,
                                                              request.body) ?~> "mesh.file.loadChunk.failed"
          } yield {
            if (encoding.contains("gzip")) {
              Ok(data).withHeaders("Content-Encoding" -> "gzip")
            } else {
              Ok(data)
            }
          }
        }
      }
    }

  def update(organizationName: String, dataSetName: String): Action[DataSource] =
    Action.async(validateJson[DataSource]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.writeDataSource(DataSourceId(dataSetName, organizationName))) {
        AllowRemoteOrigin {
          for {
            _ <- Fox.successful(())
            dataSource <- dataSourceRepository.find(DataSourceId(dataSetName, organizationName)).toFox ?~> Messages(
              "dataSource.notFound") ~> 404
            _ <- dataSourceService.updateDataSource(request.body.copy(id = dataSource.id))
          } yield {
            Ok
          }
        }
      }
    }

  def createOrganizationDirectory(organizationName: String): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessForSyncBlock(UserAccessRequest.administrateDataSources) {
      AllowRemoteOrigin {
        val newOrganizationFolder = new File(dataSourceService.dataBaseDir + "/" + organizationName)
        newOrganizationFolder.mkdirs()
        if (newOrganizationFolder.isDirectory)
          Ok
        else
          BadRequest
      }
    }
  }

  def reload(organizationName: String, dataSetName: String, layerName: Option[String] = None): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.administrateDataSources) {
        AllowRemoteOrigin {
          val count = binaryDataServiceHolder.binaryDataService.clearCache(organizationName, dataSetName, layerName)
          logger.info(
            s"Reloading ${layerName.map(l => s"layer '$l' of ").getOrElse("")}datasource $organizationName / $dataSetName: closed $count open file handles.")
          val reloadedDataSource = dataSourceService.dataSourceFromFolder(
            dataSourceService.dataBaseDir.resolve(organizationName).resolve(dataSetName),
            organizationName)
          for {
            _ <- dataSourceRepository.updateDataSource(reloadedDataSource)
          } yield Ok(Json.toJson(reloadedDataSource))
        }
      }
    }

  def deleteOnDisk(organizationName: String, dataSetName: String): Action[AnyContent] = Action.async {
    implicit request =>
      accessTokenService
        .validateAccess(UserAccessRequest.deleteDataSource(DataSourceId(dataSetName, organizationName))) {
          AllowRemoteOrigin {
            for {
              _ <- binaryDataServiceHolder.binaryDataService
                .deleteOnDisk(organizationName, dataSetName, reason = Some("the user wants to delete the dataset"))
            } yield Ok
          }
        }
  }

}
