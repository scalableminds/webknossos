package controllers

import oxalis.security.Secured
import models.binary._
import play.api.i18n.Messages
import views.html
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import scala.concurrent.Future
import com.scalableminds.util.tools.DefaultConverters._
import play.api.templates.Html
import play.api.libs.json.JsSuccess
import play.api.cache.Cache
import org.apache.commons.codec.binary.Base64
import play.api.Play.current
import scala.concurrent.duration._
//<<<<<<< HEAD
import com.scalableminds.util.tools.ExtendedTypes.ExtendedString
//=======
//import braingames.util.ExtendedTypes.ExtendedString
import models.user.{User, UserService}
import com.scalableminds.util.tools.Fox
//import braingames.util.Fox
//>>>>>>> dev

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 03.08.13
 * Time: 17:58
 */

object DataSetController extends Controller with Secured {

  val ThumbnailWidth = 200
  val ThumbnailHeight = 200

  val ThumbnailCacheDuration = 1 hour

  def view(dataSetName: String) = UserAwareAction.async {
    implicit request =>
      for {
        dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound")
      } yield {
        Ok(html.tracing.view(dataSet))
      }
  }

  def thumbnail(dataSetName: String, dataLayerName: String) = UserAwareAction.async {
    implicit request =>

      def imageFromCacheIfPossible(dataSet: DataSet) =
        Cache.getOrElse(s"thumbnail-$dataSetName*$dataLayerName", ThumbnailCacheDuration.toSeconds.toInt) {
          DataStoreHandler.requestDataLayerThumbnail(dataSet, dataLayerName, ThumbnailWidth, ThumbnailHeight)
        }

      for {
        dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound")
        layer <- DataStoreController.getDataLayer(dataSet, dataLayerName) ?~> Messages("dataLayer.notFound")
        image <- imageFromCacheIfPossible(dataSet) ?~> Messages("dataLayer.thumbnailFailed")
      } yield {
        val data = Base64.decodeBase64(image)
        Ok(data).withHeaders(
          CONTENT_LENGTH -> data.length.toString,
          CONTENT_TYPE -> play.api.libs.MimeTypes.forExtension("jpeg").getOrElse(play.api.http.ContentTypes.BINARY)
        )
      }
  }

  def empty = Authenticated{ implicit request =>
    Ok(views.html.main()(Html.empty))
  }

  def userAwareEmpty = UserAwareAction { implicit request =>
    Ok(views.html.main()(Html.empty))
  }

  def list = Authenticated.async{ implicit request =>
    UsingFilters(
      Filter("isEditable", (value: Boolean, el: DataSet) =>
        el.isEditableBy(request.userOpt) && value || !el.isEditableBy(request.userOpt) && !value),
      Filter("isActive", (value: Boolean, el: DataSet) =>
        el.isActive == value)
    ){ filter =>
      DataSetDAO.findAll.map {
        dataSets =>
          Ok(Writes.list(DataSet.dataSetPublicWrites(request.userOpt)).writes(filter.applyOn(dataSets)))
      }
    }
  }

  def accessList(dataSetName: String) = Authenticated.async{ implicit request =>
    for{
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound")
      users <- UserService.findByTeams(dataSet.allowedTeams)
    } yield {
      Ok(Writes.list(User.userCompactWrites(request.user)).writes(users))
    }
  }

  def read(dataSetName: String) = UserAwareAction.async{ implicit request =>
    for{
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound")
    } yield {
      Ok(DataSet.dataSetPublicWrites(request.userOpt).writes(dataSet))
    }
  }

  def importDataSet(dataSetName: String) = Authenticated.async{ implicit request =>
    for {
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound")
      result <- DataSetService.importDataSet(dataSet)
    } yield {
      val status = result.status.toIntOpt.getOrElse(INTERNAL_SERVER_ERROR)
      Status(status)(result.body)
    }
  }

  def importProgress(dataSetName: String) = Authenticated.async{ implicit request =>
    for{
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName)
      result <- DataStoreHandler.progressForImport(dataSet)
    } yield {
      val status = result.status.toIntOpt.getOrElse(INTERNAL_SERVER_ERROR)
      Status(status)(result.body)
    }
  }

  def updateTeams(dataSetName: String) = Authenticated.async(parse.json){ implicit request =>
    request.body.validate[List[String]] match{
      case JsSuccess(teams, _) =>
        for{
          dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound")
          _ <- allowedToAdministrate(request.user, dataSet).toFox
          _ <- Fox.combined(teams.map(team => ensureTeamAdministration(request.user, team).toFox))
          _ <- DataSetService.updateTeams(dataSet, teams)
        } yield
          Ok
      case e: JsError =>
        Future.successful(BadRequest(JsError.toFlatJson(e)))
    }
  }
}

