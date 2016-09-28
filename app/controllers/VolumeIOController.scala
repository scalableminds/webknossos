package controllers

import javax.inject.Inject

import scala.concurrent.Future

import models.annotation.{AnnotationType, _}
import models.task.{Task, _}
import models.user._
import oxalis.nml.NMLService.{NMLParseFailure, NMLParseSuccess}
import oxalis.nml._
import oxalis.security.Secured
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import scala.collection.JavaConversions._
import scala.collection.JavaConverters._

import com.scalableminds.util.tools.Fox
import models.project.{Project, ProjectDAO}

class VolumeIOController @Inject()(val messagesApi: MessagesApi) extends Controller with Secured {

  def upload = Authenticated.async(parse.multipartFormData) { implicit request =>
    val parsedFiles = request.body.files.flatMap(f => f.contentType match {
      case Some("application/zip") => NMLService.extractFromZip(f.ref.file, Some(f.filename))
      case _                       => Failure("zip.volume.invalid")
    })

    if (parsedFiles.isEmpty) {
      Future.successful(JsonBadRequest(Messages("nml.file.noFile")))
    } else if (parsedFiles.exists(!_.succeeded)) {
      val errors = parsedFiles.flatMap{
        case result: NMLParseFailure =>
          Some("error" -> Messages("nml.file.invalid", result.fileName, result.error))
        case _ => None
      }
      Future.successful(JsonBadRequest(errors))
    } else {
      val parseSuccess = parsedFiles.filter(_.succeeded)
      val fileNames = parseSuccess.map(_.fileName)
      val nmls = parseSuccess.flatMap(_.nml).toList

      for{
        annotation <- AnnotationService.createAnnotationFrom(
          request.user, nmls, AnnotationType.Explorational, nameForNMLs(fileNames)) ?~> "nml.file.createFailed"
      } yield JsonOk(
        Json.obj("annotation" -> Json.obj("typ" -> annotation.typ, "id" -> annotation.id)),
        Messages("nml.file.uploadSuccess")
      )
    }
  }
}
