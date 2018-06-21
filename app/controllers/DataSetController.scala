package controllers

import javax.inject.Inject

import com.scalableminds.util.reactivemongo.{GlobalAccessContext, MongoHelpers}
import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.reactivemongo.GlobalAccessContext
import com.scalableminds.util.tools.DefaultConverters._
import com.scalableminds.util.tools.{Fox, JsonHelper}
import models.binary._
import models.team.TeamDAO
import models.user.{User, UserService}
import oxalis.ndstore.{ND2WK, NDServerConnection}
import oxalis.security.URLSharing
import oxalis.security.WebknossosSilhouette.{SecuredAction, SecuredRequest, UserAwareAction}
import play.api.Play.current
import play.api.cache.Cache
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.functional.syntax._
import play.api.libs.json._
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._
import com.scalableminds.util.tools.Math

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
          dataSet.dataStore.requestDataLayerThumbnail(dataLayerName, width, height, defaultZoomOpt, defaultCenterOpt).map {
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
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound", dataSetName)
      layer <- DataSetService.getDataLayer(dataSet, dataLayerName) ?~> Messages("dataLayer.notFound", dataLayerName)
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
        el.isEditableBy(request.identity) && value || !el.isEditableBy(request.identity) && !value),
      Filter("isActive", (value: Boolean, el: DataSet) =>
        el.isActive == value)
    ) { filter =>
      DataSetDAO.findAll.flatMap {
        dataSets =>
          for {
            js <- Fox.serialCombined(filter.applyOn(dataSets))(d => DataSet.dataSetPublicWrites(d, request.identity))
          } yield {
            Ok(Json.toJson(js))
          }
      }
    }
  }

  def accessList(dataSetName: String) = SecuredAction.async { implicit request =>
    for {
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound", dataSetName)
      users <- UserService.findByTeams(dataSet.allowedTeams)
    } yield {
      Ok(Writes.list(User.userCompactWrites).writes(users.distinct))
    }
  }

  def read(dataSetName: String, sharingToken: Option[String]) = UserAwareAction.async { implicit request =>
    val ctx = URLSharing.fallbackTokenAccessContext(sharingToken)
    for {
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName)(ctx) ?~> Messages("dataSet.notFound", dataSetName)
      js <- DataSet.dataSetPublicWrites(dataSet, request.identity)
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def update(dataSetName: String) = SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(dataSetPublicReads) {
      case (description, displayName, isPublic) =>
      for {
        dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound", dataSetName)
        _ <- allowedToAdministrate(request.identity, dataSet)
        updatedDataSet <- DataSetService.update(dataSet, description, displayName, isPublic)
        js <- DataSet.dataSetPublicWrites(updatedDataSet, Some(request.identity))
      } yield {
        Ok(Json.toJson(js))
      }
    }
  }


  def importDataSet(dataSetName: String) = SecuredAction.async { implicit request =>
    for {
      _ <- DataSetService.isProperDataSetName(dataSetName) ?~> Messages("dataSet.import.impossible.name")
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound", dataSetName)
      result <- DataSetService.importDataSet(dataSet)
    } yield {
      Status(result.status)(result.body)
    }
  }

  def updateTeams(dataSetName: String) = SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyAs[List[String]] { teams =>
      for {
        dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound", dataSetName)
        _ <- allowedToAdministrate(request.identity, dataSet)
        teamsBson <- Fox.combined(teams.map(MongoHelpers.parseBsonToFox))
        userTeams <- TeamDAO.findAllEditable
        teamsWithoutUpdate = dataSet.allowedTeams.filterNot(t => userTeams.exists(_._id == t))
        teamsWithUpdate = teamsBson.filter(t => userTeams.exists(_._id == t))
        _ <- DataSetService.updateTeams(dataSet, teamsWithUpdate ++ teamsWithoutUpdate)
      } yield
      Ok(Json.toJson((teamsWithUpdate ++ teamsWithoutUpdate).map(_.stringify)))
    }
  }

  def getSharingToken(dataSetName: String) = SecuredAction.async { implicit request =>
    for {
      token <- DataSetService.getSharingToken(dataSetName)
    } yield Ok(Json.obj("sharingToken" -> token))
  }

  def deleteSharingToken(dataSetName: String) = SecuredAction.async { implicit request =>
    for {
      _ <- DataSetSQLDAO.updateSharingTokenByName(dataSetName, None)
    } yield Ok
  }

  val externalDataSetFormReads =
    ((__ \ 'server).read[String] and
      (__ \ 'name).read[String] and
      (__ \ 'token).read[String] and
      (__ \ 'team).read[String]) (
    (server, name, token, team) => (server, name, token, BSONObjectID(team)))

  private def createNDStoreDataSet(implicit request: SecuredRequest[JsValue]) =
    withJsonBodyUsing(externalDataSetFormReads){
      case (server, name, token, team) =>
        for {
          _ <- DataSetService.checkIfNewDataSetName(name) ?~> Messages("dataSet.name.alreadyTaken")
          _ <- ensureTeamAdministration(request.identity, team)
          ndProject <- NDServerConnection.requestProjectInformationFromNDStore(server, name, token)
          dataSet <- ND2WK.dataSetFromNDProject(ndProject, team)
          _ <-  DataSetDAO.insert(dataSet)(GlobalAccessContext)
        } yield JsonOk(Messages("dataSet.create.success"))
    }

  def create(typ: String) = SecuredAction.async(parse.json) { implicit request =>
    typ match {
      case "ndstore" =>
        createNDStoreDataSet(request)
      case _ =>
        Future.successful(JsonBadRequest(Messages("dataSet.type.invalid", typ)))
    }
  }

}
