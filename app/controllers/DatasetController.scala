package controllers

import play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, TristateOptionJsonHelper}
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, ElementClass, GenericDataSource}
import models.analytics.{AnalyticsService, ChangeDatasetSettingsEvent, OpenDatasetEvent}
import models.dataset._
import models.dataset.explore.{
  ExploreAndAddRemoteDatasetParameters,
  ExploreRemoteDatasetParameters,
  ExploreRemoteLayerService
}
import models.organization.OrganizationDAO
import models.team.{TeamDAO, TeamService}
import models.user.{User, UserDAO, UserService}
import net.liftweb.common.{Box, Empty, Failure, Full}
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.functional.syntax._
import play.api.libs.json._
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import utils.{ObjectId, WkConf}

import javax.inject.Inject
import scala.collection.mutable.ListBuffer
import scala.concurrent.{ExecutionContext, Future}
import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate
import mail.{MailchimpClient, MailchimpTag}
import models.folder.FolderService
import security.{URLSharing, WkEnv}

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
    boundingBox: BoundingBox,
    additionalCoordinates: Option[Seq[AdditionalCoordinate]] = None
)

object SegmentAnythingEmbeddingParameters {
  implicit val jsonFormat: Format[SegmentAnythingEmbeddingParameters] = Json.format[SegmentAnythingEmbeddingParameters]
}

class DatasetController @Inject()(userService: UserService,
                                  userDAO: UserDAO,
                                  datasetService: DatasetService,
                                  dataStoreDAO: DataStoreDAO,
                                  datasetLastUsedTimesDAO: DatasetLastUsedTimesDAO,
                                  organizationDAO: OrganizationDAO,
                                  teamDAO: TeamDAO,
                                  wKRemoteSegmentAnythingClient: WKRemoteSegmentAnythingClient,
                                  teamService: TeamService,
                                  datasetDAO: DatasetDAO,
                                  folderService: FolderService,
                                  thumbnailService: ThumbnailService,
                                  thumbnailCachingService: ThumbnailCachingService,
                                  conf: WkConf,
                                  analyticsService: AnalyticsService,
                                  mailchimpClient: MailchimpClient,
                                  exploreRemoteLayerService: ExploreRemoteLayerService,
                                  sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller {

  private val datasetPublicReads =
    ((__ \ "description").readNullable[String] and
      (__ \ "displayName").readNullable[String] and
      (__ \ "sortingKey").readNullable[Instant] and
      (__ \ "isPublic").read[Boolean] and
      (__ \ "tags").read[List[String]] and
      (__ \ "folderId").readNullable[ObjectId]).tupled

  def removeFromThumbnailCache(organizationName: String, datasetName: String): Action[AnyContent] =
    sil.SecuredAction {
      thumbnailCachingService.removeFromCache(organizationName, datasetName)
      Ok
    }

  def thumbnail(organizationName: String,
                datasetName: String,
                dataLayerName: String,
                w: Option[Int],
                h: Option[Int],
                mappingName: Option[String],
                sharingToken: Option[String]): Action[AnyContent] =
    sil.UserAwareAction.async { implicit request =>
      val ctx = URLSharing.fallbackTokenAccessContext(sharingToken)
      for {
        _ <- datasetDAO.findOneByNameAndOrganizationName(datasetName, organizationName)(ctx) ?~> notFoundMessage(
          datasetName) ~> NOT_FOUND // To check Access Rights
        image <- thumbnailService.getThumbnailWithCache(organizationName, datasetName, dataLayerName, w, h, mappingName)
      } yield {
        addRemoteOriginHeaders(Ok(image)).as(jpegMimeType).withHeaders(CACHE_CONTROL -> "public, max-age=86400")
      }
    }

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

  // Note: This route is used by external applications, keep stable
  def exploreAndAddRemoteDataset(): Action[ExploreAndAddRemoteDatasetParameters] =
    sil.SecuredAction.async(validateJson[ExploreAndAddRemoteDatasetParameters]) { implicit request =>
      val reportMutable = ListBuffer[String]()
      val adaptedParameters = ExploreRemoteDatasetParameters(request.body.remoteUri, None, None, None)
      for {
        dataSource <- exploreRemoteLayerService.exploreRemoteDatasource(List(adaptedParameters),
                                                                        request.identity,
                                                                        reportMutable)
        _ <- bool2Fox(dataSource.dataLayers.nonEmpty) ?~> "dataset.explore.zeroLayers"
        folderIdOpt <- Fox.runOptional(request.body.folderPath)(folderPath =>
          folderService.getOrCreateFromPathLiteral(folderPath, request.identity._organization)) ?~> "dataset.explore.autoAdd.getFolder.failed"
        _ <- exploreRemoteLayerService.addRemoteDatasource(dataSource,
                                                           request.body.datasetName,
                                                           request.identity,
                                                           folderIdOpt) ?~> "dataset.explore.autoAdd.failed"
      } yield Ok
    }

  // List all accessible datasets (list of json objects, one per dataset)
  def list(
      // Optional filtering: If true, list only active datasets, if false, list only inactive datasets
      isActive: Option[Boolean],
      // Optional filtering: If true, list only unreported datasets (a.k.a. no longer available on the datastore), if false, list only reported datasets
      isUnreported: Option[Boolean],
      // Optional filtering: List only datasets of the organization specified by its url-safe name, e.g. sample_organization
      organizationName: Option[String],
      // Optional filtering: List only datasets of the requesting user’s organization
      onlyMyOrganization: Option[Boolean],
      // Optional filtering: List only datasets uploaded by the user with this id
      uploaderId: Option[String],
      // Optional filtering: List only datasets in the folder with this id
      folderId: Option[String],
      // Optional filtering: If a folderId was specified, this parameter controls whether subfolders should be considered, too (default: false)
      recursive: Option[Boolean],
      // Optional filtering: List only datasets with names matching this search query
      searchQuery: Option[String],
      // return only the first n matching datasets.
      limit: Option[Int],
      // Change output format to return only a compact list with essential information on the datasets
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
          datasetInfos <- datasetDAO.findAllCompactWithSearch(
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
          datasets <- datasetDAO.findAllWithSearch(isActive,
                                                   isUnreported,
                                                   organizationIdOpt,
                                                   folderIdValidated,
                                                   uploaderIdValidated,
                                                   searchQuery,
                                                   recursive.getOrElse(false),
                                                   limit) ?~> "dataset.list.failed"
          js <- listGrouped(datasets, request.identity) ?~> "dataset.list.failed"
        } yield Json.toJson(js)
      }
      _ = Fox.runOptional(request.identity)(user => userDAO.updateLastActivity(user._id))
    } yield addRemoteOriginHeaders(Ok(js))
  }

  private def listGrouped(datasets: List[Dataset], requestingUser: Option[User])(
      implicit ctx: DBAccessContext,
      m: MessagesProvider): Fox[List[JsObject]] =
    for {
      requestingUserTeamManagerMemberships <- Fox.runOptional(requestingUser)(user =>
        userService.teamManagerMembershipsFor(user._id))
      groupedByOrga = datasets.groupBy(_._organization).toList
      js <- Fox.serialCombined(groupedByOrga) { byOrgaTuple: (ObjectId, List[Dataset]) =>
        for {
          organization <- organizationDAO.findOne(byOrgaTuple._1)
          groupedByDataStore = byOrgaTuple._2.groupBy(_._dataStore).toList
          result <- Fox.serialCombined(groupedByDataStore) { byDataStoreTuple: (String, List[Dataset]) =>
            for {
              dataStore <- dataStoreDAO.findOneByName(byDataStoreTuple._1.trim)(GlobalAccessContext)
              resultByDataStore: Seq[JsObject] <- Fox.serialCombined(byDataStoreTuple._2) { d =>
                datasetService.publicWrites(
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

  def accessList(organizationName: String, datasetName: String): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        organization <- organizationDAO.findOneByName(organizationName)
        dataset <- datasetDAO.findOneByNameAndOrganization(datasetName, organization._id) ?~> notFoundMessage(
          datasetName) ~> NOT_FOUND
        allowedTeams <- teamService.allowedTeamIdsForDataset(dataset, cumulative = true) ?~> "allowedTeams.notFound"
        usersByTeams <- userDAO.findAllByTeams(allowedTeams)
        adminsAndDatasetManagers <- userDAO.findAdminsAndDatasetManagersByOrg(organization._id)
        usersFiltered = (usersByTeams ++ adminsAndDatasetManagers).distinct.filter(!_.isUnlisted)
        usersJs <- Fox.serialCombined(usersFiltered)(u => userService.compactWrites(u))
      } yield Ok(Json.toJson(usersJs))
  }

  def read(organizationName: String,
           datasetName: String,
           // Optional sharing token allowing access to datasets your team does not normally have access to.")
           sharingToken: Option[String]): Action[AnyContent] =
    sil.UserAwareAction.async { implicit request =>
      log() {
        val ctx = URLSharing.fallbackTokenAccessContext(sharingToken)
        for {
          organization <- organizationDAO.findOneByName(organizationName)(GlobalAccessContext) ?~> Messages(
            "organization.notFound",
            organizationName)
          dataset <- datasetDAO.findOneByNameAndOrganization(datasetName, organization._id)(ctx) ?~> notFoundMessage(
            datasetName) ~> NOT_FOUND
          _ <- Fox.runOptional(request.identity)(user =>
            datasetLastUsedTimesDAO.updateForDatasetAndUser(dataset._id, user._id))
          // Access checked above via dataset. In case of shared dataset/annotation, show datastore even if not otherwise accessible
          dataStore <- datasetService.dataStoreFor(dataset)(GlobalAccessContext)
          js <- datasetService.publicWrites(dataset, request.identity, Some(organization), Some(dataStore))
          _ = request.identity.map { user =>
            analyticsService.track(OpenDatasetEvent(user, dataset))
            if (dataset.isPublic) {
              mailchimpClient.tagUser(user, MailchimpTag.HasViewedPublishedDataset)
            }
            userDAO.updateLastActivity(user._id)
          }
        } yield {
          Ok(Json.toJson(js))
        }
      }
    }

  def health(organizationName: String, datasetName: String, sharingToken: Option[String]): Action[AnyContent] =
    sil.UserAwareAction.async { implicit request =>
      val ctx = URLSharing.fallbackTokenAccessContext(sharingToken)
      for {
        dataset <- datasetDAO.findOneByNameAndOrganizationName(datasetName, organizationName)(ctx) ?~> notFoundMessage(
          datasetName) ~> NOT_FOUND
        dataSource <- datasetService.dataSourceFor(dataset) ?~> "dataSource.notFound" ~> NOT_FOUND
        usableDataSource <- dataSource.toUsable.toFox ?~> "dataset.notImported"
        datalayer <- usableDataSource.dataLayers.headOption.toFox ?~> "dataset.noLayers"
        _ <- datasetService
          .clientFor(dataset)(GlobalAccessContext)
          .flatMap(_.findPositionWithData(organizationName, dataset, datalayer.name).flatMap(posWithData =>
            bool2Fox(posWithData.value("position") != JsNull))) ?~> "dataset.loadingDataFailed"
      } yield Ok("Ok")
    }

  def updatePartial(organizationName: String, datasetName: String): Action[DatasetUpdateParameters] =
    sil.SecuredAction.async(validateJson[DatasetUpdateParameters]) { implicit request =>
      for {
        dataset <- datasetDAO.findOneByNameAndOrganization(datasetName, request.identity._organization) ?~> notFoundMessage(
          datasetName) ~> NOT_FOUND
        _ <- Fox.assertTrue(datasetService.isEditableBy(dataset, Some(request.identity))) ?~> "notAllowed" ~> FORBIDDEN
        _ <- datasetDAO.updatePartial(dataset._id, request.body)
        updated <- datasetDAO.findOneByNameAndOrganization(datasetName, request.identity._organization)
        _ = analyticsService.track(ChangeDatasetSettingsEvent(request.identity, updated))
        js <- datasetService.publicWrites(updated, Some(request.identity))
      } yield Ok(js)
    }

  // Note that there exists also updatePartial (which will only expect the changed fields)
  def update(organizationName: String, datasetName: String): Action[JsValue] =
    sil.SecuredAction.async(parse.json) { implicit request =>
      withJsonBodyUsing(datasetPublicReads) {
        case (description, displayName, sortingKey, isPublic, tags, folderId) =>
          for {
            dataset <- datasetDAO.findOneByNameAndOrganization(datasetName, request.identity._organization) ?~> notFoundMessage(
              datasetName) ~> NOT_FOUND
            _ <- Fox.assertTrue(datasetService.isEditableBy(dataset, Some(request.identity))) ?~> "notAllowed" ~> FORBIDDEN
            _ <- datasetDAO.updateFields(dataset._id,
                                         description,
                                         displayName,
                                         sortingKey.getOrElse(dataset.created),
                                         isPublic,
                                         folderId.getOrElse(dataset._folder))
            _ <- datasetDAO.updateTags(dataset._id, tags)
            updated <- datasetDAO.findOneByNameAndOrganization(datasetName, request.identity._organization)
            _ = analyticsService.track(ChangeDatasetSettingsEvent(request.identity, updated))
            js <- datasetService.publicWrites(updated, Some(request.identity))
          } yield Ok(Json.toJson(js))
      }
    }

  def updateTeams(organizationName: String, datasetName: String): Action[List[ObjectId]] =
    sil.SecuredAction.async(validateJson[List[ObjectId]]) { implicit request =>
      for {
        dataset <- datasetDAO.findOneByNameAndOrganizationName(datasetName, organizationName) ?~> notFoundMessage(
          datasetName) ~> NOT_FOUND
        _ <- Fox.assertTrue(datasetService.isEditableBy(dataset, Some(request.identity))) ?~> "notAllowed" ~> FORBIDDEN
        includeMemberOnlyTeams = request.identity.isDatasetManager
        userTeams <- if (includeMemberOnlyTeams) teamDAO.findAll else teamDAO.findAllEditable
        oldAllowedTeams <- teamService.allowedTeamIdsForDataset(dataset, cumulative = false) ?~> "allowedTeams.notFound"
        teamsWithoutUpdate = oldAllowedTeams.filterNot(t => userTeams.exists(_._id == t))
        teamsWithUpdate = request.body.filter(t => userTeams.exists(_._id == t))
        newTeams = (teamsWithUpdate ++ teamsWithoutUpdate).distinct
        _ <- teamDAO.updateAllowedTeamsForDataset(dataset._id, newTeams)
      } yield Ok(Json.toJson(newTeams))
    }

  def getSharingToken(organizationName: String, datasetName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        organization <- organizationDAO.findOneByName(organizationName)
        _ <- bool2Fox(organization._id == request.identity._organization) ~> FORBIDDEN
        token <- datasetService.getSharingToken(datasetName, organization._id)
      } yield Ok(Json.obj("sharingToken" -> token.trim))
    }

  def deleteSharingToken(organizationName: String, datasetName: String): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        organization <- organizationDAO.findOneByName(organizationName)
        _ <- bool2Fox(organization._id == request.identity._organization) ~> FORBIDDEN
        _ <- datasetDAO.updateSharingTokenByName(datasetName, organization._id, None)
      } yield Ok
  }

  def create(typ: String): Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    Future.successful(JsonBadRequest(Messages("dataset.type.invalid", typ)))
  }

  def isValidNewName(organizationName: String, datasetName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        organization <- organizationDAO.findOneByName(organizationName)
        _ <- bool2Fox(organization._id == request.identity._organization) ~> FORBIDDEN
        validName <- datasetService.assertValidDatasetName(datasetName).futureBox
        nameAlreadyExists <- (datasetService.assertNewDatasetName(datasetName, organization._id) ?~> "dataset.name.alreadyTaken").futureBox
        errors = combineErrors(List(validName, nameAlreadyExists))
        valid = validName.isDefined && nameAlreadyExists.isDefined
      } yield
        errors match {
          case Some(e) => Ok(Json.obj("isValid" -> valid, "errors" -> e.map(Messages(_))))
          case None    => Ok(Json.obj("isValid" -> valid))
        }
    }

  def getOrganizationForDataset(datasetName: String): Action[AnyContent] = sil.UserAwareAction.async {
    implicit request =>
      for {
        organizationId <- datasetDAO.getOrganizationForDataset(datasetName)
        organization <- organizationDAO.findOne(organizationId)
      } yield Ok(Json.obj("organizationName" -> organization.name))
  }

  private def notFoundMessage(datasetName: String)(implicit ctx: DBAccessContext, m: MessagesProvider): String =
    ctx.data match {
      case Some(_: User) => Messages("dataset.notFound", datasetName)
      case _             => Messages("dataset.notFoundConsiderLogin", datasetName)
    }

  def segmentAnythingEmbedding(organizationName: String,
                               datasetName: String,
                               dataLayerName: String,
                               intensityMin: Option[Float],
                               intensityMax: Option[Float]): Action[SegmentAnythingEmbeddingParameters] =
    sil.SecuredAction.async(validateJson[SegmentAnythingEmbeddingParameters]) { implicit request =>
      log() {
        for {
          _ <- bool2Fox(conf.Features.segmentAnythingEnabled) ?~> "segmentAnything.notEnabled"
          _ <- bool2Fox(conf.SegmentAnything.uri.nonEmpty) ?~> "segmentAnything.noUri"
          dataset <- datasetDAO.findOneByNameAndOrganizationName(datasetName, organizationName) ?~> notFoundMessage(
            datasetName) ~> NOT_FOUND
          dataSource <- datasetService.dataSourceFor(dataset) ?~> "dataSource.notFound" ~> NOT_FOUND
          usableDataSource <- dataSource.toUsable ?~> "dataset.notImported"
          dataLayer <- usableDataSource.dataLayers.find(_.name == dataLayerName) ?~> "dataset.noLayers"
          datastoreClient <- datasetService.clientFor(dataset)(GlobalAccessContext)
          targetMagBbox: BoundingBox = request.body.boundingBox / request.body.mag
          _ <- bool2Fox(targetMagBbox.size.sorted == Vec3Int(1, 1024, 1024)) ?~> s"Target-mag bbox must be sized 1024×1024×1 (or transposed), got ${targetMagBbox.size}"
          data <- datastoreClient.getLayerData(organizationName,
                                               dataset,
                                               dataLayer.name,
                                               request.body.boundingBox,
                                               request.body.mag,
                                               request.body.additionalCoordinates) ?~> "segmentAnything.getData.failed"
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
