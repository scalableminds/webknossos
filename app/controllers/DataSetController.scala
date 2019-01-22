package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import javax.inject.Inject

import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.mvc.Filter
import com.scalableminds.util.tools.DefaultConverters._
import com.scalableminds.util.tools.{Fox, JsonHelper}
import models.binary._
import models.team.{OrganizationDAO, TeamDAO}
import models.user.UserService
import oxalis.security.{URLSharing, WkEnv}
import com.scalableminds.util.tools.Math
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
                                  sil: Silhouette[WkEnv],
                                  cache: SyncCacheApi)(implicit ec: ExecutionContext)
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

  def thumbnail(organizationName: String, dataSetName: String, dataLayerName: String, w: Option[Int], h: Option[Int]) =
    sil.UserAwareAction.async { implicit request =>
      def imageFromCacheIfPossible(dataSet: DataSet): Fox[Array[Byte]] = {
        val width = Math.clamp(w.getOrElse(DefaultThumbnailWidth), 1, MaxThumbnailHeight)
        val height = Math.clamp(h.getOrElse(DefaultThumbnailHeight), 1, MaxThumbnailHeight)
        cache.get[Array[Byte]](s"thumbnail-$organizationName*$dataSetName*$dataLayerName-$width-$height") match {
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
                cache.set(
                  s"thumbnail-$organizationName*$dataSetName*$dataLayerName-$width-$height",
                  result,
                  (ThumbnailCacheDuration.toSeconds + math.random * 2.hours.toSeconds) seconds
                )
                result
              }
          }
        }
      }

      for {
        dataSet <- dataSetDAO.findOneByNameAndOrganizationName(dataSetName, organizationName) ?~> Messages(
          "dataSet.notFound",
          dataSetName)
        _ <- dataSetDataLayerDAO.findOneByNameForDataSet(dataLayerName, dataSet._id) ?~> Messages("dataLayer.notFound",
                                                                                                  dataLayerName)
        image <- imageFromCacheIfPossible(dataSet)
      } yield {
        Ok(image).as("image/jpeg").withHeaders(CACHE_CONTROL -> "public, max-age=86400")
      }
    }

  def addForeignDataStoreAndDataSet() = sil.SecuredAction.async { implicit request =>
    for {
      body <- request.body.asJson.toFox
      url <- (body \ "url").asOpt[String] ?~> "dataSet.url.missing"
      dataStoreName <- (body \ "dataStoreName").asOpt[String].toFox ?~> "dataSet.dataStore.missing"
      dataSetName <- (body \ "dataSetName").asOpt[String] ?~> "dataSet.dataSet.missing"
      _ <- bool2Fox(request.identity.isAdmin) ?~> "user.noAdmin"
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
        requestingUserTeamManagerMemberships <- Fox.runOptional(request.identity)(user =>
          userService.teamManagerMembershipsFor(user._id))
        js <- Fox.serialCombined(filtered)(
          d =>
            dataSetService
              .publicWrites(d, request.identity, skipResolutions = true, requestingUserTeamManagerMemberships))
      } yield {
        Ok(Json.toJson(js))
      }
    }
  }

  def accessList(organizationName: String, dataSetName: String) = sil.SecuredAction.async { implicit request =>
    for {
      dataSet <- dataSetDAO.findOneByNameAndOrganization(dataSetName, request.identity._organization) ?~> Messages(
        "dataSet.notFound",
        dataSetName)
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
          dataSet <- dataSetDAO.findOneByNameAndOrganizationName(dataSetName, organizationName)(ctx) ?~> Messages(
            "dataSet.notFound",
            dataSetName)
          _ <- Fox.runOptional(request.identity)(user =>
            dataSetLastUsedTimesDAO.updateForDataSetAndUser(dataSet._id, user._id))
          js <- dataSetService.publicWrites(dataSet, request.identity)
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
          dataSetName)
        dataSource <- dataSetService.dataSourceFor(dataSet) ?~> "dataSource.notFound"
        usableDataSource <- dataSource.toUsable.toFox ?~> "dataSet.notImported"
        datalayer <- usableDataSource.dataLayers.headOption.toFox ?~> "dataSet.noLayers"
        _ <- dataSetService
          .clientFor(dataSet)
          .flatMap(_.requestDataLayerThumbnail(organizationName, datalayer.name, 100, 100, None, None)) ?~> "dataSet.loadingDataFailed"
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
            dataSetName)
          _ <- Fox.assertTrue(dataSetService.isEditableBy(dataSet, Some(request.identity))) ?~> "notAllowed"
          _ <- dataSetDAO.updateFields(dataSet._id,
                                       description,
                                       displayName,
                                       sortingKey.getOrElse(dataSet.created),
                                       isPublic)
          updated <- dataSetDAO.findOneByNameAndOrganization(dataSetName, request.identity._organization)
          js <- dataSetService.publicWrites(updated, Some(request.identity))
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
            dataSetName)
          _ <- Fox.assertTrue(dataSetService.isEditableBy(dataSet, Some(request.identity))) ?~> "notAllowed"
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
