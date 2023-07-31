package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, TristateOptionJsonHelper}
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, ElementClass, GenericDataSource}
import io.swagger.annotations._
import models.analytics.{AnalyticsService, ChangeDatasetSettingsEvent, OpenDatasetEvent}
import models.binary._
import models.binary.explore.{
  ExploreAndAddRemoteDatasetParameters,
  ExploreRemoteDatasetParameters,
  ExploreRemoteLayerService
}
import models.organization.OrganizationDAO
import models.team.{TeamDAO, TeamService}
import models.user.{User, UserDAO, UserService}
import net.liftweb.common.{Box, Empty, Failure, Full}
import oxalis.mail.{MailchimpClient, MailchimpTag}
import oxalis.security.{URLSharing, WkEnv}
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.functional.syntax._
import play.api.libs.json._
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import utils.{ObjectId, WkConf}

import javax.inject.Inject
import scala.collection.mutable.ListBuffer
import scala.concurrent.{ExecutionContext, Future}
import com.scalableminds.util.tools.TristateOptionJsonHelper
import models.folder.FolderService

case class DatasetUpdateParameters(
    description: Option[Option[String]] = Some(None),
    displayName: Option[Option[String]] = Some(None),
    sortingKey: Option[Instant],
    isPublic: Option[Boolean],
    tags: Option[List[String]],
    folderId: Option[ObjectId]
)

object DatasetUpdateParameters extends TristateOptionJsonHelper {
  implicit val jsonFormat: OFormat[DatasetUpdateParameters] =
    Json.configured(tristateOptionParsing).format[DatasetUpdateParameters]
}

case class SegmentAnythingEmbeddingParameters(
    mag: Vec3Int,
    boundingBox: BoundingBox
)

object SegmentAnythingEmbeddingParameters {
  implicit val jsonFormat: Format[SegmentAnythingEmbeddingParameters] = Json.format[SegmentAnythingEmbeddingParameters]
}

@Api
class DataSetController @Inject()(userService: UserService,
                                  userDAO: UserDAO,
                                  dataSetService: DataSetService,
                                  dataStoreDAO: DataStoreDAO,
                                  dataSetLastUsedTimesDAO: DataSetLastUsedTimesDAO,
                                  organizationDAO: OrganizationDAO,
                                  teamDAO: TeamDAO,
                                  wKRemoteSegmentAnythingClient: WKRemoteSegmentAnythingClient,
                                  teamService: TeamService,
                                  dataSetDAO: DataSetDAO,
                                  folderService: FolderService,
                                  thumbnailService: ThumbnailService,
                                  thumbnailCachingService: ThumbnailCachingService,
                                  conf: WkConf,
                                  analyticsService: AnalyticsService,
                                  mailchimpClient: MailchimpClient,
                                  exploreRemoteLayerService: ExploreRemoteLayerService,
                                  sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller {

  private val dataSetPublicReads =
    ((__ \ 'description).readNullable[String] and
      (__ \ 'displayName).readNullable[String] and
      (__ \ 'sortingKey).readNullable[Instant] and
      (__ \ 'isPublic).read[Boolean] and
      (__ \ 'tags).read[List[String]] and
      (__ \ 'folderId).readNullable[ObjectId]).tupled

  @ApiOperation(hidden = true, value = "")
  def removeFromThumbnailCache(organizationName: String, dataSetName: String): Action[AnyContent] =
    sil.SecuredAction {
      thumbnailCachingService.removeFromCache(organizationName, dataSetName)
      Ok
    }

  @ApiOperation(hidden = true, value = "")
  def thumbnail(organizationName: String,
                dataSetName: String,
                dataLayerName: String,
                w: Option[Int],
                h: Option[Int],
                mappingName: Option[String]): Action[AnyContent] =
    sil.UserAwareAction.async { implicit request =>
      for {
        _ <- dataSetDAO.findOneByNameAndOrganizationName(dataSetName, organizationName) ?~> notFoundMessage(dataSetName) ~> NOT_FOUND // To check Access Rights
        image <- thumbnailService.getThumbnailWithCache(organizationName, dataSetName, dataLayerName, w, h, mappingName)
      } yield {
        addRemoteOriginHeaders(Ok(image)).as(jpegMimeType).withHeaders(CACHE_CONTROL -> "public, max-age=86400")
      }
    }

  @ApiOperation(hidden = true, value = "")
  def exploreRemoteDataset(): Action[List[ExploreRemoteDatasetParameters]] =
    sil.SecuredAction.async(validateJson[List[ExploreRemoteDatasetParameters]]) { implicit request =>
      val reportMutable = ListBuffer[String]()
      for {
        dataSourceBox: Box[GenericDataSource[DataLayer]] <- exploreRemoteLayerService
          .exploreRemoteDatasource(request.body, request.identity, reportMutable)
          .futureBox
        dataSourceOpt = dataSourceBox match {
          case Full(dataSource) if dataSource.dataLayers.nonEmpty =>
            reportMutable += s"Resulted in dataSource with ${dataSource.dataLayers.length} layers."
            Some(dataSource)
          case Full(_) =>
            reportMutable += "Error when exploring as layer set: Resulted in zero layers."
            None
          case f: Failure =>
            reportMutable += s"Error when exploring as layer set: ${Fox.failureChainAsString(f)}"
            None
          case Empty =>
            reportMutable += "Error when exploring as layer set: Empty"
            None
        }
      } yield Ok(Json.obj("dataSource" -> Json.toJson(dataSourceOpt), "report" -> reportMutable.mkString("\n")))
    }

  @ApiOperation(hidden = true, value = "")
  def exploreAndAddRemoteDataset(): Action[ExploreAndAddRemoteDatasetParameters] =
    sil.SecuredAction.async(validateJson[ExploreAndAddRemoteDatasetParameters]) { implicit request =>
      val reportMutable = ListBuffer[String]()
      val adaptedParameters = ExploreRemoteDatasetParameters(request.body.remoteUri, None, None)
      for {
        dataSource <- exploreRemoteLayerService.exploreRemoteDatasource(List(adaptedParameters),
                                                                        request.identity,
                                                                        reportMutable)
        _ <- bool2Fox(dataSource.dataLayers.nonEmpty) ?~> "explore.zeroLayers"
        folderIdOpt <- Fox.runOptional(request.body.folderPath)(folderPath =>
          folderService.getOrCreateFromPathLiteral(folderPath, request.identity._organization)) ?~> "explore.autoAdd.getFolder.failed"
        _ <- exploreRemoteLayerService.addRemoteDatasource(dataSource,
                                                           request.body.datasetName,
                                                           request.identity,
                                                           folderIdOpt) ?~> "explore.autoAdd.failed"
      } yield Ok
    }

  @ApiOperation(value = "List all accessible datasets.", nickname = "datasetList")
  @ApiResponses(
    Array(new ApiResponse(code = 200, message = "JSON list containing one object per resulting dataset."),
          new ApiResponse(code = 400, message = badRequestLabel)))
  def list(
      @ApiParam(value = "Optional filtering: If true, list only active datasets, if false, list only inactive datasets")
      isActive: Option[Boolean],
      @ApiParam(
        value =
          "Optional filtering: If true, list only unreported datasets (a.k.a. no longer available on the datastore), if false, list only reported datasets")
      isUnreported: Option[Boolean],
      @ApiParam(value = "Optional filtering: List only datasets of the organization specified by its url-safe name",
                example = "sample_organization")
      organizationName: Option[String],
      @ApiParam(value = "Optional filtering: List only datasets of the requesting user’s organization")
      onlyMyOrganization: Option[Boolean],
      @ApiParam(value = "Optional filtering: List only datasets uploaded by the user with this id")
      uploaderId: Option[String],
      @ApiParam(value = "Optional filtering: List only datasets in the folder with this id")
      folderId: Option[String],
      @ApiParam(
        value =
          "Optional filtering: If a folderId was specified, this parameter controls whether subfolders should be considered, too (default: false)")
      recursive: Option[Boolean],
      @ApiParam(value = "Optional filtering: List only datasets with names matching this search query")
      searchQuery: Option[String],
      @ApiParam(value = "Optional limit, return only the first n matching datasets.")
      limit: Option[Int],
      @ApiParam(value = "Change output format to return only a compact list with essential information on the datasets")
      compact: Option[Boolean]
  ): Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    for {
      folderIdValidated <- Fox.runOptional(folderId)(ObjectId.fromString)
      uploaderIdValidated <- Fox.runOptional(uploaderId)(ObjectId.fromString)
      organizationIdOpt <- if (onlyMyOrganization.getOrElse(false))
        Fox.successful(request.identity.map(_._organization))
      else
        Fox.runOptional(organizationName)(orgaName => organizationDAO.findIdByName(orgaName)(GlobalAccessContext))
      js <- if (compact.getOrElse(false)) {
        for {
          datasetInfos <- dataSetDAO.findAllCompactWithSearch(
            isActive,
            isUnreported,
            organizationIdOpt,
            folderIdValidated,
            uploaderIdValidated,
            searchQuery,
            request.identity.map(_._id),
            recursive.getOrElse(false),
            limit
          )
        } yield Json.toJson(datasetInfos)
      } else {
        for {
          dataSets <- dataSetDAO.findAllWithSearch(isActive,
                                                   isUnreported,
                                                   organizationIdOpt,
                                                   folderIdValidated,
                                                   uploaderIdValidated,
                                                   searchQuery,
                                                   recursive.getOrElse(false),
                                                   limit) ?~> "dataSet.list.failed"
          js <- listGrouped(dataSets, request.identity) ?~> "dataSet.list.failed"
        } yield Json.toJson(js)
      }
      _ = Fox.runOptional(request.identity)(user => userDAO.updateLastActivity(user._id))
    } yield addRemoteOriginHeaders(Ok(js))
  }

  private def listGrouped(datasets: List[DataSet], requestingUser: Option[User])(
      implicit ctx: DBAccessContext,
      m: MessagesProvider): Fox[List[JsObject]] =
    for {
      requestingUserTeamManagerMemberships <- Fox.runOptional(requestingUser)(user =>
        userService.teamManagerMembershipsFor(user._id))
      groupedByOrga = datasets.groupBy(_._organization).toList
      js <- Fox.serialCombined(groupedByOrga) { byOrgaTuple: (ObjectId, List[DataSet]) =>
        for {
          organization <- organizationDAO.findOne(byOrgaTuple._1)
          groupedByDataStore = byOrgaTuple._2.groupBy(_._dataStore).toList
          result <- Fox.serialCombined(groupedByDataStore) { byDataStoreTuple: (String, List[DataSet]) =>
            for {
              dataStore <- dataStoreDAO.findOneByName(byDataStoreTuple._1.trim)(GlobalAccessContext)
              resultByDataStore: Seq[JsObject] <- Fox.serialCombined(byDataStoreTuple._2) { d =>
                dataSetService.publicWrites(
                  d,
                  requestingUser,
                  Some(organization),
                  Some(dataStore),
                  requestingUserTeamManagerMemberships) ?~> Messages("dataset.list.writesFailed", d.name)
              }
            } yield resultByDataStore
          }
        } yield result.flatten
      }
    } yield js.flatten

  @ApiOperation(hidden = true, value = "")
  def accessList(organizationName: String, dataSetName: String): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        organization <- organizationDAO.findOneByName(organizationName)
        dataSet <- dataSetDAO.findOneByNameAndOrganization(dataSetName, organization._id) ?~> notFoundMessage(
          dataSetName) ~> NOT_FOUND
        allowedTeams <- teamService.allowedTeamIdsForDataset(dataSet, cumulative = true) ?~> "allowedTeams.notFound"
        usersByTeams <- userDAO.findAllByTeams(allowedTeams)
        adminsAndDatasetManagers <- userDAO.findAdminsAndDatasetManagersByOrg(organization._id)
        usersFiltered = (usersByTeams ++ adminsAndDatasetManagers).distinct.filter(!_.isUnlisted)
        usersJs <- Fox.serialCombined(usersFiltered)(u => userService.compactWrites(u))
      } yield Ok(Json.toJson(usersJs))
  }

  @ApiOperation(value = "Get information about this dataset", nickname = "datasetInfo")
  @ApiResponses(
    Array(new ApiResponse(code = 200, message = "JSON object containing dataset information"),
          new ApiResponse(code = 400, message = badRequestLabel)))
  def read(@ApiParam(value = "The url-safe name of the organization owning the dataset",
                     example = "sample_organization") organizationName: String,
           @ApiParam(value = "The name of the dataset") dataSetName: String,
           @ApiParam(value =
             "Optional sharing token allowing access to datasets your team does not normally have access to.") sharingToken: Option[
             String]): Action[AnyContent] =
    sil.UserAwareAction.async { implicit request =>
      log() {
        val ctx = URLSharing.fallbackTokenAccessContext(sharingToken)
        for {
          organization <- organizationDAO.findOneByName(organizationName)(GlobalAccessContext) ?~> Messages(
            "organization.notFound",
            organizationName)
          dataSet <- dataSetDAO.findOneByNameAndOrganization(dataSetName, organization._id)(ctx) ?~> notFoundMessage(
            dataSetName) ~> NOT_FOUND
          _ <- Fox.runOptional(request.identity)(user =>
            dataSetLastUsedTimesDAO.updateForDataSetAndUser(dataSet._id, user._id))
          // Access checked above via dataset. In case of shared dataset/annotation, show datastore even if not otherwise accessible
          dataStore <- dataSetService.dataStoreFor(dataSet)(GlobalAccessContext)
          js <- dataSetService.publicWrites(dataSet, request.identity, Some(organization), Some(dataStore))
          _ = request.identity.map { user =>
            analyticsService.track(OpenDatasetEvent(user, dataSet))
            if (dataSet.isPublic) {
              mailchimpClient.tagUser(user, MailchimpTag.HasViewedPublishedDataset)
            }
            userDAO.updateLastActivity(user._id)
          }
        } yield {
          Ok(Json.toJson(js))
        }
      }
    }

  @ApiOperation(hidden = true, value = "")
  def health(organizationName: String, dataSetName: String, sharingToken: Option[String]): Action[AnyContent] =
    sil.UserAwareAction.async { implicit request =>
      val ctx = URLSharing.fallbackTokenAccessContext(sharingToken)
      for {
        dataSet <- dataSetDAO.findOneByNameAndOrganizationName(dataSetName, organizationName)(ctx) ?~> notFoundMessage(
          dataSetName) ~> NOT_FOUND
        dataSource <- dataSetService.dataSourceFor(dataSet) ?~> "dataSource.notFound" ~> NOT_FOUND
        usableDataSource <- dataSource.toUsable.toFox ?~> "dataSet.notImported"
        datalayer <- usableDataSource.dataLayers.headOption.toFox ?~> "dataSet.noLayers"
        _ <- dataSetService
          .clientFor(dataSet)(GlobalAccessContext)
          .flatMap(_.findPositionWithData(organizationName, dataSet, datalayer.name).flatMap(posWithData =>
            bool2Fox(posWithData.value("position") != JsNull))) ?~> "dataSet.loadingDataFailed"
      } yield Ok("Ok")
    }

  @ApiOperation(
    value =
      """Update information for a dataset.
Expects:
 - As JSON object body with all optional keys (missing keys will not be updated, keys set to null will be set to null):
  - description (string, nullable)
  - displayName (string, nullable)
  - sortingKey (timestamp)
  - isPublic (boolean)
  - tags (list of string)
  - folderId (string)
 - As GET parameters:
  - organizationName (string): url-safe name of the organization owning the dataset
  - dataSetName (string): name of the dataset
""",
    nickname = "datasetUpdatePartial"
  )
  @ApiImplicitParams(
    Array(
      new ApiImplicitParam(name = "datasetPartialUpdateInformation",
                           required = true,
                           dataTypeClass = classOf[JsObject],
                           paramType = "body")))
  def updatePartial(@ApiParam(value = "The url-safe name of the organization owning the dataset",
                              example = "sample_organization") organizationName: String,
                    @ApiParam(value = "The name of the dataset") dataSetName: String): Action[DatasetUpdateParameters] =
    sil.SecuredAction.async(validateJson[DatasetUpdateParameters]) { implicit request =>
      for {
        dataSet <- dataSetDAO.findOneByNameAndOrganization(dataSetName, request.identity._organization) ?~> notFoundMessage(
          dataSetName) ~> NOT_FOUND
        _ <- Fox.assertTrue(dataSetService.isEditableBy(dataSet, Some(request.identity))) ?~> "notAllowed" ~> FORBIDDEN
        _ <- dataSetDAO.updatePartial(dataSet._id, request.body)
        updated <- dataSetDAO.findOneByNameAndOrganization(dataSetName, request.identity._organization)
        _ = analyticsService.track(ChangeDatasetSettingsEvent(request.identity, updated))
        js <- dataSetService.publicWrites(updated, Some(request.identity))
      } yield Ok(js)
    }

  @ApiOperation(
    value = """Update information for a dataset.
Expects:
 - As JSON object body with keys:
  - description (optional string)
  - displayName (optional string)
  - sortingKey (optional long)
  - isPublic (boolean)
  - tags (list of string)
  - folderId (optional string)
 - As GET parameters:
  - organizationName (string): url-safe name of the organization owning the dataset
  - dataSetName (string): name of the dataset
""",
    nickname = "datasetUpdate"
  )
  @ApiImplicitParams(
    Array(
      new ApiImplicitParam(name = "datasetUpdateInformation",
                           required = true,
                           dataTypeClass = classOf[JsObject],
                           paramType = "body")))
  def update(@ApiParam(value = "The url-safe name of the organization owning the dataset",
                       example = "sample_organization") organizationName: String,
             @ApiParam(value = "The name of the dataset") dataSetName: String): Action[JsValue] =
    sil.SecuredAction.async(parse.json) { implicit request =>
      withJsonBodyUsing(dataSetPublicReads) {
        case (description, displayName, sortingKey, isPublic, tags, folderId) =>
          for {
            dataSet <- dataSetDAO.findOneByNameAndOrganization(dataSetName, request.identity._organization) ?~> notFoundMessage(
              dataSetName) ~> NOT_FOUND
            _ <- Fox.assertTrue(dataSetService.isEditableBy(dataSet, Some(request.identity))) ?~> "notAllowed" ~> FORBIDDEN
            _ <- dataSetDAO.updateFields(dataSet._id,
                                         description,
                                         displayName,
                                         sortingKey.getOrElse(dataSet.created),
                                         isPublic,
                                         folderId.getOrElse(dataSet._folder))
            _ <- dataSetDAO.updateTags(dataSet._id, tags)
            updated <- dataSetDAO.findOneByNameAndOrganization(dataSetName, request.identity._organization)
            _ = analyticsService.track(ChangeDatasetSettingsEvent(request.identity, updated))
            js <- dataSetService.publicWrites(updated, Some(request.identity))
          } yield Ok(Json.toJson(js))
      }
    }

  @ApiOperation(
    value = """"Update teams of a dataset
Expects:
 - As JSON object body:
   List of team strings.
 - As GET parameters:
  - organizationName (string): url-safe name of the organization owning the dataset
  - dataSetName (string): name of the dataset
""",
    nickname = "datasetUpdateTeams"
  )
  @ApiImplicitParams(
    Array(
      new ApiImplicitParam(name = "datasetUpdateTeamsInformation",
                           required = true,
                           dataType = "com.scalableminds.util.swaggerhelpers.ListOfString",
                           paramType = "body")))
  def updateTeams(@ApiParam(value = "The url-safe name of the organization owning the dataset",
                            example = "sample_organization") organizationName: String,
                  @ApiParam(value = "The name of the dataset") dataSetName: String): Action[List[ObjectId]] =
    sil.SecuredAction.async(validateJson[List[ObjectId]]) { implicit request =>
      for {
        dataSet <- dataSetDAO.findOneByNameAndOrganizationName(dataSetName, organizationName) ?~> notFoundMessage(
          dataSetName) ~> NOT_FOUND
        _ <- Fox.assertTrue(dataSetService.isEditableBy(dataSet, Some(request.identity))) ?~> "notAllowed" ~> FORBIDDEN
        includeMemberOnlyTeams = request.identity.isDatasetManager
        userTeams <- if (includeMemberOnlyTeams) teamDAO.findAll else teamDAO.findAllEditable
        oldAllowedTeams <- teamService.allowedTeamIdsForDataset(dataSet, cumulative = false) ?~> "allowedTeams.notFound"
        teamsWithoutUpdate = oldAllowedTeams.filterNot(t => userTeams.exists(_._id == t))
        teamsWithUpdate = request.body.filter(t => userTeams.exists(_._id == t))
        newTeams = (teamsWithUpdate ++ teamsWithoutUpdate).distinct
        _ <- teamDAO.updateAllowedTeamsForDataset(dataSet._id, newTeams)
      } yield Ok(Json.toJson(newTeams))
    }

  @ApiOperation(value = "Sharing token of a dataset", nickname = "datasetSharingToken")
  @ApiResponses(
    Array(
      new ApiResponse(code = 200,
                      message = "JSON object containing the key sharingToken with the sharing token string."),
      new ApiResponse(code = 400, message = badRequestLabel)
    ))
  def getSharingToken(@ApiParam(value = "The url-safe name of the organization owning the dataset",
                                example = "sample_organization") organizationName: String,
                      @ApiParam(value = "The name of the dataset") dataSetName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        organization <- organizationDAO.findOneByName(organizationName)
        _ <- bool2Fox(organization._id == request.identity._organization) ~> FORBIDDEN
        token <- dataSetService.getSharingToken(dataSetName, organization._id)
      } yield Ok(Json.obj("sharingToken" -> token.trim))
    }

  @ApiOperation(hidden = true, value = "")
  def deleteSharingToken(organizationName: String, dataSetName: String): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        organization <- organizationDAO.findOneByName(organizationName)
        _ <- bool2Fox(organization._id == request.identity._organization) ~> FORBIDDEN
        _ <- dataSetDAO.updateSharingTokenByName(dataSetName, organization._id, None)
      } yield Ok
  }

  @ApiOperation(hidden = true, value = "")
  def create(typ: String): Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    Future.successful(JsonBadRequest(Messages("dataSet.type.invalid", typ)))
  }

  @ApiOperation(value = "Check whether a new dataset name is valid", nickname = "newDatasetNameIsValid")
  @ApiResponses(
    Array(new ApiResponse(code = 200, message = "Name is valid. Empty message."),
          new ApiResponse(code = 400, message = badRequestLabel)))
  def isValidNewName(@ApiParam(value = "The url-safe name of the organization owning the dataset",
                               example = "sample_organization") organizationName: String,
                     @ApiParam(value = "The name of the dataset") dataSetName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        organization <- organizationDAO.findOneByName(organizationName)
        _ <- bool2Fox(organization._id == request.identity._organization) ~> FORBIDDEN
        _ <- dataSetService.assertValidDataSetName(dataSetName)
        _ <- dataSetService.assertNewDataSetName(dataSetName, organization._id) ?~> "dataSet.name.alreadyTaken"
      } yield Ok
    }

  @ApiOperation(hidden = true, value = "")
  def getOrganizationForDataSet(dataSetName: String): Action[AnyContent] = sil.UserAwareAction.async {
    implicit request =>
      for {
        organizationId <- dataSetDAO.getOrganizationForDataSet(dataSetName)
        organization <- organizationDAO.findOne(organizationId)
      } yield Ok(Json.obj("organizationName" -> organization.name))
  }

  @ApiOperation(hidden = true, value = "")
  private def notFoundMessage(dataSetName: String)(implicit ctx: DBAccessContext, m: MessagesProvider): String =
    ctx.data match {
      case Some(_: User) => Messages("dataSet.notFound", dataSetName)
      case _             => Messages("dataSet.notFoundConsiderLogin", dataSetName)
    }

  @ApiOperation(hidden = true, value = "")
  def segmentAnythingEmbedding(organizationName: String,
                               dataSetName: String,
                               dataLayerName: String,
                               intensityMin: Option[Float],
                               intensityMax: Option[Float]): Action[SegmentAnythingEmbeddingParameters] =
    sil.SecuredAction.async(validateJson[SegmentAnythingEmbeddingParameters]) { implicit request =>
      log() {
        for {
          _ <- bool2Fox(conf.Features.segmentAnythingEnabled) ?~> "segmentAnything.notEnabled"
          _ <- bool2Fox(conf.SegmentAnything.uri.nonEmpty) ?~> "segmentAnything.noUri"
          dataset <- dataSetDAO.findOneByNameAndOrganizationName(dataSetName, organizationName) ?~> notFoundMessage(
            dataSetName) ~> NOT_FOUND
          dataSource <- dataSetService.dataSourceFor(dataset) ?~> "dataSource.notFound" ~> NOT_FOUND
          usableDataSource <- dataSource.toUsable ?~> "dataSet.notImported"
          dataLayer <- usableDataSource.dataLayers.find(_.name == dataLayerName) ?~> "dataSet.noLayers"
          datastoreClient <- dataSetService.clientFor(dataset)(GlobalAccessContext)
          targetMagBbox: BoundingBox = request.body.boundingBox / request.body.mag
          _ <- bool2Fox(targetMagBbox.dimensions.sorted == Vec3Int(1, 1024, 1024)) ?~> s"Target-mag bbox must be sized 1024×1024×1 (or transposed), got ${targetMagBbox.dimensions}"
          data <- datastoreClient.getLayerData(organizationName,
                                               dataset,
                                               dataLayer.name,
                                               request.body.boundingBox,
                                               request.body.mag) ?~> "segmentAnything.getData.failed"
          _ = logger.debug(
            s"Sending ${data.length} bytes to SAM server, element class is ${dataLayer.elementClass}, range: $intensityMin-$intensityMax...")
          _ <- bool2Fox(
            !(dataLayer.elementClass == ElementClass.float || dataLayer.elementClass == ElementClass.double) || (intensityMin.isDefined && intensityMax.isDefined)) ?~> "For float and double data, a supplied intensity range is required."
          embedding <- wKRemoteSegmentAnythingClient.getEmbedding(
            data,
            dataLayer.elementClass,
            intensityMin,
            intensityMax) ?~> "segmentAnything.getEmbedding.failed"
          _ = logger.debug(
            s"Received ${embedding.length} bytes of embedding from SAM server, forwarding to front-end...")
        } yield Ok(embedding)
      }
    }

}
