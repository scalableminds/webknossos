package controllers

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, TristateOptionJsonHelper}
import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import mail.{MailchimpClient, MailchimpTag}
import models.analytics.{AnalyticsService, ChangeDatasetSettingsEvent, OpenDatasetEvent}
import models.dataset._
import models.dataset.explore.{
  ExploreAndAddRemoteDatasetParameters,
  WKExploreRemoteLayerParameters,
  WKExploreRemoteLayerService
}
import models.folder.FolderService
import models.organization.OrganizationDAO
import models.team.{TeamDAO, TeamService}
import models.user.{User, UserDAO, UserService}
import com.scalableminds.util.tools.{Empty, Failure, Full}
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.functional.syntax._
import play.api.libs.json._
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import play.silhouette.api.Silhouette
import security.{AccessibleBySwitchingService, URLSharing, WkEnv}
import utils.{MetadataAssertions, WkConf}

import javax.inject.Inject
import scala.concurrent.{ExecutionContext, Future}

case class DatasetUpdateParameters(
    description: Option[Option[String]] = Some(None),
    name: Option[Option[String]] = Some(None),
    sortingKey: Option[Instant],
    isPublic: Option[Boolean],
    tags: Option[List[String]],
    metadata: Option[JsArray],
    folderId: Option[ObjectId]
)

object DatasetUpdateParameters extends TristateOptionJsonHelper {
  implicit val jsonFormat: OFormat[DatasetUpdateParameters] =
    Json.configured(tristateOptionParsing).format[DatasetUpdateParameters]
}

object SAMInteractionType extends ExtendedEnumeration {
  type SAMInteractionType = Value
  val BOUNDING_BOX, POINT = Value
}

case class SegmentAnythingMaskParameters(
    mag: Vec3Int,
    surroundingBoundingBox: BoundingBox, // in mag1 (when converted to target mag, size must be 1024×1024×depth with depth <= 12)
    additionalCoordinates: Option[Seq[AdditionalCoordinate]] = None,
    interactionType: SAMInteractionType.SAMInteractionType,
    // selectionTopLeft and selectionBottomRight are required as input in case of bounding box interaction type.
    // Else pointX and pointY are required.
    selectionTopLeftX: Option[Int], // in target-mag, relative to paddedBoundingBox topleft
    selectionTopLeftY: Option[Int],
    selectionBottomRightX: Option[Int],
    selectionBottomRightY: Option[Int],
    pointX: Option[Int], // in target-mag, relative to paddedBoundingBox topleft
    pointY: Option[Int],
)

object SegmentAnythingMaskParameters {
  implicit val jsonFormat: Format[SegmentAnythingMaskParameters] = Json.format[SegmentAnythingMaskParameters]
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
                                  authenticationService: AccessibleBySwitchingService,
                                  analyticsService: AnalyticsService,
                                  mailchimpClient: MailchimpClient,
                                  wkExploreRemoteLayerService: WKExploreRemoteLayerService,
                                  sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with MetadataAssertions {

  private val datasetPublicReads =
    ((__ \ "description").readNullable[String] and
      (__ \ "name").readNullable[String] and
      (__ \ "displayName").readNullable[String] and
      (__ \ "sortingKey").readNullable[Instant] and
      (__ \ "isPublic").read[Boolean] and
      (__ \ "tags").read[List[String]] and
      (__ \ "metadata").readNullable[JsArray] and
      (__ \ "folderId").readNullable[ObjectId]).tupled

  def removeFromThumbnailCache(datasetId: ObjectId): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        _ <- thumbnailCachingService.removeFromCache(datasetId)
      } yield Ok
    }

  def thumbnail(datasetId: ObjectId,
                dataLayerName: String,
                w: Option[Int],
                h: Option[Int],
                mappingName: Option[String],
                sharingToken: Option[String]): Action[AnyContent] =
    sil.UserAwareAction.async { implicit request =>
      val ctx = URLSharing.fallbackTokenAccessContext(sharingToken)
      for {
        _ <- datasetDAO.findOne(datasetId)(ctx) ?~> notFoundMessage(datasetId.toString) ~> NOT_FOUND // To check Access Rights
        image <- thumbnailService.getThumbnailWithCache(datasetId, dataLayerName, w, h, mappingName)
      } yield {
        addRemoteOriginHeaders(Ok(image)).as(jpegMimeType).withHeaders(CACHE_CONTROL -> "public, max-age=86400")
      }
    }

  def exploreRemoteDataset(): Action[List[WKExploreRemoteLayerParameters]] =
    sil.SecuredAction.async(validateJson[List[WKExploreRemoteLayerParameters]]) { implicit request =>
      for {
        exploreResponse <- wkExploreRemoteLayerService.exploreRemoteDatasource(request.body, request.identity)
      } yield Ok(Json.toJson(exploreResponse))
    }

  // Note: This route is used by external applications, keep stable
  def exploreAndAddRemoteDataset(): Action[ExploreAndAddRemoteDatasetParameters] =
    sil.SecuredAction.async(validateJson[ExploreAndAddRemoteDatasetParameters]) { implicit request =>
      val adaptedParameters =
        WKExploreRemoteLayerParameters(request.body.remoteUri, None, None, None, request.body.dataStoreName)
      for {
        exploreResponse <- wkExploreRemoteLayerService.exploreRemoteDatasource(List(adaptedParameters),
                                                                               request.identity)
        dataSource <- exploreResponse.dataSource.toFox ?~> "dataset.explore.failed"
        _ <- Fox.fromBool(dataSource.dataLayers.nonEmpty) ?~> "dataset.explore.zeroLayers"
        folderIdOpt <- Fox.runOptional(request.body.folderPath)(folderPath =>
          folderService.getOrCreateFromPathLiteral(folderPath, request.identity._organization)) ?~> "dataset.explore.autoAdd.getFolder.failed"
        _ <- wkExploreRemoteLayerService.addRemoteDatasource(dataSource,
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
      organizationId: Option[String],
      // Optional filtering: List only datasets of the requesting user’s organization
      onlyMyOrganization: Option[Boolean],
      // Optional filtering: List only datasets uploaded by the user with this id
      uploaderId: Option[ObjectId],
      // Optional filtering: List only datasets in the folder with this id
      folderId: Option[ObjectId],
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
      _ <- Fox.successful(())
      organizationIdOpt = if (onlyMyOrganization.getOrElse(false))
        request.identity.map(_._organization)
      else
        organizationId
      js <- if (compact.getOrElse(false)) {
        for {
          datasetInfos <- datasetDAO.findAllCompactWithSearch(
            isActive,
            isUnreported,
            organizationIdOpt,
            folderId,
            uploaderId,
            searchQuery,
            request.identity.map(_._id),
            recursive.getOrElse(false),
            limitOpt = limit
          )
        } yield Json.toJson(datasetInfos)
      } else {
        for {
          datasets <- datasetDAO.findAllWithSearch(isActive,
                                                   isUnreported,
                                                   organizationIdOpt,
                                                   folderId,
                                                   uploaderId,
                                                   searchQuery,
                                                   recursive.getOrElse(false),
                                                   limit) ?~> "dataset.list.failed"
          js <- listGrouped(datasets, request.identity) ?~> "dataset.list.grouping.failed"
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
      js <- Fox.serialCombined(groupedByOrga) { byOrgaTuple: (String, List[Dataset]) =>
        for {
          organization <- organizationDAO.findOne(byOrgaTuple._1)(GlobalAccessContext) ?~> "organization.notFound"
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

  def accessList(datasetId: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      dataset <- datasetDAO.findOne(datasetId) ?~> notFoundMessage(datasetId.toString) ~> NOT_FOUND
      organization <- organizationDAO.findOne(dataset._organization)
      allowedTeams <- teamService.allowedTeamIdsForDataset(dataset, cumulative = true) ?~> "allowedTeams.notFound"
      usersByTeams <- userDAO.findAllByTeams(allowedTeams)
      adminsAndDatasetManagers <- userDAO.findAdminsAndDatasetManagersByOrg(organization._id)
      usersFiltered = (usersByTeams ++ adminsAndDatasetManagers).distinct.filter(!_.isUnlisted)
      usersJs <- Fox.serialCombined(usersFiltered)(u => userService.compactWrites(u))
    } yield Ok(Json.toJson(usersJs))
  }

  def read(datasetId: ObjectId,
           // Optional sharing token allowing access to datasets your team does not normally have access to.")
           sharingToken: Option[String]): Action[AnyContent] =
    sil.UserAwareAction.async { implicit request =>
      log() {
        val ctx = URLSharing.fallbackTokenAccessContext(sharingToken)
        for {
          dataset <- datasetDAO.findOne(datasetId)(ctx) ?~> notFoundMessage(datasetId.toString) ~> NOT_FOUND
          organization <- organizationDAO.findOne(dataset._organization)(GlobalAccessContext) ~> NOT_FOUND
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

  def health(datasetId: ObjectId, sharingToken: Option[String]): Action[AnyContent] =
    sil.UserAwareAction.async { implicit request =>
      val ctx = URLSharing.fallbackTokenAccessContext(sharingToken)
      for {
        dataset <- datasetDAO.findOne(datasetId)(ctx) ?~> notFoundMessage(datasetId.toString) ~> NOT_FOUND
        dataSource <- datasetService.dataSourceFor(dataset) ?~> "dataSource.notFound" ~> NOT_FOUND
        usableDataSource <- dataSource.toUsable.toFox ?~> "dataset.notImported"
        datalayer <- usableDataSource.dataLayers.headOption.toFox ?~> "dataset.noLayers"
        _ <- datasetService
          .clientFor(dataset)(GlobalAccessContext)
          .flatMap(_.findPositionWithData(dataset, datalayer.name).flatMap(posWithData =>
            Fox.fromBool(posWithData.value("position") != JsNull))) ?~> "dataset.loadingDataFailed"
      } yield Ok("Ok")
    }

  def updatePartial(datasetId: ObjectId): Action[DatasetUpdateParameters] =
    sil.SecuredAction.async(validateJson[DatasetUpdateParameters]) { implicit request =>
      for {
        dataset <- datasetDAO.findOne(datasetId) ?~> notFoundMessage(datasetId.toString) ~> NOT_FOUND
        _ <- Fox.assertTrue(datasetService.isEditableBy(dataset, Some(request.identity))) ?~> "notAllowed" ~> FORBIDDEN
        _ <- Fox.runOptional(request.body.metadata)(assertNoDuplicateMetadataKeys)
        _ <- datasetDAO.updatePartial(dataset._id, request.body)
        updated <- datasetDAO.findOne(datasetId)
        _ = analyticsService.track(ChangeDatasetSettingsEvent(request.identity, updated))
        js <- datasetService.publicWrites(updated, Some(request.identity))
      } yield Ok(js)
    }

  // Note that there exists also updatePartial (which will only expect the changed fields)
  def update(datasetId: ObjectId): Action[JsValue] =
    sil.SecuredAction.async(parse.json) { implicit request =>
      withJsonBodyUsing(datasetPublicReads) {
        case (description, datasetName, legacyDatasetDisplayName, sortingKey, isPublic, tags, metadata, folderId) =>
          val name = if (legacyDatasetDisplayName.isDefined) legacyDatasetDisplayName else datasetName
          for {
            dataset <- datasetDAO.findOne(datasetId) ?~> notFoundMessage(datasetId.toString) ~> NOT_FOUND
            maybeUpdatedMetadata = metadata.getOrElse(dataset.metadata)
            _ <- assertNoDuplicateMetadataKeys(maybeUpdatedMetadata)
            _ <- Fox.assertTrue(datasetService.isEditableBy(dataset, Some(request.identity))) ?~> "notAllowed" ~> FORBIDDEN
            _ <- datasetDAO.updateFields(
              dataset._id,
              description,
              name,
              sortingKey.getOrElse(dataset.created),
              isPublic,
              tags,
              maybeUpdatedMetadata,
              folderId.getOrElse(dataset._folder)
            )
            updated <- datasetDAO.findOne(datasetId)
            _ = analyticsService.track(ChangeDatasetSettingsEvent(request.identity, updated))
            js <- datasetService.publicWrites(updated, Some(request.identity))
          } yield Ok(Json.toJson(js))
      }
    }

  def updateTeams(datasetId: ObjectId): Action[List[ObjectId]] =
    sil.SecuredAction.async(validateJson[List[ObjectId]]) { implicit request =>
      for {
        dataset <- datasetDAO.findOne(datasetId) ?~> notFoundMessage(datasetId.toString) ~> NOT_FOUND
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

  def getSharingToken(datasetId: ObjectId): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        dataset <- datasetDAO.findOne(datasetId) ?~> notFoundMessage(datasetId.toString) ~> NOT_FOUND
        _ <- Fox.fromBool(dataset._organization == request.identity._organization) ~> FORBIDDEN
        token <- datasetService.getSharingToken(dataset._id)
      } yield Ok(Json.obj("sharingToken" -> token.trim))
    }

  def deleteSharingToken(datasetId: ObjectId): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        dataset <- datasetDAO.findOne(datasetId) ?~> notFoundMessage(datasetId.toString) ~> NOT_FOUND
        _ <- Fox.fromBool(dataset._organization == request.identity._organization) ~> FORBIDDEN
        _ <- Fox.assertTrue(datasetService.isEditableBy(dataset, Some(request.identity))) ?~> "notAllowed" ~> FORBIDDEN
        _ <- datasetDAO.updateSharingTokenById(datasetId, None)
      } yield Ok
    }

  def create(typ: String): Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    Future.successful(JsonBadRequest(Messages("dataset.type.invalid", typ)))
  }

  def isValidNewName(datasetName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        validName <- datasetService.assertValidDatasetName(datasetName).futureBox
      } yield
        validName match {
          case Full(_)            => Ok(Json.obj("isValid" -> true))
          case Failure(msg, _, _) => Ok(Json.obj("isValid" -> false, "errors" -> Messages(msg)))
          case _                  => Ok(Json.obj("isValid" -> false, "errors" -> List("Unknown error")))
        }
    }

  def getOrganizationForDataset(datasetName: String, sharingToken: Option[String]): Action[AnyContent] =
    sil.UserAwareAction.async { implicit request =>
      val ctx = URLSharing.fallbackTokenAccessContext(sharingToken)
      for {
        organizationId <- datasetDAO.getOrganizationIdForDataset(datasetName)(ctx)
      } yield Ok(Json.obj("organization" -> organizationId))
    }

  def getDatasetIdFromNameAndOrganization(datasetName: String,
                                          organizationId: String,
                                          sharingToken: Option[String]): Action[AnyContent] =
    sil.UserAwareAction.async { implicit request =>
      val ctx = URLSharing.fallbackTokenAccessContext(sharingToken)
      for {
        datasetBox <- datasetDAO.findOneByNameAndOrganization(datasetName, organizationId)(ctx).futureBox
        result <- (datasetBox match {
          case Full(dataset) =>
            Fox.successful(
              Ok(
                Json.obj("id" -> dataset._id,
                         "name" -> dataset.name,
                         "organization" -> dataset._organization,
                         "directoryName" -> dataset.directoryName)))
          case Empty =>
            for {
              user <- request.identity.toFox ~> Unauthorized
              dataset <- datasetDAO.findOneByNameAndOrganization(datasetName, organizationId)(GlobalAccessContext)
              // Just checking if the user can switch to an organization to access the dataset.
              _ <- authenticationService.getOrganizationToSwitchTo(user, Some(dataset._id), None, None)
            } yield
              Ok(
                Json.obj("id" -> dataset._id,
                         "name" -> dataset.name,
                         "organization" -> dataset._organization,
                         "directoryName" -> dataset.directoryName))
          case _ => Fox.failure(notFoundMessage(datasetName))
        }) ?~> notFoundMessage(datasetName) ~> NOT_FOUND
      } yield result
    }

  private def notFoundMessage(datasetName: String)(implicit ctx: DBAccessContext, m: MessagesProvider): String =
    ctx.data match {
      case Some(_: User) => Messages("dataset.notFound", datasetName)
      case _             => Messages("dataset.notFoundConsiderLogin", datasetName)
    }

  def segmentAnythingMask(datasetId: ObjectId,
                          dataLayerName: String,
                          intensityMin: Option[Float],
                          intensityMax: Option[Float]): Action[SegmentAnythingMaskParameters] =
    sil.SecuredAction.async(validateJson[SegmentAnythingMaskParameters]) { implicit request =>
      log() {
        for {
          _ <- Fox.fromBool(conf.Features.segmentAnythingEnabled) ?~> "segmentAnything.notEnabled"
          _ <- Fox.fromBool(conf.SegmentAnything.uri.nonEmpty) ?~> "segmentAnything.noUri"
          dataset <- datasetDAO.findOne(datasetId) ?~> notFoundMessage(datasetId.toString) ~> NOT_FOUND
          dataSource <- datasetService.dataSourceFor(dataset) ?~> "dataSource.notFound" ~> NOT_FOUND
          usableDataSource <- dataSource.toUsable.toFox ?~> "dataset.notImported"
          dataLayer <- usableDataSource.dataLayers.find(_.name == dataLayerName).toFox ?~> "dataset.noLayers"
          datastoreClient <- datasetService.clientFor(dataset)(GlobalAccessContext)
          targetMagSelectedBbox: BoundingBox = request.body.surroundingBoundingBox / request.body.mag
          _ <- Fox.fromBool(targetMagSelectedBbox.size.sorted.z <= 1024 && targetMagSelectedBbox.size.sorted.y <= 1024) ?~> s"Target-mag selected bbox must be smaller than 1024×1024×depth (or transposed), got ${targetMagSelectedBbox.size}"
          // The maximum depth of 16 also needs to be adapted in the front-end
          // (at the time of writing, in MAX_DEPTH_FOR_SAM in quick_select_settings.tsx).
          _ <- Fox.fromBool(targetMagSelectedBbox.size.sorted.x <= 16) ?~> s"Target-mag selected bbox depth must be at most 16"
          _ <- Fox.fromBool(targetMagSelectedBbox.size.sorted.z == targetMagSelectedBbox.size.sorted.y) ?~> s"Target-mag selected bbox must equally sized long edges, got ${targetMagSelectedBbox.size}"
          _ <- Fox.runIf(request.body.interactionType == SAMInteractionType.BOUNDING_BOX)(
            Fox.fromBool(request.body.selectionTopLeftX.isDefined &&
              request.body.selectionTopLeftY.isDefined && request.body.selectionBottomRightX.isDefined && request.body.selectionBottomRightY.isDefined)) ?~> "Missing selectionTopLeft and selectionBottomRight parameters for bounding box interaction."
          _ <- Fox.runIf(request.body.interactionType == SAMInteractionType.POINT)(Fox.fromBool(
            request.body.pointX.isDefined && request.body.pointY.isDefined)) ?~> "Missing pointX and pointY parameters for point interaction."
          beforeDataLoading = Instant.now
          data <- datastoreClient.getLayerData(
            dataset,
            dataLayer.name,
            request.body.surroundingBoundingBox,
            request.body.mag,
            request.body.additionalCoordinates
          ) ?~> "segmentAnything.getData.failed"
          _ = Instant.logSince(beforeDataLoading, "Data loading for SAM", logger)
          _ = logger.debug(
            s"Sending ${data.length} bytes to SAM server, element class is ${dataLayer.elementClass}, range: $intensityMin-$intensityMax...")
          _ <- Fox.fromBool(
            !(dataLayer.elementClass == ElementClass.float || dataLayer.elementClass == ElementClass.double) || (intensityMin.isDefined && intensityMax.isDefined)) ?~> "For float and double data, a supplied intensity range is required."
          beforeMask = Instant.now
          mask <- wKRemoteSegmentAnythingClient.getMask(
            data,
            dataLayer.elementClass,
            request.body.interactionType,
            request.body.selectionTopLeftX,
            request.body.selectionTopLeftY,
            request.body.selectionBottomRightX,
            request.body.selectionBottomRightY,
            request.body.pointX,
            request.body.pointY,
            targetMagSelectedBbox.size,
            intensityMin,
            intensityMax
          ) ?~> "segmentAnything.getMask.failed"
          _ = Instant.logSince(beforeMask, "Fetching SAM masks from torchserve", logger)
          _ = logger.debug(s"Received ${mask.length} bytes of mask from SAM server, forwarding to front-end...")
        } yield Ok(mask)
      }
    }

}
