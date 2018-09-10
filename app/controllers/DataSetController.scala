package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.mohiva.play.silhouette.api.actions.{SecuredRequest, UserAwareRequest}
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
import play.api.cache.CacheApi
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.functional.syntax._
import play.api.libs.json._
import utils.ObjectId
import com.scalableminds.webknossos.datastore.models.datasource.inbox.{InboxDataSourceLike => InboxDataSource}
import net.liftweb.common.Full

import scala.concurrent.ExecutionContext.Implicits._
import scala.concurrent.Future
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
                                  cache: CacheApi) extends Controller {

  val DefaultThumbnailWidth = 400
  val DefaultThumbnailHeight = 400
  val MaxThumbnailWidth = 4000
  val MaxThumbnailHeight = 4000

  val ThumbnailCacheDuration = 1 day

  val dataSetPublicReads =
    ((__ \ 'description).readNullable[String] and
      (__ \ 'displayName).readNullable[String] and
      (__ \ 'isPublic).read[Boolean]).tupled


  def thumbnail(dataSetName: String, dataLayerName: String, w: Option[Int], h: Option[Int]) = sil.UserAwareAction.async { implicit request =>

    def imageFromCacheIfPossible(dataSet: DataSet): Fox[Array[Byte]] = {
      val width = Math.clamp(w.getOrElse(DefaultThumbnailWidth), 1, MaxThumbnailHeight)
      val height = Math.clamp(h.getOrElse(DefaultThumbnailHeight), 1, MaxThumbnailHeight)
      cache.get[Array[Byte]](s"thumbnail-$dataSetName*$dataLayerName-$width-$height") match {
        case Some(a) =>
          Fox.successful(a)
        case _ => {
          val defaultCenterOpt = dataSet.defaultConfiguration.flatMap(c => c.configuration.get("position").flatMap(jsValue => JsonHelper.jsResultToOpt(jsValue.validate[Point3D])))
          val defaultZoomOpt = dataSet.defaultConfiguration.flatMap(c => c.configuration.get("zoom").flatMap(jsValue => JsonHelper.jsResultToOpt(jsValue.validate[Int])))
          dataSetService.handlerFor(dataSet).flatMap(_.requestDataLayerThumbnail(dataLayerName, width, height, defaultZoomOpt, defaultCenterOpt)).map {
            result =>
              // We don't want all images to expire at the same time. Therefore, we add some random variation
              cache.set(s"thumbnail-$dataSetName*$dataLayerName-$width-$height",
                result,
                (ThumbnailCacheDuration.toSeconds + math.random * 2.hours.toSeconds) seconds)
              result
          }
        }
      }
    }

    for {
      dataSet <- dataSetDAO.findOneByName(dataSetName) ?~> Messages("dataSet.notFound", dataSetName)
      layer <- dataSetDataLayerDAO.findOneByNameForDataSet(dataLayerName, dataSet._id) ?~> Messages("dataLayer.notFound", dataLayerName)
      image <- imageFromCacheIfPossible(dataSet)
    } yield {
      Ok(image).withHeaders(
        CONTENT_LENGTH -> image.length.toString,
        CONTENT_TYPE -> "image/jpeg"
      )
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
      _ <- dataSetDAO.findOneByName(dataSetName).reverse ?~> "dataSet.name.alreadyTaken"
      organizationName <- organizationDAO.findOne(request.identity._organization)(GlobalAccessContext).map(_.name)
      _ <- dataSetService.addForeignDataSet(dataStoreName, dataSetName, organizationName)
    } yield {
      Ok
    }
  }

  def list = sil.UserAwareAction.async { implicit request =>
    UsingFilters(
      Filter("isEditable", (value: Boolean, el: DataSet) =>
        for {isEditable <- dataSetService.isEditableBy(el, request.identity)} yield {isEditable && value || !isEditable && !value}),
      Filter("isActive", (value: Boolean, el: DataSet) =>
        Fox.successful(el.isUsable == value))
    ) { filter =>
        for {
          dataSets <- dataSetDAO.findAll ?~> "dataSet.list.failed"
          filtered <- filter.applyOn(dataSets)
          js <- Fox.serialCombined(filtered)(d => dataSetService.publicWrites(d, request.identity))
        } yield {
          Ok(Json.toJson(js))
        }
    }
  }

  def accessList(dataSetName: String) = sil.SecuredAction.async { implicit request =>
    for {
      dataSet <- dataSetDAO.findOneByName(dataSetName) ?~> Messages("dataSet.notFound", dataSetName)
      allowedTeams <- dataSetService.allowedTeamIdsFor(dataSet._id)
      users <- userService.findByTeams(allowedTeams)
      usersJs <- Fox.serialCombined(users.distinct)(u => userService.compactWrites(u))
    } yield {
      Ok(Json.toJson(usersJs))
    }
  }

  def read(dataSetName: String, sharingToken: Option[String]) = sil.UserAwareAction.async { implicit request =>
    val ctx = URLSharing.fallbackTokenAccessContext(sharingToken)
    for {
      dataSet <- dataSetDAO.findOneByName(dataSetName)(ctx) ?~> Messages("dataSet.notFound", dataSetName)
      _ <- Fox.runOptional(request.identity)(user => dataSetLastUsedTimesDAO.updateForDataSetAndUser(dataSet._id, user._id))
      js <- dataSetService.publicWrites(dataSet, request.identity)
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def update(dataSetName: String) = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(dataSetPublicReads) {
      case (description, displayName, isPublic) =>
      for {
        dataSet <- dataSetDAO.findOneByName(dataSetName) ?~> Messages("dataSet.notFound", dataSetName)
        _ <- Fox.assertTrue(dataSetService.isEditableBy(dataSet, Some(request.identity))) ?~> "notAllowed"
        _ <- dataSetDAO.updateFields(dataSet._id, description, displayName, isPublic)
        updated <- dataSetDAO.findOneByName(dataSetName)
        js <- dataSetService.publicWrites(updated, Some(request.identity))
      } yield {
        Ok(Json.toJson(js))
      }
    }
  }

  def importDataSet(dataSetName: String) = sil.SecuredAction.async { implicit request =>
    for {
      _ <- bool2Fox(dataSetService.isProperDataSetName(dataSetName)) ?~> "dataSet.import.impossible.name"
      dataSet <- dataSetDAO.findOneByName(dataSetName) ?~> Messages("dataSet.notFound", dataSetName)
      result <- dataSetService.importDataSet(dataSet)
    } yield {
      Status(result.status)(result.body)
    }
  }

  def updateTeams(dataSetName: String) = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyAs[List[String]] { teams =>
      for {
        dataSet <- dataSetDAO.findOneByName(dataSetName) ?~> Messages("dataSet.notFound", dataSetName)
        _ <- Fox.assertTrue(dataSetService.isEditableBy(dataSet, Some(request.identity))) ?~> "notAllowed"
        teamIdsValidated <- Fox.serialCombined(teams)(ObjectId.parse(_))
        userTeams <- teamDAO.findAllEditable
        oldAllowedTeams <- dataSetService.allowedTeamIdsFor(dataSet._id)
        teamsWithoutUpdate = oldAllowedTeams.filterNot(t => userTeams.exists(_._id == t))
        teamsWithUpdate = teamIdsValidated.filter(t => userTeams.exists(_._id == t))
        _ <- dataSetAllowedTeamsDAO.updateAllowedTeamsForDataSet(dataSet._id, (teamsWithUpdate ++ teamsWithoutUpdate).distinct)
      } yield
      Ok(Json.toJson((teamsWithUpdate ++ teamsWithoutUpdate).map(_.toString)))
    }
  }

  def getSharingToken(dataSetName: String) = sil.SecuredAction.async { implicit request =>
    for {
      token <- dataSetService.getSharingToken(dataSetName)
    } yield Ok(Json.obj("sharingToken" -> token))
  }

  def deleteSharingToken(dataSetName: String) = sil.SecuredAction.async { implicit request =>
    for {
      _ <- dataSetDAO.updateSharingTokenByName(dataSetName, None)
    } yield Ok
  }

  def create(typ: String) = sil.SecuredAction.async(parse.json) { implicit request =>
    Future.successful(JsonBadRequest(Messages("dataSet.type.invalid", typ)))
  }

  def isValidNewName(dataSetName: String) = sil.SecuredAction.async { implicit request =>
    for {
      _ <- bool2Fox(dataSetService.isProperDataSetName(dataSetName)) ?~> "dataSet.name.invalid"
      _ <- dataSetService.assertNewDataSetName(dataSetName)(GlobalAccessContext) ?~> "dataSet.name.alreadyTaken"
    } yield Ok
  }

}
