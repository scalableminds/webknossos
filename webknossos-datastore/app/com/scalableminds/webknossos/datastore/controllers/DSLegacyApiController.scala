package com.scalableminds.webknossos.datastore.controllers

import com.scalableminds.util.Msg
import com.google.inject.Inject
import com.scalableminds.util.box.Full
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, JsonHelper}
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.dataformats.zarr.Zarr3OutputHelper
import com.scalableminds.webknossos.datastore.helpers.UnsignedLong
import com.scalableminds.webknossos.datastore.services.mesh.FullMeshRequest
import com.scalableminds.webknossos.datastore.services.uploading.{
  DatasetUploadInfo,
  LinkedLayerIdentifier,
  ResumableUploadInfo,
  UploadDomain
}
import com.scalableminds.webknossos.datastore.services.{
  DSRemoteWebknossosClient,
  DataStoreAccessTokenService,
  UserAccessRequest
}
import play.api.http.HttpEntity
import play.api.libs.Files
import play.api.libs.json.{JsObject, JsValue, Json, OFormat}
import play.api.mvc.{Action, AnyContent, MultipartFormData, PlayBodyParsers, Result}

import scala.concurrent.{ExecutionContext, Future}

case class LegacyReserveManualUploadInformation(
    datasetName: String,
    organization: String,
    initialTeamIds: Seq[ObjectId],
    folderId: Option[ObjectId],
    requireUniqueName: Boolean = false
)
object LegacyReserveManualUploadInformation {
  implicit val jsonFormat: OFormat[LegacyReserveManualUploadInformation] =
    Json.format[LegacyReserveManualUploadInformation]
}

case class LegacyReserveUploadInformationV11(
    uploadId: String, // upload id that was also used in chunk upload (this time without file paths)
    name: String, // dataset name
    organization: String,
    totalFileCount: Long,
    filePaths: Option[List[String]],
    totalFileSizeInBytes: Option[Long],
    layersToLink: Option[List[LegacyLinkedLayerIdentifier]],
    initialTeams: List[ObjectId], // team ids
    folderId: Option[ObjectId],
    requireUniqueName: Option[Boolean],
    isVirtual: Option[Boolean], // Only set (to false) for legacy manual uploads
    needsConversion: Option[Boolean] // None means false
)
object LegacyReserveUploadInformationV11 {
  implicit val jsonFormat: OFormat[LegacyReserveUploadInformationV11] = Json.format[LegacyReserveUploadInformationV11]
}

case class LegacyLinkedLayerIdentifier(
    organizationId: Option[String],
    organizationName: Option[String],
    // Filled by backend after identifying the dataset by name. Afterwards this updated value is stored in the redis database.
    datasetDirectoryName: Option[String],
    dataSetName: String,
    layerName: String,
    newLayerName: Option[String] = None
) {

  def getOrganizationId: String = this.organizationId.getOrElse(this.organizationName.getOrElse(""))
}

object LegacyLinkedLayerIdentifier {
  def apply(
      organizationId: String,
      dataSetName: String,
      layerName: String,
      newLayerName: Option[String]
  ): LegacyLinkedLayerIdentifier =
    new LegacyLinkedLayerIdentifier(Some(organizationId), None, None, dataSetName, layerName, newLayerName)
  implicit val jsonFormat: OFormat[LegacyLinkedLayerIdentifier] = Json.format[LegacyLinkedLayerIdentifier]
}

case class LegacyUploadInformation(uploadId: String, needsConversion: Option[Boolean])

object LegacyUploadInformation {
  implicit val jsonFormat: OFormat[LegacyUploadInformation] = Json.format[LegacyUploadInformation]
}

case class ReserveUploadInformationV13(
    uploadId: String, // upload id that was also used in chunk upload (this time without file paths)
    name: String, // dataset name
    organization: String,
    totalFileCount: Long,
    filePaths: Option[List[String]],
    totalFileSizeInBytes: Option[Long],
    layersToLink: Option[List[LinkedLayerIdentifier]],
    initialTeams: List[ObjectId], // team ids
    folderId: Option[ObjectId],
    requireUniqueName: Option[Boolean],
    isVirtual: Option[Boolean], // Only set (to false) for legacy manual uploads
    needsConversion: Option[Boolean] // None means false
)
object ReserveUploadInformationV13 {
  implicit val jsonFormat: OFormat[ReserveUploadInformationV13] = Json.format[ReserveUploadInformationV13]
}

class DSLegacyApiController @Inject() (
    accessTokenService: DataStoreAccessTokenService,
    remoteWebknossosClient: DSRemoteWebknossosClient,
    zarrStreamingController: ZarrStreamingController,
    dataProxyController: DataProxyController,
    meshController: DSMeshController,
    config: DataStoreConfig,
    uploadController: UploadController
)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with Zarr3OutputHelper {

  override def allowRemoteOrigin: Boolean = true

  def proxyDatasourceV14(datasetId: ObjectId): Action[AnyContent] = Action.async { implicit request =>
    withDowngradedLargestSegmentIds(dataProxyController.proxyDatasource(datasetId)(request))
  }

  def requestDataSourceV14(datasetId: ObjectId, zarrVersion: Int): Action[AnyContent] = Action.async {
    implicit request =>
      withDowngradedLargestSegmentIds(zarrStreamingController.requestDataSource(datasetId, zarrVersion)(request))
  }

  def dataSourceWithAnnotationPrivateLinkV14(accessTokenOrId: String, zarrVersion: Int): Action[AnyContent] =
    Action.async { implicit request =>
      withDowngradedLargestSegmentIds(
        zarrStreamingController.dataSourceWithAnnotationPrivateLink(accessTokenOrId, zarrVersion)(request)
      )
    }

  def testChunkV13(resumableChunkNumber: Int, resumableIdentifier: String): Action[AnyContent] =
    uploadController.testChunk(resumableChunkNumber, resumableIdentifier, UploadDomain.dataset.toString)

  def finishUploadV13(): Action[LegacyUploadInformation] = Action.async(validateJson[LegacyUploadInformation]) {
    implicit request =>
      for {
        result <- uploadController.finishUpload(UploadDomain.dataset.toString, request.body.uploadId)(
          request.withBody(play.api.mvc.AnyContentAsEmpty)
        )
      } yield
        if (result.header.status == OK) {
          result.body match {
            case play.api.http.HttpEntity.Strict(data, _) =>
              val json = Json.parse(data.toArray).as[JsObject]
              Ok((json - "datasetId") ++ Json.obj("newDatasetId" -> (json \ "datasetId").get))
            case _ => result
          }
        } else result
  }

  def reserveDatasetUploadV13(): Action[ReserveUploadInformationV13] =
    Action.async(validateJson[ReserveUploadInformationV13]) { implicit request =>
      uploadController.reserveDatasetUpload()(
        request.withBody(
          DatasetUploadInfo(
            resumableUploadInfo = ResumableUploadInfo(
              uploadId = request.body.uploadId,
              totalFileCount = request.body.totalFileCount,
              filePaths = request.body.filePaths,
              totalFileSizeInBytes = request.body.totalFileSizeInBytes
            ),
            datasetName = request.body.name,
            organizationId = request.body.organization,
            layersToLink = request.body.layersToLink,
            initialTeamIds = request.body.initialTeams,
            folderId = request.body.folderId,
            requireUniqueName = request.body.requireUniqueName,
            isVirtual = request.body.isVirtual,
            needsConversion = None,
            voxelSizeFactor = None,
            voxelSizeUnit = None
          )
        )
      )
    }

  def uploadChunkV13(): Action[MultipartFormData[Files.TemporaryFile]] =
    Action.async(parse.multipartFormData) { implicit request =>
      uploadController.uploadChunk(UploadDomain.dataset.toString)(request)
    }

  def getUnfinishedUploadsV13(organizationName: String): Action[AnyContent] =
    Action.async { implicit request =>
      uploadController.getUnfinishedUploads(organizationName, UploadDomain.dataset.toString)(request)
    }

  def reserveUploadV11(): Action[LegacyReserveUploadInformationV11] =
    Action.fox(validateJson[LegacyReserveUploadInformationV11]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.administrateDatasets(request.body.organization)
      ) {
        for {
          adaptedLayersToLink <- Fox.serialCombined(request.body.layersToLink.getOrElse(List.empty))(adaptLayerToLink)
          adaptedRequestBody = DatasetUploadInfo(
            resumableUploadInfo = ResumableUploadInfo(
              uploadId = request.body.uploadId,
              totalFileCount = request.body.totalFileCount,
              filePaths = request.body.filePaths,
              totalFileSizeInBytes = request.body.totalFileSizeInBytes
            ),
            datasetName = request.body.name,
            organizationId = request.body.organization,
            layersToLink = Some(adaptedLayersToLink),
            initialTeamIds = request.body.initialTeams,
            folderId = request.body.folderId,
            requireUniqueName = request.body.requireUniqueName,
            isVirtual = request.body.isVirtual,
            needsConversion = None,
            voxelSizeFactor = None,
            voxelSizeUnit = None
          )
          result <- Fox.fromFuture(uploadController.reserveDatasetUpload()(request.withBody(adaptedRequestBody)))
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
    Action.fox(validateJson[LegacyReserveManualUploadInformation]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.administrateDatasets(request.body.organization)
      ) {
        for {
          reservedDatasetInfo <- remoteWebknossosClient.reserveDatasetUpload(
            DatasetUploadInfo(
              resumableUploadInfo = ResumableUploadInfo(
                uploadId = "aManualUpload",
                totalFileCount = 0,
                filePaths = Some(List.empty),
                totalFileSizeInBytes = None
              ),
              datasetName = request.body.datasetName,
              organizationId = request.body.organization,
              layersToLink = None,
              initialTeamIds = request.body.initialTeamIds,
              folderId = request.body.folderId,
              requireUniqueName = Some(request.body.requireUniqueName),
              isVirtual = Some(false),
              needsConversion = None,
              voxelSizeFactor = None,
              voxelSizeUnit = None
            )
          ) ?~> Msg.Dataset.Upload.validationFailed
        } yield Ok(
          Json.obj(
            "newDatasetId" -> reservedDatasetInfo.newDatasetId,
            "directoryName" -> reservedDatasetInfo.directoryName
          )
        )
      }
    }

  // MESH ROUTES

  def loadFullMeshStl(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String
  ): Action[FullMeshRequest] =
    Action.async(validateJson[FullMeshRequest]) { implicit request =>
      withResolvedDatasetId(organizationId, datasetDirectoryName) { datasetId =>
        meshController.loadFullMeshStl(datasetId, dataLayerName)(request)
      }
    }

  private def withResolvedDatasetId(organizationId: String, datasetDirectoryName: String)(
      block: ObjectId => Future[Result]
  ): Future[Result] =
    for {
      datasetIdBox <- remoteWebknossosClient.getDatasetId(organizationId, datasetDirectoryName).futureBox
      result <- datasetIdBox match {
        case Full(datasetId) => block(datasetId)
        case _               =>
          Future.successful(
            Forbidden("Token may be expired, consider reloading. Access forbidden: No read access on dataset")
          )
      }
    } yield result

  // For API versions <= 14, largestSegmentId must keep being written as a plain JsNumber (rather than the
  // UnsignedLong bigint envelope) whenever that does not lose precision, for backwards compatibility with
  // clients that do not understand that newer format (see UnsignedLong.scala). This mirrors the analogous
  // shim in controllers.LegacyApiController of the webknossos app.
  private def withDowngradedLargestSegmentIds(result: Future[Result]): Future[Result] =
    result.map { r =>
      if (r.header.status == OK) {
        r.body match {
          case HttpEntity.Strict(data, _) =>
            JsonHelper.parseAs[JsValue](data.toArray) match {
              case Full(jsValue) =>
                val downgraded =
                  JsonHelper.patchKeyRecursively(jsValue, "largestSegmentId")(UnsignedLong.downgradeToPlainNumberIfSafe)
                Ok(downgraded).copy(header = r.header)
              case _ => r
            }
          case _ => r
        }
      } else r
    }
}
