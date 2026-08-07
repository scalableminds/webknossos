package com.scalableminds.webknossos.datastore.controllers

import com.scalableminds.util.Msg
import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.box.Full
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.dataformats.zarr.Zarr3OutputHelper
import com.scalableminds.webknossos.datastore.datareaders.zarr.{NgffGroupHeader, NgffMetadata, ZarrHeader}
import com.scalableminds.webknossos.datastore.models.{
  RawCuboidRequest,
  WebknossosAdHocMeshRequest,
  WebknossosDataRequest
}
import com.scalableminds.webknossos.datastore.models.annotation.{AnnotationLayer, AnnotationLayerType, AnnotationSource}
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, UnusableDataSource, UsableDataSource}
import com.scalableminds.webknossos.datastore.services.mesh.FullMeshRequest
import com.scalableminds.webknossos.datastore.services.uploading.{
  DatasetUploadInfo,
  LinkedLayerIdentifier,
  ResumableUploadInfo,
  UploadDomain
}
import com.scalableminds.webknossos.datastore.services.{
  BaseDirService,
  DSRemoteTracingstoreClient,
  DSRemoteWebknossosClient,
  DataSourceService,
  DataStoreAccessTokenService,
  DatasetCache,
  UserAccessRequest
}
import play.api.libs.Files
import play.api.libs.json.{JsObject, JsValue, Json, OFormat}
import play.api.mvc.{Action, AnyContent, MultipartFormData, PlayBodyParsers, RawBuffer, Request, Result}

import java.nio.file.Path
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
    remoteTracingstoreClient: DSRemoteTracingstoreClient,
    binaryDataController: BinaryDataController,
    zarrStreamingController: ZarrStreamingController,
    meshController: DSMeshController,
    dataSourceController: DataSourceController,
    dataSourceService: DataSourceService,
    config: DataStoreConfig,
    datasetCache: DatasetCache,
    baseDirService: BaseDirService,
    uploadController: UploadController
)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with Zarr3OutputHelper {

  override def allowRemoteOrigin: Boolean = true

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

  def requestViaKnossosV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      mag: Int,
      x: Int,
      y: Int,
      z: Int,
      cubeSize: Int
  ): Action[AnyContent] = Action.async { implicit request =>
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

  def thumbnailJpegV9(
      organizationId: String,
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
      invertColor: Option[Boolean]
  ): Action[RawBuffer] = Action.async(parse.raw) { implicit request =>
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

  /** Handles ad-hoc mesh requests.
    */
  def requestAdHocMeshV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String
  ): Action[WebknossosAdHocMeshRequest] =
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
  //
  // Zarr v2 output (.zgroup/.zattrs/.zarray) is no longer served by ZarrStreamingController (the "latest"
  // controller) since Zarr v3 is now the default there. This controller is the sole remaining place that
  // implements Zarr v2 output, reachable only through the old, version-pinned routes below. The private-link
  // (accessToken-keyed) zarr routes never needed a legacy home before (their URL shape never changed across
  // API versions), but now need one too: either their target action moved here entirely (v2-only), or their
  // target action's signature changed (dropped zarrVersion, now v3-only) so old versions must keep branching here.

  private def resolveDatasetIdFox(organizationId: String, datasetDirectoryName: String): Fox[ObjectId] =
    remoteWebknossosClient.getDatasetId(
      organizationId,
      datasetDirectoryName
    ) ?~> "Token may be expired, consider reloading. Access forbidden: No read access on dataset" ~> FORBIDDEN

  private def ifIsAnnotationLayerOrElse(
      accessToken: String,
      dataLayerName: String,
      ifIsAnnotationLayer: (AnnotationLayer, AnnotationSource, TokenContext) => Fox[Result],
      orElse: AnnotationSource => Fox[Result]
  )(implicit request: Request[Any]): Fox[Result] =
    for {
      annotationSource <- remoteWebknossosClient.getAnnotationSource(accessToken) ~> NOT_FOUND
      relevantTokenContext =
        if (annotationSource.accessViaPrivateLink) TokenContext(Some(accessToken))
        else tokenContextForRequest
      layer = annotationSource.getAnnotationLayer(dataLayerName)
      result <- layer match {
        case Some(annotationLayer) => ifIsAnnotationLayer(annotationLayer, annotationSource, relevantTokenContext)
        case None                  => orElse(annotationSource)
      }
    } yield result

  private def zGroupJson: JsValue = Json.toJson(NgffGroupHeader(zarr_format = 2))

  private def zArrayV2(datasetId: ObjectId, dataLayerName: String, mag: String): Fox[Result] =
    for {
      (_, dataLayer) <- datasetCache.getWithLayer(
        datasetId,
        dataLayerName
      ) ?~> Msg.Dataset.DataSource.notFound ~> NOT_FOUND
      magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true).toFox ?~> Msg.Dataset.Mag.invalid(mag) ~> NOT_FOUND
      _ <- Fox
        .fromBool(dataLayer.containsMag(magParsed)) ?~> Msg.Dataset.Layer.magNotFound(dataLayerName, mag) ~> NOT_FOUND
      zarrHeader = ZarrHeader.fromLayer(dataLayer, magParsed)
    } yield Ok(Json.toJson(zarrHeader))

  private def dataLayerDirectoryContentsV2(datasetId: ObjectId, dataLayerName: String): Fox[Result] =
    for {
      (_, dataLayer) <- datasetCache.getWithLayer(
        datasetId,
        dataLayerName
      ) ?~> Msg.Dataset.DataSource.notFound ~> NOT_FOUND
      mags = dataLayer.sortedMags
      additionalFiles = List(NgffMetadata.FILENAME_DOT_ZATTRS, NgffGroupHeader.FILENAME_DOT_ZGROUP)
    } yield Ok(
      views.html.datastoreZarrDatasourceDir(
        "Datastore",
        "%s/%s".format(datasetId, dataLayerName),
        additionalFiles ++ mags.map(_.toMagLiteral(allowScalar = true))
      )
    ).withHeaders()

  private def dataLayerMagDirectoryContentsV2(datasetId: ObjectId, dataLayerName: String, mag: String): Fox[Result] =
    for {
      (_, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
      magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true).toFox ?~> Msg.Dataset.Mag.invalid(mag) ~> NOT_FOUND
      _ <- Fox
        .fromBool(dataLayer.containsMag(magParsed)) ?~> Msg.Dataset.Layer.magNotFound(dataLayerName, mag) ~> NOT_FOUND
    } yield Ok(
      views.html.datastoreZarrDatasourceDir(
        "Datastore",
        "%s/%s/%s".format(datasetId, dataLayerName, mag),
        List(ZarrHeader.FILENAME_DOT_ZARRAY)
      )
    ).withHeaders()

  private def dataSourceDirectoryContentsV2(datasetId: ObjectId): Fox[Result] =
    for {
      dataSource <- datasetCache.getById(datasetId) ?~> Msg.Dataset.DataSource.notFound ~> NOT_FOUND
      layerNames = dataSource.dataLayers.map((dataLayer: DataLayer) => dataLayer.name)
    } yield Ok(
      views.html.datastoreZarrDatasourceDir(
        "Datastore",
        s"$datasetId",
        List(
          UsableDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON,
          NgffGroupHeader.FILENAME_DOT_ZGROUP
        ) ++ layerNames
      )
    )

  // --- Zarr v2-only dataset-scoped routes (org+datasetDirectoryName-keyed) ---

  def requestZAttrsV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String = ""
  ): Action[AnyContent] = Action.fox { implicit request =>
    for {
      datasetId <- resolveDatasetIdFox(organizationId, datasetDirectoryName)
      result <- accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(
            datasetId,
            dataLayerName
          ) ?~> Msg.Dataset.DataSource.notFound ~> NOT_FOUND
          omeNgffHeader = NgffMetadata.fromNameVoxelSizeAndMags(dataLayerName, dataSource.scale, dataLayer.sortedMags)
        } yield Ok(Json.toJson(omeNgffHeader))
      }
    } yield result
  }

  def requestZGroupV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String = ""
  ): Action[AnyContent] = Action.fox { implicit request =>
    for {
      datasetId <- resolveDatasetIdFox(organizationId, datasetDirectoryName)
      result <- accessTokenService.validateAccessFromTokenContextForSyncBlock(UserAccessRequest.readDataset(datasetId)) {
        Ok(zGroupJson)
      }
    } yield result
  }

  def requestZArrayV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      mag: String
  ): Action[AnyContent] = Action.fox { implicit request =>
    for {
      datasetId <- resolveDatasetIdFox(organizationId, datasetDirectoryName)
      result <- accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        zArrayV2(datasetId, dataLayerName, mag)
      }
    } yield result
  }

  // --- Routes shared with the current API version (Zarr v3 / format-agnostic), unaffected by this refactor ---

  def requestZarrJsonV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String = ""
  ): Action[AnyContent] = Action.async { implicit request =>
    withResolvedDatasetId(organizationId, datasetDirectoryName) { datasetId =>
      zarrStreamingController.requestZarrJson(datasetId, dataLayerName)(request)
    }
  }

  def requestRawZarrCubeV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      mag: String,
      coordinates: String
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

  def requestZarrJsonForMagV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      mag: String
  ): Action[AnyContent] = Action.async { implicit request =>
    withResolvedDatasetId(organizationId, datasetDirectoryName) { datasetId =>
      zarrStreamingController.requestZarrJsonForMag(datasetId, dataLayerName, mag)(request)
    }
  }

  // --- Routes that branch on zarrVersion for legacy API versions (dataset-scoped) ---
  // v2 is self-hosted here (relocated from ZarrStreamingController); v3 still delegates there.

  /** Zarr-specific datasource-properties.json file for a datasource. Note that the result here is not necessarily equal
    * to the file used in the underlying storage.
    */
  def requestDataSourceV9(
      organizationId: String,
      datasetDirectoryName: String,
      zarrVersion: Int
  ): Action[AnyContent] = Action.fox { implicit request =>
    for {
      datasetId <- resolveDatasetIdFox(organizationId, datasetDirectoryName)
      result <-
        if (zarrVersion == 2)
          accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
            for {
              dataSource <- datasetCache.getById(datasetId) ~> NOT_FOUND
              zarrLayers = dataSource.dataLayers.map(convertLayerToZarrLayer(_, zarrVersion))
              zarrSource = UsableDataSource(dataSource.id, zarrLayers, dataSource.scale)
            } yield Ok(Json.toJson(zarrSource))
          }
        else Fox.fromFuture(zarrStreamingController.requestDataSource(datasetId)(request))
    } yield result
  }

  def requestDataLayerDirectoryContentsV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      zarrVersion: Int
  ): Action[AnyContent] = Action.fox { implicit request =>
    for {
      datasetId <- resolveDatasetIdFox(organizationId, datasetDirectoryName)
      result <-
        if (zarrVersion == 2)
          accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
            dataLayerDirectoryContentsV2(datasetId, dataLayerName)
          }
        else
          Fox.fromFuture(zarrStreamingController.requestDataLayerDirectoryContents(datasetId, dataLayerName)(request))
    } yield result
  }

  def requestDataLayerMagDirectoryContentsV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      mag: String,
      zarrVersion: Int
  ): Action[AnyContent] = Action.fox { implicit request =>
    for {
      datasetId <- resolveDatasetIdFox(organizationId, datasetDirectoryName)
      result <-
        if (zarrVersion == 2)
          accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
            dataLayerMagDirectoryContentsV2(datasetId, dataLayerName, mag)
          }
        else
          Fox.fromFuture(
            zarrStreamingController.requestDataLayerMagDirectoryContents(datasetId, dataLayerName, mag)(request)
          )
    } yield result
  }

  def requestDataSourceDirectoryContentsV9(
      organizationId: String,
      datasetDirectoryName: String,
      zarrVersion: Int
  ): Action[AnyContent] = Action.fox { implicit request =>
    for {
      datasetId <- resolveDatasetIdFox(organizationId, datasetDirectoryName)
      result <-
        if (zarrVersion == 2)
          accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
            dataSourceDirectoryContentsV2(datasetId)
          }
        else Fox.fromFuture(zarrStreamingController.requestDataSourceDirectoryContents(datasetId)(request))
    } yield result
  }

  // --- datasetId-keyed routes for API v14. Unlike v5-v9 (org+datasetDirectoryName-keyed, resolved via
  // resolveDatasetIdFox), v14 already addresses datasets by datasetId, same as latest - it only needs its
  // zarrVersion-dependent behavior frozen, not any id resolution. requestZarrJson/requestZarrJsonForMag/
  // requestRawZarrCube are unaffected by this refactor, so v14's routes for those point directly at
  // ZarrStreamingController and need no wrapper here. ---

  def requestZAttrsV14(datasetId: ObjectId, dataLayerName: String = ""): Action[AnyContent] = Action.fox {
    implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(
            datasetId,
            dataLayerName
          ) ?~> Msg.Dataset.DataSource.notFound ~> NOT_FOUND
          omeNgffHeader = NgffMetadata.fromNameVoxelSizeAndMags(dataLayerName, dataSource.scale, dataLayer.sortedMags)
        } yield Ok(Json.toJson(omeNgffHeader))
      }
  }

  def requestZGroupV14(datasetId: ObjectId, dataLayerName: String = ""): Action[AnyContent] = Action.fox {
    implicit request =>
      accessTokenService.validateAccessFromTokenContextForSyncBlock(UserAccessRequest.readDataset(datasetId)) {
        Ok(zGroupJson)
      }
  }

  def requestZArrayV14(datasetId: ObjectId, dataLayerName: String, mag: String): Action[AnyContent] = Action.fox {
    implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        zArrayV2(datasetId, dataLayerName, mag)
      }
  }

  def requestDataSourceV14(datasetId: ObjectId): Action[AnyContent] = Action.fox { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        dataSource <- datasetCache.getById(datasetId) ~> NOT_FOUND
        zarrLayers = dataSource.dataLayers.map(convertLayerToZarrLayer(_, zarrVersion = 2))
        zarrSource = UsableDataSource(dataSource.id, zarrLayers, dataSource.scale)
      } yield Ok(Json.toJson(zarrSource))
    }
  }

  def requestDataLayerDirectoryContentsV14(datasetId: ObjectId, dataLayerName: String): Action[AnyContent] =
    Action.fox { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        dataLayerDirectoryContentsV2(datasetId, dataLayerName)
      }
    }

  def requestDataLayerMagDirectoryContentsV14(
      datasetId: ObjectId,
      dataLayerName: String,
      mag: String
  ): Action[AnyContent] = Action.fox { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      dataLayerMagDirectoryContentsV2(datasetId, dataLayerName, mag)
    }
  }

  def requestDataSourceDirectoryContentsV14(datasetId: ObjectId): Action[AnyContent] = Action.fox { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      dataSourceDirectoryContentsV2(datasetId)
    }
  }

  // --- Private-link (accessToken-keyed) zarr routes. These never had a versioned override before (their URL
  // shape never changed), so they are all new here. They are reused unchanged across all legacy API versions
  // that need them (v5-v9 and v14 below), matching the existing convention of reusing "V9"-suffixed methods
  // across versions whose behavior didn't change again later. Since zarr3_experimental now falls through to
  // latest's alias unchanged, these only ever serve Zarr v2. rawZarrCubePrivateLink is intentionally NOT
  // wrapped: it is unchanged and still registered directly at the same path under latest, so old versions keep
  // reaching it via the default fallthrough to datastore.latest.Routes. ---

  def zGroupPrivateLinkV9(accessToken: String, dataLayerName: String = ""): Action[AnyContent] =
    Action.fox { implicit request =>
      ifIsAnnotationLayerOrElse(
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantTokenContext) =>
          remoteTracingstoreClient
            .getZGroup(annotationLayer.tracingId, annotationSource.tracingStoreUrl)(using relevantTokenContext)
            .map(Ok(_)),
        orElse = _ => Fox.successful(Ok(zGroupJson))
      )
    }

  def zAttrsWithAnnotationPrivateLinkV9(accessToken: String, dataLayerName: String = ""): Action[AnyContent] =
    Action.fox { implicit request =>
      ifIsAnnotationLayerOrElse(
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantTokenContext) =>
          remoteTracingstoreClient
            .getOmeNgffHeader(annotationLayer.tracingId, annotationSource.tracingStoreUrl)(using relevantTokenContext)
            .map(ngffMetadata => Ok(Json.toJson(ngffMetadata))),
        orElse = annotationSource =>
          for {
            (dataSource, dataLayer) <- datasetCache
              .getWithLayer(annotationSource.datasetId, dataLayerName) ?~> Msg.Dataset.DataSource.notFound ~> NOT_FOUND
            dataSourceOmeNgffHeader = NgffMetadata
              .fromNameVoxelSizeAndMags(dataLayerName, dataSource.scale, dataLayer.sortedMags)
          } yield Ok(Json.toJson(dataSourceOmeNgffHeader))
      )
    }

  def zArrayPrivateLinkV9(accessToken: String, dataLayerName: String, mag: String): Action[AnyContent] = Action.fox {
    implicit request =>
      ifIsAnnotationLayerOrElse(
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantTokenContext) =>
          remoteTracingstoreClient
            .getZArray(annotationLayer.tracingId, mag, annotationSource.tracingStoreUrl)(using relevantTokenContext)
            .map(z => Ok(Json.toJson(z))),
        orElse = annotationSource => zArrayV2(annotationSource.datasetId, dataLayerName, mag)
      )
  }

  def dataSourceWithAnnotationPrivateLinkV9(accessToken: String): Action[AnyContent] =
    Action.fox { implicit request =>
      for {
        annotationSource <- remoteWebknossosClient.getAnnotationSource(accessToken) ~> NOT_FOUND
        relevantTokenContext =
          if (annotationSource.accessViaPrivateLink) TokenContext(Some(accessToken))
          else tokenContextForRequest
        volumeAnnotationLayers = annotationSource.annotationLayers.filter(_.typ == AnnotationLayerType.Volume)
        dataSource <- datasetCache.getById(annotationSource.datasetId) ?~> Msg.Dataset.DataSource.notFound ~> NOT_FOUND
        dataSourceLayers = dataSource.dataLayers
          .filter(dL => !volumeAnnotationLayers.exists(_.name == dL.name))
          .map(convertLayerToZarrLayer(_, zarrVersion = 2))
        annotationLayers <- Fox.serialCombined(volumeAnnotationLayers)(l =>
          remoteTracingstoreClient.getVolumeLayerAsZarrLayer(
            l.tracingId,
            Some(l.name),
            annotationSource.tracingStoreUrl,
            zarrVersion = 2
          )(using relevantTokenContext)
        )
        allLayer = dataSourceLayers ++ annotationLayers
        zarrSource = UsableDataSource(dataSource.id, allLayer, dataSource.scale)
      } yield Ok(Json.toJson(zarrSource))
    }

  def dataLayerDirectoryContentsPrivateLinkV9(accessToken: String, dataLayerName: String): Action[AnyContent] =
    Action.fox { implicit request =>
      ifIsAnnotationLayerOrElse(
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantTokenContext) =>
          remoteTracingstoreClient
            .getDataLayerDirectoryContents(
              annotationLayer.tracingId,
              annotationSource.tracingStoreUrl,
              zarrVersion = 2
            )(using
              relevantTokenContext
            )
            .map(layers =>
              Ok(
                views.html.datastoreZarrDatasourceDir(
                  "Tracingstore",
                  s"${annotationLayer.tracingId}",
                  layers
                )
              ).withHeaders()
            ),
        orElse = annotationSource => dataLayerDirectoryContentsV2(annotationSource.datasetId, dataLayerName)
      )
    }

  def dataLayerMagDirectoryContentsPrivateLinkV9(
      accessToken: String,
      dataLayerName: String,
      mag: String
  ): Action[AnyContent] =
    Action.fox { implicit request =>
      ifIsAnnotationLayerOrElse(
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantTokenContext) =>
          remoteTracingstoreClient
            .getDataLayerMagDirectoryContents(
              annotationLayer.tracingId,
              mag,
              annotationSource.tracingStoreUrl,
              zarrVersion = 2
            )(using relevantTokenContext)
            .map(layers =>
              Ok(
                views.html.datastoreZarrDatasourceDir(
                  "Combined Annotation Route",
                  s"${annotationLayer.tracingId}",
                  layers
                )
              ).withHeaders()
            ),
        orElse = annotationSource => dataLayerMagDirectoryContentsV2(annotationSource.datasetId, dataLayerName, mag)
      )
    }

  def dataSourceDirectoryContentsPrivateLinkV9(accessToken: String): Action[AnyContent] =
    Action.fox { implicit request =>
      for {
        annotationSource <- remoteWebknossosClient.getAnnotationSource(accessToken) ~> NOT_FOUND
        dataSource <- datasetCache.getById(annotationSource.datasetId) ?~> Msg.Dataset.DataSource.notFound ~> NOT_FOUND
        annotationLayerNames = annotationSource.annotationLayers.filter(_.typ == AnnotationLayerType.Volume).map(_.name)
        dataSourceLayerNames = dataSource.dataLayers
          .map((dataLayer: DataLayer) => dataLayer.name)
          .filter(!annotationLayerNames.contains(_))
        layerNames = annotationLayerNames ++ dataSourceLayerNames
        additionalEntries = List(
          UsableDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON,
          NgffGroupHeader.FILENAME_DOT_ZGROUP
        )
      } yield Ok(
        views.html.datastoreZarrDatasourceDir(
          "Combined datastore and tracingstore directory",
          s"$accessToken",
          additionalEntries ++ layerNames
        )
      )
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

  // ACTIONS

  def reloadDatasourceV9(
      organizationId: String,
      datasetDirectoryName: String,
      layerName: Option[String]
  ): Action[AnyContent] = {
    def loadFromDisk(orgaDir: Path): Fox[Result] = {
      // Dataset is not present in DB. This can be because reload was called after a dataset was written into the directory
      val dataSource =
        dataSourceService.dataSourceFromDir(orgaDir.resolve(datasetDirectoryName), organizationId, resolvePaths = true)
      dataSource match {
        case UsableDataSource(_, _, _, _, _) =>
          for {
            _ <- remoteWebknossosClient.reportDataSource(dataSource)
          } yield Ok(Json.toJson(dataSource))
        case UnusableDataSource(_, _, status, _, _) =>
          Fox.failure(s"Dataset not found in DB or in directory: $status, cannot reload.") ~> NOT_FOUND
      }
    }

    Action.fox { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.administrateDatasets(organizationId)) {
        for {
          datasetIdOpt: Option[ObjectId] <- Fox.fromFuture(
            remoteWebknossosClient.getDatasetId(organizationId, datasetDirectoryName).toFutureOption
          )
          orgaDir <- baseDirService.getOneLocalForOrga(organizationId).toFox
          result <- datasetIdOpt match {
            case Some(datasetId) =>
              // Dataset is present in DB
              for {
                dataSourceOpt: Option[UsableDataSource] <- Fox.fromFuture(
                  datasetCache.getById(datasetId).toFutureOption
                )
                // The dataset may be unusable (in which case dataSourceOpt will be None)
                r <- dataSourceOpt match {
                  case Some(_) =>
                    Fox.fromFuture(dataSourceController.reload(organizationId, datasetId, layerName)(request))
                  // Load from disk if the dataset is not usable in the DB
                  case None => loadFromDisk(orgaDir)
                }
              } yield r
            case None =>
              loadFromDisk(orgaDir)
          }
        } yield result
      }
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
}
