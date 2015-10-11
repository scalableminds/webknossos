package controllers

import oxalis.security.Secured
import models.binary._
import play.api.i18n.Messages
import views.html
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import scala.concurrent.Future
import com.scalableminds.util.tools.DefaultConverters._
import play.twirl.api.Html
import play.api.libs.json.JsSuccess
import play.api.cache.Cache
import org.apache.commons.codec.binary.Base64
import play.api.Play.current
import scala.concurrent.duration._
import com.scalableminds.util.tools.ExtendedTypes.ExtendedString
import models.user.{User, UserService}
import com.scalableminds.util.tools.Fox
import play.api.data.Form
import play.api.data.Forms._
import oxalis.security.AuthenticatedRequest
import com.scalableminds.util.reactivemongo.DBAccessContext
import net.liftweb.common.{Empty, Failure, Full, ParamFailure}
import com.scalableminds.util.geometry.{Scale, Point3D}
import com.scalableminds.braingames.binary.models._

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
        Ok(views.html.main()(Html("")))
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
    Ok(views.html.main()(Html("")))
  }

  def userAwareEmpty = UserAwareAction { implicit request =>
    Ok(views.html.main()(Html("")))
  }

  def list = UserAwareAction.async{ implicit request =>
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

  def uploadForm(name: String, team: String, scale: Scale) = Form(
    tuple(
      "name" -> nonEmptyText.verifying("dataSet.name.invalid",
        n => n.matches("[A-Za-z0-9_]*")),
      "team" -> nonEmptyText,
      "scale" -> mapping(
        "scale" -> text.verifying("scale.invalid",
          p => p.matches(Scale.formRx.toString)))(Scale.fromForm)(Scale.toForm)
    )).fill((name, team, scale))

  val emptyUploadForm = uploadForm("", "", Scale.default)

  def dataSetUploadHTML(form: Form[(String, String, Scale)])(implicit request: AuthenticatedRequest[_]) =
    html.admin.dataset.datasetUpload(request.user.adminTeamNames, form)

  def upload = Authenticated{ implicit request =>
    Ok(dataSetUploadHTML(emptyUploadForm))
  }

  def uploadFromForm = Authenticated.async(parse.multipartFormData) { implicit request =>

    case class FormFailure(field: String, message: String)

    emptyUploadForm.bindFromRequest.fold(
      hasErrors = (formWithErrors => Future.successful(BadRequest(dataSetUploadHTML(formWithErrors)))),
      success = {
        case (name, team, scale) =>
          (for {
            _ <- ensureNewDataSetName(name).toFox ~> FormFailure("name", Messages("dataSet.name.alreadyTaken"))
            _ <- ensureTeamAdministration(request.user, team).toFox ~> FormFailure("team", Messages("team.admin.notAllowed", team))
            zipFile <- request.body.file("zipFile").toFox ~> FormFailure("zipFile", Messages("zip.file.notFound"))
            settings = DataSourceSettings(None, scale, None)
            upload = DataSourceUpload(name, team, zipFile.ref.file.getAbsolutePath(), Some(settings))
            _ <- DataStoreHandler.uploadDataSource(upload).toFox
          } yield {
            Redirect(controllers.routes.DataSetController.empty).flashing(
              FlashSuccess(Messages("dataSet.upload.success")))
          }).futureBox.map {
            case Full(r) => r
            case error: ParamFailure[FormFailure] =>
              BadRequest(dataSetUploadHTML(uploadForm(name, team, scale).withError(error.param.field, error.param.message)))
            case Failure(error,_,_) =>
              Redirect(controllers.routes.DataSetController.empty).flashing(
              //BadRequest(dataSetUploadHTML(uploadForm(name, team, scale))).flashing(
                FlashError(error))
          }
      })
  }

  private def ensureNewDataSetName(name: String)(implicit ctx: DBAccessContext) = {
    DataSetService.findDataSource(name).futureBox.map {
      case Empty   => Full(true)
      case Full(_) => Failure(Messages("dataSet.name.alreadyTaken"))
    }
  }

}

