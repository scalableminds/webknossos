package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import javax.inject.Inject
import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.mvc.Filter
import com.scalableminds.util.tools.DefaultConverters._
import com.scalableminds.util.tools.{Fox, JsonHelper, Math}
import models.binary._
import models.team.{OrganizationDAO, TeamDAO}
import models.user.{User, UserService}
import oxalis.security.{URLSharing, WkEnv}
import play.api.cache.SyncCacheApi
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.functional.syntax._
import play.api.libs.json._
import utils.ObjectId

import scala.concurrent.{ExecutionContext, Future}
import scala.concurrent.duration._

class DataSetController @Inject()(userService: UserService,
                                  dataSetService: DataSetService,
                                  dataSetAllowedTeamsDAO: DataSetAllowedTeamsDAO,
                                  dataSetDataLayerDAO: DataSetDataLayerDAO,
                                  dataStoreDAO: DataStoreDAO,
                                  dataSetLastUsedTimesDAO: DataSetLastUsedTimesDAO,
                                  organizationDAO: OrganizationDAO,
                                  teamDAO: TeamDAO,
                                  dataSetDAO: DataSetDAO,
                                  sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller {

  val DefaultThumbnailWidth = 400
  val DefaultThumbnailHeight = 400
  val MaxThumbnailWidth = 4000
  val MaxThumbnailHeight = 4000

  val ThumbnailCacheDuration = 1 day

  val dataSetPublicReads =
    ((__ \ 'description).readNullable[String] and
      (__ \ 'displayName).readNullable[String] and
      (__ \ 'sortingKey).readNullable[Long] and
      (__ \ 'isPublic).read[Boolean]).tupled

  def removeFromThumbnailCache(organizationName: String, dataSetName: String) =
    sil.SecuredAction { implicit request =>
      dataSetService.thumbnailCache.removeAllConditional(_.startsWith(s"thumbnail-$organizationName*$dataSetName"))
      Ok
    }

  private def thumbnailCacheKey(organizationName: String,
                                dataSetName: String,
                                dataLayerName: String,
                                width: Int,
                                height: Int) =
    s"thumbnail-$organizationName*$dataSetName*$dataLayerName-$width-$height"

  def thumbnail(organizationName: String, dataSetName: String, dataLayerName: String, w: Option[Int], h: Option[Int]) =
    sil.UserAwareAction.async { implicit request =>
      def imageFromCacheIfPossible(dataSet: DataSet): Fox[Array[Byte]] = {
        val width = Math.clamp(w.getOrElse(DefaultThumbnailWidth), 1, MaxThumbnailHeight)
        val height = Math.clamp(h.getOrElse(DefaultThumbnailHeight), 1, MaxThumbnailHeight)
        dataSetService.thumbnailCache.find(s"thumbnail-$organizationName*$dataSetName*$dataLayerName-$width-$height") match {
          case Some(a) =>
            Fox.successful(a)
          case _ => {
            val defaultCenterOpt = dataSet.defaultConfiguration.flatMap(c =>
              c.configuration.get("position").flatMap(jsValue => JsonHelper.jsResultToOpt(jsValue.validate[Point3D])))
            val defaultZoomOpt = dataSet.defaultConfiguration.flatMap(c =>
              c.configuration.get("zoom").flatMap(jsValue => JsonHelper.jsResultToOpt(jsValue.validate[Double])))
            dataSetService
              .clientFor(dataSet)
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
                  s"thumbnail-$organizationName*$dataSetName*$dataLayerName-$width-$height",
                  result,
                  Some((ThumbnailCacheDuration.toSeconds + math.random * 2.hours.toSeconds) seconds)
                )
                result
              }
          }
        }
      }

      for {
        dataSet <- dataSetDAO.findOneByNameAndOrganizationName(dataSetName, organizationName) ?~> Messages(
          "dataSet.notFound",
          dataSetName) ~> NOT_FOUND
        _ <- dataSetDataLayerDAO.findOneByNameForDataSet(dataLayerName, dataSet._id) ?~> Messages(
          "dataLayer.notFound",
          dataLayerName) ~> NOT_FOUND
        image <- imageFromCacheIfPossible(dataSet)
      } yield {
        Ok(image).as("image/jpeg").withHeaders(CACHE_CONTROL -> "public, max-age=86400")
      }
    }

  def addForeignDataStoreAndDataSet() = sil.SecuredAction.async { implicit request =>
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
    } yield {
      Ok
    }
  }

  def list = sil.UserAwareAction.async { implicit request =>
    UsingFilters(
      Filter(
        "isEditable",
        (value: Boolean, el: DataSet) =>
          for { isEditable <- dataSetService.isEditableBy(el, request.identity) } yield {
            isEditable && value || !isEditable && !value
        }
      ),
      Filter("isActive", (value: Boolean, el: DataSet) => Fox.successful(el.isUsable == value))
    ) { filter =>
      for {
        dataSets <- dataSetDAO.findAll ?~> "dataSet.list.failed"
        filtered <- filter.applyOn(dataSets)
        js <- listGrouped(filtered, request.identity)
      } yield {
        Ok(Json.toJson(js))
      }
    }
  }

  private def listGrouped(datasets: List[DataSet], requestingUser: Option[User])(
      implicit ctx: DBAccessContext): Fox[List[JsObject]] =
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
              dataStore <- dataStoreDAO.findOneByName(byDataStoreTuple._1.trim)
              resultByDataStore: Seq[JsObject] <- Fox.serialCombined(byDataStoreTuple._2) { d =>
                dataSetService.publicWrites(d,
                                            requestingUser,
                                            organization,
                                            dataStore,
                                            skipResolutions = true,
                                            requestingUserTeamManagerMemberships)
              }
            } yield resultByDataStore
          }
        } yield result.flatten
      }
    } yield js.flatten

  def accessList(organizationName: String, dataSetName: String) = sil.SecuredAction.async { implicit request =>
    for {
      dataSet <- dataSetDAO.findOneByNameAndOrganizationName(dataSetName, organizationName) ?~> Messages(
        "dataSet.notFound",
        dataSetName) ~> NOT_FOUND
      allowedTeams <- dataSetService.allowedTeamIdsFor(dataSet._id)
      users <- userService.findByTeams(allowedTeams)
      usersJs <- Fox.serialCombined(users.distinct)(u => userService.compactWrites(u))
    } yield {
      Ok(Json.toJson(usersJs))
    }
  }

  def read(organizationName: String, dataSetName: String, sharingToken: Option[String]) = sil.UserAwareAction.async {
    implicit request =>
      log {
        val ctx = URLSharing.fallbackTokenAccessContext(sharingToken)
        for {
          organization <- organizationDAO.findOneByName(organizationName)(GlobalAccessContext) ?~> Messages(
            "organization.notFound",
            organizationName)
          dataSet <- dataSetDAO.findOneByNameAndOrganization(dataSetName, organization._id)(ctx) ?~> Messages(
            "dataSet.notFound",
            dataSetName) ~> NOT_FOUND
          _ <- Fox.runOptional(request.identity)(user =>
            dataSetLastUsedTimesDAO.updateForDataSetAndUser(dataSet._id, user._id))
          dataStore <- dataSetService.dataStoreFor(dataSet)
          js <- dataSetService.publicWrites(dataSet, request.identity, organization, dataStore)
        } yield {
          Ok(Json.toJson(js))
        }
      }
  }

  def health(organizationName: String, dataSetName: String, sharingToken: Option[String]) = sil.UserAwareAction.async {
    implicit request =>
      val ctx = URLSharing.fallbackTokenAccessContext(sharingToken)
      for {
        dataSet <- dataSetDAO.findOneByNameAndOrganizationName(dataSetName, organizationName)(ctx) ?~> Messages(
          "dataSet.notFound",
          dataSetName) ~> NOT_FOUND
        dataSource <- dataSetService.dataSourceFor(dataSet) ?~> "dataSource.notFound" ~> NOT_FOUND
        usableDataSource <- dataSource.toUsable.toFox ?~> "dataSet.notImported"
        datalayer <- usableDataSource.dataLayers.headOption.toFox ?~> "dataSet.noLayers"
        _ <- dataSetService
          .clientFor(dataSet)
          .flatMap(_.findPositionWithData(organizationName, datalayer.name).flatMap(posWithData =>
            bool2Fox(posWithData.value("position") != JsNull))) ?~> "dataSet.loadingDataFailed"
      } yield {
        Ok("Ok")
      }
  }

  def update(organizationName: String, dataSetName: String) = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(dataSetPublicReads) {
      case (description, displayName, sortingKey, isPublic) =>
        for {
          dataSet <- dataSetDAO.findOneByNameAndOrganization(dataSetName, request.identity._organization) ?~> Messages(
            "dataSet.notFound",
            dataSetName) ~> NOT_FOUND
          _ <- Fox
            .assertTrue(dataSetService.isEditableBy(dataSet, Some(request.identity))) ?~> "notAllowed" ~> FORBIDDEN
          _ <- dataSetDAO.updateFields(dataSet._id,
                                       description,
                                       displayName,
                                       sortingKey.getOrElse(dataSet.created),
                                       isPublic)
          updated <- dataSetDAO.findOneByNameAndOrganization(dataSetName, request.identity._organization)
          organization <- organizationDAO.findOne(updated._organization)(GlobalAccessContext)
          dataStore <- dataSetService.dataStoreFor(updated)
          js <- dataSetService.publicWrites(updated, Some(request.identity), organization, dataStore)
        } yield {
          Ok(Json.toJson(js))
        }
    }
  }

  def updateTeams(organizationName: String, dataSetName: String) = sil.SecuredAction.async(parse.json) {
    implicit request =>
      withJsonBodyAs[List[String]] { teams =>
        for {
          dataSet <- dataSetDAO.findOneByNameAndOrganization(dataSetName, request.identity._organization) ?~> Messages(
            "dataSet.notFound",
            dataSetName) ~> NOT_FOUND
          _ <- Fox
            .assertTrue(dataSetService.isEditableBy(dataSet, Some(request.identity))) ?~> "notAllowed" ~> FORBIDDEN
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

  def getSharingToken(organizationName: String, dataSetName: String) = sil.SecuredAction.async { implicit request =>
    for {
      token <- dataSetService.getSharingToken(dataSetName, request.identity._organization)
    } yield Ok(Json.obj("sharingToken" -> token.trim))
  }

  def deleteSharingToken(organizationName: String, dataSetName: String) = sil.SecuredAction.async { implicit request =>
    for {
      _ <- dataSetDAO.updateSharingTokenByName(dataSetName, request.identity._organization, None)
    } yield Ok
  }

  def create(typ: String) = sil.SecuredAction.async(parse.json) { implicit request =>
    Future.successful(JsonBadRequest(Messages("dataSet.type.invalid", typ)))
  }

  def isValidNewName(organizationName: String, dataSetName: String) = sil.SecuredAction.async { implicit request =>
    for {
      _ <- bool2Fox(dataSetService.isProperDataSetName(dataSetName)) ?~> "dataSet.name.invalid"
      _ <- dataSetService
        .assertNewDataSetName(dataSetName, request.identity._organization)(GlobalAccessContext) ?~> "dataSet.name.alreadyTaken"
    } yield Ok
  }

  def getOrganizationForDataSet(dataSetName: String) = sil.UserAwareAction.async { implicit request =>
    for {
      organizationId <- dataSetDAO.getOrganizationForDataSet(dataSetName)
      organization <- organizationDAO.findOne(organizationId)
    } yield Ok(Json.obj("organizationName" -> organization.name))
  }

}
