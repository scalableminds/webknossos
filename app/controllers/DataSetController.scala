package controllers

import javax.inject.Inject
import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.mvc.Filter
import com.scalableminds.util.tools.DefaultConverters._
import com.scalableminds.util.tools.{Fox, JsonHelper}
import models.binary._
import models.team.TeamDAO
import models.user.UserService
import oxalis.security.URLSharing
import oxalis.security.WebknossosSilhouette.{SecuredAction, UserAwareAction}
import play.api.Play.current
import play.api.cache.Cache
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.functional.syntax._
import play.api.libs.json._
import com.scalableminds.util.tools.Math
import utils.ObjectId

import scala.concurrent.ExecutionContext.Implicits._
import scala.concurrent.Future
import scala.concurrent.duration._

class DataSetController @Inject()(val messagesApi: MessagesApi) extends Controller {

  val DefaultThumbnailWidth = 400
  val DefaultThumbnailHeight = 400
  val MaxThumbnailWidth = 4000
  val MaxThumbnailHeight = 4000

  val ThumbnailCacheDuration = 1 day

  val dataSetPublicReads =
    ((__ \ 'description).readNullable[String] and
      (__ \ 'displayName).readNullable[String] and
      (__ \ 'isPublic).read[Boolean]).tupled


  def thumbnail(dataSetName: String, dataLayerName: String, w: Option[Int], h: Option[Int]) = UserAwareAction.async { implicit request =>

    def imageFromCacheIfPossible(dataSet: DataSet) = {
      val width = Math.clamp(w.getOrElse(DefaultThumbnailWidth), 1, MaxThumbnailHeight)
      val height = Math.clamp(h.getOrElse(DefaultThumbnailHeight), 1, MaxThumbnailHeight)
      Cache.get(s"thumbnail-$dataSetName*$dataLayerName-$width-$height") match {
        case Some(a: Array[Byte]) =>
          Fox.successful(a)
        case _ => {
          val defaultCenterOpt = dataSet.defaultConfiguration.flatMap(c => c.configuration.get("position").flatMap(jsValue => JsonHelper.jsResultToOpt(jsValue.validate[Point3D])))
          val defaultZoomOpt = dataSet.defaultConfiguration.flatMap(c => c.configuration.get("zoom").flatMap(jsValue => JsonHelper.jsResultToOpt(jsValue.validate[Int])))
          dataSet.dataStoreHandler.flatMap(_.requestDataLayerThumbnail(dataLayerName, width, height, defaultZoomOpt, defaultCenterOpt)).map {
            result =>
              // We don't want all images to expire at the same time. Therefore, we add some random variation
              Cache.set(s"thumbnail-$dataSetName*$dataLayerName-$width-$height",
                result,
                (ThumbnailCacheDuration.toSeconds + math.random * 2.hours.toSeconds).toInt)
              result
          }
        }
      }
    }

    for {
      dataSet <- DataSetDAO.findOneByName(dataSetName) ?~> Messages("dataSet.notFound", dataSetName)
      layer <- dataSet.getDataLayerByName(dataLayerName) ?~> Messages("dataLayer.notFound", dataLayerName)
      image <- imageFromCacheIfPossible(dataSet)
    } yield {
      Ok(image).withHeaders(
        CONTENT_LENGTH -> image.length.toString,
        CONTENT_TYPE -> play.api.libs.MimeTypes.forExtension("jpeg").getOrElse(play.api.http.ContentTypes.BINARY)
      )
    }
  }

  def list = UserAwareAction.async { implicit request =>
    UsingFilters(
      Filter("isEditable", (value: Boolean, el: DataSet) =>
        for {isEditable <- el.isEditableBy(request.identity)} yield {isEditable && value || !isEditable && !value}),
      Filter("isActive", (value: Boolean, el: DataSet) =>
        Fox.successful(el.isUsable == value))
    ) { filter =>
        for {
          dataSets <- DataSetDAO.findAll
          filtered <- filter.applyOn(dataSets)
          js <- Fox.serialCombined(filtered)(d => d.publicWrites(request.identity))
        } yield {
          Ok(Json.toJson(js))
        }
    }
  }

  def accessList(dataSetName: String) = SecuredAction.async { implicit request =>
    for {
      dataSet <- DataSetDAO.findOneByName(dataSetName) ?~> Messages("dataSet.notFound", dataSetName)
      allowedTeams <- dataSet.allowedTeamIds
      users <- UserService.findByTeams(allowedTeams)
      usersJs <- Fox.serialCombined(users.distinct)(_.compactWrites)
    } yield {
      Ok(Json.toJson(usersJs))
    }
  }

  def read(dataSetName: String, sharingToken: Option[String]) = UserAwareAction.async { implicit request =>
    val ctx = URLSharing.fallbackTokenAccessContext(sharingToken)
    for {
      dataSet <- DataSetDAO.findOneByName(dataSetName)(ctx) ?~> Messages("dataSet.notFound", dataSetName)
      _ <- Fox.runOptional(request.identity)(user => DataSetLastUsedTimesDAO.updateForDataSetAndUser(dataSet._id, user._id))
      js <- dataSet.publicWrites(request.identity)
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def update(dataSetName: String) = SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(dataSetPublicReads) {
      case (description, displayName, isPublic) =>
      for {
        dataSet <- DataSetDAO.findOneByName(dataSetName) ?~> Messages("dataSet.notFound", dataSetName)
        _ <- Fox.assertTrue(dataSet.isEditableBy(request.identity)) ?~> Messages("notAllowed")
        _ <- DataSetDAO.updateFields(dataSet._id, description, displayName, isPublic)
        updated <- DataSetDAO.findOneByName(dataSetName)
        js <- updated.publicWrites(Some(request.identity))
      } yield {
        Ok(Json.toJson(js))
      }
    }
  }

  def importDataSet(dataSetName: String) = SecuredAction.async { implicit request =>
    for {
      _ <- bool2Fox(DataSetService.isProperDataSetName(dataSetName)) ?~> Messages("dataSet.import.impossible.name")
      dataSet <- DataSetDAO.findOneByName(dataSetName) ?~> Messages("dataSet.notFound", dataSetName)
      result <- DataSetService.importDataSet(dataSet)
    } yield {
      Status(result.status)(result.body)
    }
  }

  def updateTeams(dataSetName: String) = SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyAs[List[String]] { teams =>
      for {
        dataSet <- DataSetDAO.findOneByName(dataSetName) ?~> Messages("dataSet.notFound", dataSetName)
        _ <- Fox.assertTrue(dataSet.isEditableBy(request.identity)) ?~> Messages("notAllowed")
        teamIdsValidated <- Fox.serialCombined(teams)(ObjectId.parse(_))
        userTeams <- TeamDAO.findAllEditable
        oldAllowedTeams <- dataSet.allowedTeamIds
        teamsWithoutUpdate = oldAllowedTeams.filterNot(t => userTeams.exists(_._id == t))
        teamsWithUpdate = teamIdsValidated.filter(t => userTeams.exists(_._id == t))
        _ <- DataSetAllowedTeamsDAO.updateAllowedTeamsForDataSet(dataSet._id, (teamsWithUpdate ++ teamsWithoutUpdate).distinct)
      } yield
      Ok(Json.toJson((teamsWithUpdate ++ teamsWithoutUpdate).map(_.toString)))
    }
  }

  def getSharingToken(dataSetName: String) = SecuredAction.async { implicit request =>
    for {
      token <- DataSetService.getSharingToken(dataSetName)
    } yield Ok(Json.obj("sharingToken" -> token))
  }

  def deleteSharingToken(dataSetName: String) = SecuredAction.async { implicit request =>
    for {
      _ <- DataSetDAO.updateSharingTokenByName(dataSetName, None)
    } yield Ok
  }

  def create(typ: String) = SecuredAction.async(parse.json) { implicit request =>
    Future.successful(JsonBadRequest(Messages("dataSet.type.invalid", typ)))
  }

}
