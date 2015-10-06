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

import net.liftweb.common.{Empty, Failure, Full}
import com.scalableminds.util.tools.Fox
import play.api.mvc.SimpleResult
import play.api.mvc.Request
import play.api.mvc.AnyContent
import com.scalableminds.util.reactivemongo.DBAccessContext
import models.team.Team
import models.user.time.{TimeSpan, TimeSpanService}

object DataSetAdministration extends AdminController {

  val uploadForm = Form(
    tuple(
      "name" -> nonEmptyText.verifying("dataSet.name.invalid",
        n => n.matches("[A-Za-z0-9][A-Za-z0-9_-]*")),
      "team" -> nonEmptyText
    )).fill(("", ""))

  def dataSetUploadHTML(form: Form[(String, String)])(implicit request: AuthenticatedRequest[_]) =
    html.admin.dataset.datasetUpload(request.user.adminTeamNames, form)

  def upload = Authenticated { implicit request =>
    Ok(dataSetUploadHTML(uploadForm))
  }

  def uploadFromForm = Authenticated.async(parse.multipartFormData) { implicit request =>
    uploadForm.bindFromRequest.fold(
      hasErrors = (formWithErrors => Future.successful(BadRequest(dataSetUploadHTML(formWithErrors)))),
      success = {
        case (name, team) =>
          for {
            zipFile <- request.body.file("zipFile").toFox ?~> Messages("zip.file.notFound")
            _ <- ensureTeamAdministration(request.user, team).toFox
            _ <- ensureNewDataSetName(name)
          } yield {
            DataStoreHandler.uploadDataSource(name, team, zipFile.ref.file)
            Redirect(controllers.routes.UserController.empty).flashing(
              FlashSuccess(Messages("dataSet.uploadSuccess")))
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
