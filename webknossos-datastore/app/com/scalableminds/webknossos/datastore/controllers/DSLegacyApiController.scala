package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, Full}
import com.scalableminds.webknossos.datastore.dataformats.zarr.Zarr3OutputHelper
import com.scalableminds.webknossos.datastore.helpers.MissingBucketHeaders
import com.scalableminds.webknossos.datastore.models.{
  RawCuboidRequest,
  WebknossosAdHocMeshRequest,
  WebknossosDataRequest
}
import com.scalableminds.webknossos.datastore.models.datasource.{UnusableDataSource, UsableDataSource}
import com.scalableminds.webknossos.datastore.services.mesh.FullMeshRequest
import com.scalableminds.webknossos.datastore.services.uploading.{LinkedLayerIdentifier, ReserveUploadInformation}
import com.scalableminds.webknossos.datastore.services.{
  DSRemoteWebknossosClient,
  DataSourceService,
  DataStoreAccessTokenService,
  DatasetCache,
  UserAccessRequest
}
import play.api.libs.json.{Json, OFormat}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers, RawBuffer, Result}

import scala.concurrent.{ExecutionContext, Future}

case class LegacyReserveManualUploadInformation(
    datasetName: String,
    organization: String,
    initialTeamIds: List[ObjectId],
    folderId: Option[ObjectId],
    requireUniqueName: Boolean = false,
)
object LegacyReserveManualUploadInformation {
  implicit val jsonFormat: OFormat[LegacyReserveManualUploadInformation] =
    Json.format[LegacyReserveManualUploadInformation]
}

case class LegacyReserveUploadInformation(
    uploadId: String, // upload id that was also used in chunk upload (this time without file paths)
    name: String, // dataset name
    organization: String,
    totalFileCount: Long,
    filePaths: Option[List[String]],
    totalFileSizeInBytes: Option[Long],
    layersToLink: Option[List[LegacyLinkedLayerIdentifier]],
    initialTeams: List[ObjectId], // team ids
    folderId: Option[ObjectId],
    requireUniqueName: Option[Boolean]
)
object LegacyReserveUploadInformation {
  implicit val jsonFormat: OFormat[LegacyReserveUploadInformation] = Json.format[LegacyReserveUploadInformation]
}

case class LegacyLinkedLayerIdentifier(organizationId: Option[String],
                                       organizationName: Option[String],
                                       // Filled by backend after identifying the dataset by name. Afterwards this updated value is stored in the redis database.
                                       datasetDirectoryName: Option[String],
                                       dataSetName: String,
                                       layerName: String,
                                       newLayerName: Option[String] = None) {

  def getOrganizationId: String = this.organizationId.getOrElse(this.organizationName.getOrElse(""))
}

object LegacyLinkedLayerIdentifier {
  def apply(organizationId: String,
            dataSetName: String,
            layerName: String,
            newLayerName: Option[String]): LegacyLinkedLayerIdentifier =
    new LegacyLinkedLayerIdentifier(Some(organizationId), None, None, dataSetName, layerName, newLayerName)
  implicit val jsonFormat: OFormat[LegacyLinkedLayerIdentifier] = Json.format[LegacyLinkedLayerIdentifier]
}

class DSLegacyApiController @Inject()(
    accessTokenService: DataStoreAccessTokenService,
    remoteWebknossosClient: DSRemoteWebknossosClient,
    binaryDataController: BinaryDataController,
    zarrStreamingController: ZarrStreamingController,
    meshController: DSMeshController,
    dataSourceController: DataSourceController,
    dataSourceService: DataSourceService,
    datasetCache: DatasetCache
)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with Zarr3OutputHelper
    with MissingBucketHeaders {

  override def allowRemoteOrigin: Boolean = true

  def reserveUploadV11(): Action[LegacyReserveUploadInformation] =
    Action.async(validateJson[LegacyReserveUploadInformation]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.administrateDatasets(request.body.organization)) {

        for {
          adaptedLayersToLink <- Fox.serialCombined(request.body.layersToLink.getOrElse(List.empty))(adaptLayerToLink)
          adaptedRequestBody = ReserveUploadInformation(
            uploadId = request.body.uploadId,
            name = request.body.name,
            organization = request.body.organization,
            totalFileCount = request.body.totalFileCount,
            filePaths = request.body.filePaths,
            totalFileSizeInBytes = request.body.totalFileSizeInBytes,
            layersToLink = Some(adaptedLayersToLink),
            initialTeams = request.body.initialTeams,
            folderId = request.body.folderId,
            requireUniqueName = request.body.requireUniqueName,
            isVirtual = None,
            needsConversion = None
          )
          result <- Fox.fromFuture(dataSourceController.reserveUpload()(request.withBody(adaptedRequestBody)))
        } yield result
      }
    }

  private def adaptLayerToLink(legacyLayerToLink: LegacyLinkedLayerIdentifier): Fox[LinkedLayerIdentifier] = {
    val asObjectIdOpt = ObjectId.fromStringSync(legacyLayerToLink.dataSetName)
    for {
      datasetId <- asObjectIdOpt match {
        case Some(asObjectId) =>
          // Client already used datasetId in the dataSetName field. The libs did this for a while.
          Fox.successful(asObjectId)
        case None =>
          // dataSetName is not an objectId. Assume directoryName. Resolve with remoteWebknossosClient.
          remoteWebknossosClient.getDatasetId(legacyLayerToLink.getOrganizationId, legacyLayerToLink.dataSetName)
      }
    } yield LinkedLayerIdentifier(datasetId, legacyLayerToLink.layerName, legacyLayerToLink.newLayerName)
  }

  // To be called by people with disk access but not DatasetManager role. This way, they can upload a dataset manually on disk,
  // and it can be put in a webknossos folder where they have access
  def reserveManualUploadV10(): Action[LegacyReserveManualUploadInformation] =
    Action.async(validateJson[LegacyReserveManualUploadInformation]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.administrateDatasets(request.body.organization)) {
        for {
          reservedDatasetInfo <- remoteWebknossosClient.reserveDataSourceUpload(
            ReserveUploadInformation(
              "aManualUpload",
              request.body.datasetName,
              request.body.organization,
              0,
              Some(List.empty),
              None,
              None,
              request.body.initialTeamIds,
              request.body.folderId,
              Some(request.body.requireUniqueName),
              Some(false),
              needsConversion = None
            )
          ) ?~> "dataset.upload.validation.failed"
        } yield
          Ok(
            Json.obj("newDatasetId" -> reservedDatasetInfo.newDatasetId,
                     "directoryName" -> reservedDatasetInfo.directoryName))
      }
    }

  def requestViaWebknossosV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String
  ): Action[List[WebknossosDataRequest]] = Action.async(validateJson[List[WebknossosDataRequest]]) { implicit request =>
    withResolvedDatasetId(organizationId, datasetDirectoryName) { datasetId =>
      binaryDataController.requestViaWebknossos(datasetId, dataLayerName)(request)
    }
  }

  def requestRawCuboidV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      // Mag1 coordinates of the top-left corner of the bounding box
      x: Int,
      y: Int,
      z: Int,
      // Target-mag size of the bounding box
      width: Int,
      height: Int,
      depth: Int,
      // Mag in three-component format (e.g. 1-1-1 or 16-16-8)
      mag: String,
      // If true, use lossy compression by sending only half-bytes of the data
      halfByte: Boolean,
      mappingName: Option[String]
  ): Action[AnyContent] = Action.async { implicit request =>
    withResolvedDatasetId(organizationId, datasetDirectoryName) { datasetId =>
      binaryDataController.requestRawCuboid(
        datasetId,
        dataLayerName,
        x,
        y,
        z,
        width,
        height,
        depth,
        mag,
        halfByte,
        mappingName
      )(request)
    }
  }

  def requestRawCuboidPostV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String
  ): Action[RawCuboidRequest] = Action.async(validateJson[RawCuboidRequest]) { implicit request =>
    withResolvedDatasetId(organizationId, datasetDirectoryName) { datasetId =>
      binaryDataController.requestRawCuboidPost(
        datasetId,
        dataLayerName
      )(request)
    }
  }

  def requestViaKnossosV9(organizationId: String,
                          datasetDirectoryName: String,
                          dataLayerName: String,
                          mag: Int,
                          x: Int,
                          y: Int,
                          z: Int,
                          cubeSize: Int): Action[AnyContent] = Action.async { implicit request =>
    withResolvedDatasetId(organizationId, datasetDirectoryName) { datasetId =>
      binaryDataController.requestViaKnossos(
        datasetId,
        dataLayerName,
        mag,
        x,
        y,
        z,
        cubeSize
      )(request)
    }
  }

  def thumbnailJpegV9(organizationId: String,
                      datasetDirectoryName: String,
                      dataLayerName: String,
                      x: Int,
                      y: Int,
                      z: Int,
                      width: Int,
                      height: Int,
                      mag: String,
                      mappingName: Option[String],
                      intensityMin: Option[Double],
                      intensityMax: Option[Double],
                      color: Option[String],
                      invertColor: Option[Boolean]): Action[RawBuffer] = Action.async(parse.raw) { implicit request =>
    withResolvedDatasetId(organizationId, datasetDirectoryName) { datasetId =>
      binaryDataController.thumbnailJpeg(
        datasetId,
        dataLayerName,
        x,
        y,
        z,
        width,
        height,
        mag,
        mappingName,
        intensityMin,
        intensityMax,
        color,
        invertColor
      )(request)
    }
  }

  def mappingJsonV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      mappingName: String
  ): Action[AnyContent] = Action.async { implicit request =>
    withResolvedDatasetId(organizationId, datasetDirectoryName) { datasetId =>
      binaryDataController.mappingJson(
        datasetId,
        dataLayerName,
        mappingName
      )(request)
    }
  }

  /**
    * Handles ad-hoc mesh requests.
    */
  def requestAdHocMeshV9(organizationId: String,
                         datasetDirectoryName: String,
                         dataLayerName: String): Action[WebknossosAdHocMeshRequest] =
    Action.async(validateJson[WebknossosAdHocMeshRequest]) { implicit request =>
      withResolvedDatasetId(organizationId, datasetDirectoryName) { datasetId =>
        binaryDataController.requestAdHocMesh(
          datasetId,
          dataLayerName
        )(request)
      }
    }

  def findDataV9(organizationId: String, datasetDirectoryName: String, dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      withResolvedDatasetId(organizationId, datasetDirectoryName) { datasetId =>
        binaryDataController.findData(
          datasetId,
          dataLayerName
        )(request)
      }
    }

  def histogramV9(organizationId: String, datasetDirectoryName: String, dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      withResolvedDatasetId(organizationId, datasetDirectoryName) { datasetId =>
        binaryDataController.histogram(
          datasetId,
          dataLayerName
        )(request)
      }
    }

  // ZARR ROUTES

  def requestZAttrsV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String = "",
  ): Action[AnyContent] = Action.async { implicit request =>
    withResolvedDatasetId(organizationId, datasetDirectoryName) { datasetId =>
      zarrStreamingController.requestZAttrs(datasetId, dataLayerName)(request)
    }
  }

  def requestZarrJsonV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String = "",
  ): Action[AnyContent] = Action.async { implicit request =>
    withResolvedDatasetId(organizationId, datasetDirectoryName) { datasetId =>
      zarrStreamingController.requestZarrJson(datasetId, dataLayerName)(request)
    }
  }

  /**
    * Zarr-specific datasource-properties.json file for a datasource.
    * Note that the result here is not necessarily equal to the file used in the underlying storage.
    */
  def requestDataSourceV9(
      organizationId: String,
      datasetDirectoryName: String,
      zarrVersion: Int,
  ): Action[AnyContent] = Action.async { implicit request =>
    withResolvedDatasetId(organizationId, datasetDirectoryName) { datasetId =>
      zarrStreamingController.requestDataSource(datasetId, zarrVersion)(request)
    }
  }

  def requestRawZarrCubeV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      mag: String,
      coordinates: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    withResolvedDatasetId(organizationId, datasetDirectoryName) { datasetId =>
      zarrStreamingController.requestRawZarrCube(
        datasetId,
        dataLayerName,
        mag,
        coordinates
      )(request)
    }
  }

  def requestZArrayV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      mag: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    withResolvedDatasetId(organizationId, datasetDirectoryName) { datasetId =>
      zarrStreamingController.requestZArray(datasetId, dataLayerName, mag)(request)
    }
  }

  def requestZarrJsonForMagV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      mag: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    withResolvedDatasetId(organizationId, datasetDirectoryName) { datasetId =>
      zarrStreamingController.requestZarrJsonForMag(datasetId, dataLayerName, mag)(request)
    }
  }

  def requestDataLayerDirectoryContentsV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      zarrVersion: Int
  ): Action[AnyContent] = Action.async { implicit request =>
    withResolvedDatasetId(organizationId, datasetDirectoryName) { datasetId =>
      zarrStreamingController.requestDataLayerDirectoryContents(datasetId, dataLayerName, zarrVersion)(request)
    }
  }

  def requestDataLayerMagDirectoryContentsV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      mag: String,
      zarrVersion: Int
  ): Action[AnyContent] = Action.async { implicit request =>
    withResolvedDatasetId(organizationId, datasetDirectoryName) { datasetId =>
      zarrStreamingController.requestDataLayerMagDirectoryContents(datasetId, dataLayerName, mag, zarrVersion)(request)
    }
  }

  def requestDataSourceDirectoryContentsV9(
      organizationId: String,
      datasetDirectoryName: String,
      zarrVersion: Int
  ): Action[AnyContent] = Action.async { implicit request =>
    withResolvedDatasetId(organizationId, datasetDirectoryName) { datasetId =>
      zarrStreamingController.requestDataSourceDirectoryContents(datasetId, zarrVersion)(request)
    }
  }

  def requestZGroupV9(organizationId: String,
                      datasetDirectoryName: String,
                      dataLayerName: String = ""): Action[AnyContent] =
    Action.async { implicit request =>
      withResolvedDatasetId(organizationId, datasetDirectoryName) { datasetId =>
        zarrStreamingController.requestZGroup(datasetId, dataLayerName)(request)
      }
    }

  // MESH ROUTES

  def loadFullMeshStl(organizationId: String,
                      datasetDirectoryName: String,
                      dataLayerName: String): Action[FullMeshRequest] =
    Action.async(validateJson[FullMeshRequest]) { implicit request =>
      withResolvedDatasetId(organizationId, datasetDirectoryName) { datasetId =>
        meshController.loadFullMeshStl(datasetId, dataLayerName)(request)
      }
    }

  // ACTIONS

  def reloadDatasourceV9(organizationId: String,
                         datasetDirectoryName: String,
                         layerName: Option[String]): Action[AnyContent] = {
    def loadFromDisk(): Fox[Result] = {
      // Dataset is not present in DB. This can be because reload was called after a dataset was written into the directory
      val dataSource = dataSourceService.dataSourceFromDir(
        dataSourceService.dataBaseDir.resolve(organizationId).resolve(datasetDirectoryName),
        organizationId,
        resolveMagPaths = true)
      dataSource match {
        case UsableDataSource(_, _, _, _, _) =>
          for {
            _ <- remoteWebknossosClient.reportDataSource(dataSource)
          } yield Ok(Json.toJson(dataSource))
        case UnusableDataSource(_, _, status, _, _) =>
          Fox.failure(s"Dataset not found in DB or in directory: $status, cannot reload.") ~> NOT_FOUND
      }
    }

    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.administrateDatasets(organizationId)) {
        for {
          datasetIdOpt: Option[ObjectId] <- Fox.fromFuture(
            remoteWebknossosClient.getDatasetId(organizationId, datasetDirectoryName).toFutureOption)
          result <- datasetIdOpt match {
            case Some(datasetId) =>
              // Dataset is present in DB
              for {
                dataSourceOpt: Option[UsableDataSource] <- Fox.fromFuture(
                  datasetCache.getById(datasetId).toFutureOption)
                // The dataset may be unusable (in which case dataSourceOpt will be None)
                r <- dataSourceOpt match {
                  case Some(_) =>
                    Fox.fromFuture(dataSourceController.reload(organizationId, datasetId, layerName)(request))
                  // Load from disk if the dataset is not usable in the DB
                  case None => loadFromDisk()
                }
              } yield r
            case None =>
              loadFromDisk()
          }
        } yield result
      }
    }
  }

  private def withResolvedDatasetId(organizationId: String, datasetDirectoryName: String)(
      block: ObjectId => Future[Result]): Future[Result] =
    for {
      datasetIdBox <- remoteWebknossosClient.getDatasetId(organizationId, datasetDirectoryName).futureBox
      result <- datasetIdBox match {
        case Full(datasetId) => block(datasetId)
        case _ =>
          Future.successful(
            Forbidden("Token may be expired, consider reloading. Access forbidden: No read access on dataset"))
      }
    } yield result
}
