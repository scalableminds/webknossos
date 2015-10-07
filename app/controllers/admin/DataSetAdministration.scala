package controllers.admin

import reactivemongo.bson.BSONObjectID

import controllers.DataStoreHandler
import scala.Array.canBuildFrom
import scala.Option.option2Iterable
import oxalis.security.AuthenticatedRequest
import oxalis.security.Secured
import com.scalableminds.util.tools.ExtendedTypes.ExtendedString
import com.scalableminds.util.geometry.{Point3D, BoundingBox}
import models.binary.DataSet
import models.tracing._
import models.task._
import models.user._
import models.binary.DataSetService
import play.api.data.Form
import play.api.data.Forms._
import views.html
import play.api.i18n.Messages
import play.api.libs.concurrent._
import play.api.libs.concurrent.Execution.Implicits._
import java.lang.Cloneable
import play.api.Logger
import play.api.mvc.{SimpleResult, Result}
import play.api.templates.Html
import oxalis.annotation._
import controllers.{Controller, Application}
import models.annotation.{AnnotationService, Annotation, AnnotationDAO, AnnotationType}
import scala.concurrent.Future
import oxalis.nml.NMLService
import play.api.libs.json.{Json, JsObject, JsArray}
import play.api.libs.json.Json._
import play.api.libs.json.JsObject

import play.api.libs.json._
import play.api.libs.functional.syntax._

import net.liftweb.common.{Empty, Failure, Full, ParamFailure}
import com.scalableminds.util.tools.Fox
import play.api.mvc.SimpleResult
import play.api.mvc.Request
import play.api.mvc.AnyContent
import com.scalableminds.util.reactivemongo.DBAccessContext
import models.team.Team
import models.user.time.{TimeSpan, TimeSpanService}

object DataSetAdministration extends AdminController {

  def uploadForm(name: String, team: String) = Form(
    tuple(
      "name" -> nonEmptyText.verifying("dataSet.name.invalid",
        n => n.matches("[A-Za-z0-9_]*")),
      "team" -> nonEmptyText
    )).fill((name, team))

  val emptyForm = uploadForm("", "")

  def dataSetUploadHTML(form: Form[(String, String)])(implicit request: AuthenticatedRequest[_]) =
    html.admin.dataset.datasetUpload(request.user.adminTeamNames, form)

  def upload = Authenticated { implicit request =>
    Ok(dataSetUploadHTML(emptyForm))
  }

  def uploadFromForm = Authenticated.async(parse.multipartFormData) { implicit request =>
    emptyForm.bindFromRequest.fold(
      hasErrors = (formWithErrors => Future.successful(BadRequest(dataSetUploadHTML(formWithErrors)))),
      success = {
        case (name, team) =>
          (for {
            _ <- ensureNewDataSetName(name) ~> ("name" -> Messages("dataSet.name.alreadyTaken"))
            _ <- ensureTeamAdministration(request.user, team).toFox ~> ("team" -> Messages("team.admin.notAllowed", team))
            zipFile <- request.body.file("zipFile").toFox ~> ("zipFile" -> Messages("zip.file.notFound"))
            _ <- DataStoreHandler.uploadDataSource(name, team, zipFile.ref.file)
          } yield {
            Redirect(controllers.routes.UserController.empty).flashing(
              FlashSuccess(Messages("dataSet.upload.success")))
          }).futureBox.map {
            case Full(r) => r
            case Empty =>
              Redirect(controllers.routes.UserController.empty).flashing(
              //BadRequest(dataSetUploadHTML(uploadForm(name, team))).flashing(
                FlashError(Messages("error.unknown")))
            case error: ParamFailure[(String, String)] =>
              BadRequest(dataSetUploadHTML(uploadForm(name, team).withError(error.param._1, error.param._2)))
            case Failure(error,_,_) =>
              Redirect(controllers.routes.UserController.empty).flashing(
              //BadRequest(dataSetUploadHTML(uploadForm(name, team))).flashing(
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
