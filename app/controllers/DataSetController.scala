package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.mvc.Filter
import com.scalableminds.util.tools.DefaultConverters._
import com.scalableminds.util.tools.{Fox, JsonHelper, Math}
import com.scalableminds.webknossos.datastore.controllers.RemoteOriginHelpers
import io.swagger.annotations.{Api, ApiOperation, ApiParam, ApiResponse, ApiResponses}
import models.binary._
import models.team.TeamDAO
import models.user.{User, UserDAO, UserService}
import oxalis.security.{URLSharing, WkEnv}
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.functional.syntax._
import play.api.libs.json._
import utils.ObjectId
import javax.inject.Inject
import models.analytics.{AnalyticsService, ChangeDatasetSettingsEvent, OpenDatasetEvent}
import models.organization.OrganizationDAO
import oxalis.mail.{MailchimpClient, MailchimpTag}
import play.api.mvc.{Action, AnyContent}

import scala.concurrent.duration._
import scala.concurrent.{ExecutionContext, Future}

@Api
class DataSetController @Inject()(userService: UserService,
                                  userDAO: UserDAO,
                                  dataSetService: DataSetService,
                                  dataSetAllowedTeamsDAO: DataSetAllowedTeamsDAO,
                                  dataSetDataLayerDAO: DataSetDataLayerDAO,
                                  dataStoreDAO: DataStoreDAO,
                                  dataSetLastUsedTimesDAO: DataSetLastUsedTimesDAO,
                                  organizationDAO: OrganizationDAO,
                                  teamDAO: TeamDAO,
                                  dataSetDAO: DataSetDAO,
                                  analyticsService: AnalyticsService,
                                  mailchimpClient: MailchimpClient,
                                  sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller
    with RemoteOriginHelpers {

  private val DefaultThumbnailWidth = 400
  private val DefaultThumbnailHeight = 400
  private val MaxThumbnailWidth = 4000
  private val MaxThumbnailHeight = 4000

  private val ThumbnailCacheDuration = 1 day

  private val dataSetPublicReads =
    ((__ \ 'description).readNullable[String] and
      (__ \ 'displayName).readNullable[String] and
      (__ \ 'sortingKey).readNullable[Long] and
      (__ \ 'isPublic).read[Boolean] and
      (__ \ 'tags).read[List[String]]).tupled

  @ApiOperation(hidden = true, value = "")
  def removeFromThumbnailCache(organizationName: String, dataSetName: String): Action[AnyContent] =
    sil.SecuredAction {
      dataSetService.thumbnailCache.removeAllConditional(_.startsWith(s"thumbnail-$organizationName*$dataSetName"))
      Ok
    }

  private def thumbnailCacheKey(organizationName: String,
                                dataSetName: String,
                                dataLayerName: String,
                                width: Int,
                                height: Int) =
    s"thumbnail-$organizationName*$dataSetName*$dataLayerName-$width-$height"

  @ApiOperation(hidden = true, value = "")
  def thumbnail(organizationName: String,
                dataSetName: String,
                dataLayerName: String,
                w: Option[Int],
                h: Option[Int]): Action[AnyContent] =
    sil.UserAwareAction.async { implicit request =>
      AllowRemoteOrigin {
        def imageFromCacheIfPossible(dataSet: DataSet): Fox[Array[Byte]] = {
          val width = Math.clamp(w.getOrElse(DefaultThumbnailWidth), 1, MaxThumbnailWidth)
          val height = Math.clamp(h.getOrElse(DefaultThumbnailHeight), 1, MaxThumbnailHeight)
          dataSetService.thumbnailCache.find(
            thumbnailCacheKey(organizationName, dataSetName, dataLayerName, width, height)) match {
            case Some(a) =>
              Fox.successful(a)
            case _ =>
              val defaultCenterOpt = dataSet.adminViewConfiguration.flatMap(c =>
                c.get("position").flatMap(jsValue => JsonHelper.jsResultToOpt(jsValue.validate[Point3D])))
              val defaultZoomOpt = dataSet.adminViewConfiguration.flatMap(c =>
                c.get("zoom").flatMap(jsValue => JsonHelper.jsResultToOpt(jsValue.validate[Double])))
              dataSetService
                .clientFor(dataSet)(GlobalAccessContext)
                .flatMap(
                  _.requestDataLayerThumbnail(organizationName,
                                              dataLayerName,
                                              width,
                                              height,
                                              defaultZoomOpt,
                                              defaultCenterOpt))
                .map { result =>
                  // We don't want all images to expire at the same time. Therefore, we add some random variation
                  dataSetService.thumbnailCache.insert(
                    thumbnailCacheKey(organizationName, dataSetName, dataLayerName, width, height),
                    result,
                    Some((ThumbnailCacheDuration.toSeconds + math.random * 2.hours.toSeconds) seconds)
                  )
                  result
                }
          }
        }

        for {
          dataSet <- dataSetDAO.findOneByNameAndOrganizationName(dataSetName, organizationName) ?~> notFoundMessage(
            dataSetName) ~> NOT_FOUND
          _ <- dataSetDataLayerDAO.findOneByNameForDataSet(dataLayerName, dataSet._id) ?~> Messages(
            "dataLayer.notFound",
            dataLayerName) ~> NOT_FOUND
          image <- imageFromCacheIfPossible(dataSet)
        } yield {
          Ok(image).as("image/jpeg").withHeaders(CACHE_CONTROL -> "public, max-age=86400")
        }
      }
    }

  @ApiOperation(hidden = true, value = "")
  def addForeignDataStoreAndDataSet(): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      body <- request.body.asJson.toFox
      url <- (body \ "url").asOpt[String] ?~> "dataSet.url.missing" ~> NOT_FOUND
      dataStoreName <- (body \ "dataStoreName").asOpt[String].toFox ?~> "dataSet.dataStore.missing" ~> NOT_FOUND
      dataSetName <- (body \ "dataSetName").asOpt[String] ?~> "dataSet.dataSet.missing" ~> NOT_FOUND
      _ <- bool2Fox(request.identity.isAdmin) ?~> "user.noAdmin" ~> FORBIDDEN
      noDataStoreBox <- dataStoreDAO.findOneByName(dataStoreName).reverse.futureBox
      _ <- Fox.runOptional(noDataStoreBox)(_ => dataSetService.addForeignDataStore(dataStoreName, url))
      _ <- bool2Fox(dataSetService.isProperDataSetName(dataSetName)) ?~> "dataSet.import.impossible.name"
      _ <- dataSetDAO
        .findOneByNameAndOrganization(dataSetName, request.identity._organization)
        .reverse ?~> "dataSet.name.alreadyTaken"
      organizationName <- organizationDAO.findOne(request.identity._organization)(GlobalAccessContext).map(_.name)
      _ <- dataSetService.addForeignDataSet(dataStoreName, dataSetName, organizationName)
    } yield Ok
  }

  @ApiOperation(hidden = true, value = "")
  def list: Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    AllowRemoteOrigin {
      UsingFilters(
        Filter("isActive", (value: Boolean, el: DataSet) => Fox.successful(el.isUsable == value)),
        Filter("isUnreported",
               (value: Boolean, el: DataSet) => Fox.successful(dataSetService.isUnreported(el) == value)),
        Filter(
          "isEditable",
          (value: Boolean, el: DataSet) =>
            for { isEditable <- dataSetService.isEditableBy(el, request.identity) } yield {
              isEditable && value || !isEditable && !value
          }
        )
      ) { filter =>
        for {
          dataSets <- dataSetDAO.findAll ?~> "dataSet.list.failed"
          filtered <- filter.applyOn(dataSets)
          js <- listGrouped(filtered, request.identity) ?~> "dataSet.list.failed"
        } yield {
          Ok(Json.toJson(js))
        }
      }
    }
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
                  organization,
                  dataStore,
                  skipResolutions = true,
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
        allowedTeams <- dataSetService.allowedTeamIdsFor(dataSet._id)
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
          js <- dataSetService.publicWrites(dataSet, request.identity, organization, dataStore)
          _ = request.identity.map { user =>
            analyticsService.track(OpenDatasetEvent(user, dataSet))
            if (dataSet.isPublic) {
              mailchimpClient.tagUser(user, MailchimpTag.HasViewedPublishedDataset)
            }
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
          .flatMap(_.findPositionWithData(organizationName, datalayer.name).flatMap(posWithData =>
            bool2Fox(posWithData.value("position") != JsNull))) ?~> "dataSet.loadingDataFailed"
      } yield {
        Ok("Ok")
      }
    }

  @ApiOperation(hidden = true, value = "")
  def update(organizationName: String, dataSetName: String): Action[JsValue] = sil.SecuredAction.async(parse.json) {
    implicit request =>
      withJsonBodyUsing(dataSetPublicReads) {
        case (description, displayName, sortingKey, isPublic, tags) =>
          for {
            dataSet <- dataSetDAO
              .findOneByNameAndOrganization(dataSetName, request.identity._organization) ?~> notFoundMessage(
              dataSetName) ~> NOT_FOUND
            _ <- Fox
              .assertTrue(dataSetService.isEditableBy(dataSet, Some(request.identity))) ?~> "notAllowed" ~> FORBIDDEN
            _ <- dataSetDAO.updateFields(dataSet._id,
                                         description,
                                         displayName,
                                         sortingKey.getOrElse(dataSet.created),
                                         isPublic)
            _ <- dataSetDAO.updateTags(dataSet._id, tags)
            updated <- dataSetDAO.findOneByNameAndOrganization(dataSetName, request.identity._organization)
            _ = analyticsService.track(ChangeDatasetSettingsEvent(request.identity, updated))
            organization <- organizationDAO.findOne(updated._organization)(GlobalAccessContext)
            dataStore <- dataSetService.dataStoreFor(updated)
            js <- dataSetService.publicWrites(updated, Some(request.identity), organization, dataStore)
          } yield Ok(Json.toJson(js))
      }
  }

  @ApiOperation(hidden = true, value = "")
  def updateTeams(organizationName: String, dataSetName: String): Action[JsValue] =
    sil.SecuredAction.async(parse.json) { implicit request =>
      withJsonBodyAs[List[String]] { teams =>
        for {
          dataSet <- dataSetDAO.findOneByNameAndOrganization(dataSetName, request.identity._organization) ?~> notFoundMessage(
            dataSetName) ~> NOT_FOUND
          _ <- Fox.assertTrue(dataSetService.isEditableBy(dataSet, Some(request.identity))) ?~> "notAllowed" ~> FORBIDDEN
          teamIdsValidated <- Fox.serialCombined(teams)(ObjectId.parse(_))
          userTeams <- teamDAO.findAllEditable
          oldAllowedTeams <- dataSetService.allowedTeamIdsFor(dataSet._id)
          teamsWithoutUpdate = oldAllowedTeams.filterNot(t => userTeams.exists(_._id == t))
          teamsWithUpdate = teamIdsValidated.filter(t => userTeams.exists(_._id == t))
          _ <- dataSetAllowedTeamsDAO.updateAllowedTeamsForDataSet(dataSet._id,
                                                                   (teamsWithUpdate ++ teamsWithoutUpdate).distinct)
        } yield Ok(Json.toJson((teamsWithUpdate ++ teamsWithoutUpdate).map(_.toString)))
      }
    }

  @ApiOperation(hidden = true, value = "")
  def getSharingToken(organizationName: String, dataSetName: String): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        token <- dataSetService.getSharingToken(dataSetName, request.identity._organization)
      } yield Ok(Json.obj("sharingToken" -> token.trim))
  }

  @ApiOperation(hidden = true, value = "")
  def deleteSharingToken(organizationName: String, dataSetName: String): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        _ <- dataSetDAO.updateSharingTokenByName(dataSetName, request.identity._organization, None)
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
        _ <- bool2Fox(dataSetService.isProperDataSetName(dataSetName)) ?~> "dataSet.name.invalid"
        _ <- dataSetService.assertNewDataSetName(dataSetName, request.identity._organization) ?~> "dataSet.name.alreadyTaken"
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

}
