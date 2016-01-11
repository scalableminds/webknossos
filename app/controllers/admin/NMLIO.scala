package controllers.admin

import javax.inject.Inject

import scala.concurrent.Future

import controllers.Controller
import models.annotation.{AnnotationType, _}
import models.task.{Task, _}
import models.user._
import oxalis.nml.NMLService.NMLParseSuccess
import oxalis.nml._
import oxalis.security.Secured
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import views.html

class NMLIO @Inject()(val messagesApi: MessagesApi) extends Controller with Secured {

  def uploadForm = Authenticated { implicit request =>
    Ok(html.admin.nml.nmlupload())
  }

  private def nameForNMLs(fileNames: Seq[String]) =
    if (fileNames.size == 1)
      fileNames.headOption.map(_.replaceAll("\\.nml$", ""))
    else
      None

  def upload = Authenticated.async(parse.multipartFormData) { implicit request =>
    val parsedFiles = request.body.files.flatMap(f => f.contentType match {
      case Some("application/zip") => NMLService.extractFromZip(f.ref.file, Some(f.filename))
      case _                       => List(NMLService.extractFromNML(f.ref.file, Some(f.filename)))
    })

    val (parseSuccess, parseFailed) = parsedFiles.partition { case x: NMLParseSuccess => true; case _ => false }

    if (parseFailed.nonEmpty) {
      val errors = parseFailed.map(fileName => "error" -> Messages("nml.file.invalid", fileName))
      Future.successful(JsonBadRequest(errors))
    } else if (parseSuccess.isEmpty) {
      Future.successful(JsonBadRequest(Messages("nml.file.noFile")))
    } else {
      val fileNames = parseSuccess.map(_.fileName)
      val nmls = parseSuccess.flatMap(_.nml).toList

      AnnotationService
      .createAnnotationFrom(request.user, nmls, AnnotationType.Explorational, nameForNMLs(fileNames))
      .map { annotation =>
        JsonOk(
          Json.obj("annotation" -> Json.obj("typ" -> annotation.typ, "id" -> annotation.id)),
          Messages("nml.file.uploadSuccess")
        )
      }
      .getOrElse(JsonBadRequest(Messages("nml.file.invalid")))
    }
  }

  // TODO: secure
  def projectDownload(projectName: String) = Authenticated.async { implicit request =>
    def createProjectZip(project: Project) =
      for {
        tasks <- TaskDAO.findAllByProject(project.name)
        annotations <- Future.traverse(tasks)(_.annotations).map(_.flatten.filter(_.state.isFinished))
        zip <- AnnotationService.zipAnnotations(annotations, projectName + "_nmls.zip")
      } yield zip

    for {
      project <- ProjectDAO.findOneByName(projectName) ?~> Messages("project.notFound")
      zip <- createProjectZip(project)
    } yield {
      Ok.sendFile(zip.file)
    }
  }

  // TODO: secure
  def taskDownload(taskId: String) = Authenticated.async { implicit request =>
    def createTaskZip(task: Task) = task.annotations.flatMap { annotations =>
      val finished = annotations.filter(_.state.isFinished)
      AnnotationService.zipAnnotations(finished, task.id + "_nmls.zip")
    }

    for {
      task <- TaskDAO.findOneById(taskId) ?~> Messages("task.notFound")
      zip <- createTaskZip(task)
    } yield Ok.sendFile(zip.file)
  }

  // TODO: secure
  def taskTypeDownload(taskTypeId: String) = Authenticated.async { implicit request =>
    def createTaskTypeZip(taskType: TaskType) =
      for {
        tasks <- TaskDAO.findAllByTaskType(taskType._id)
        tracings <- Future.traverse(tasks)(_.annotations).map(_.flatten.filter(_.state.isFinished))
        zip <- AnnotationService.zipAnnotations(tracings, taskType.summary + "_nmls.zip")
      } yield zip

    for {
      task <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
      zip <- createTaskTypeZip(task)
    } yield Ok.sendFile(zip.file)
  }

  // TODO: secure
  def userDownload(userId: String) = Authenticated.async { implicit request =>
    for {
      user <- UserService.findOneById(userId, useCache = true) ?~> Messages("user.notFound")
      annotations <- AnnotationService.findTasksOf(user).map(_.filter(_.state.isFinished))
      zipped <- AnnotationService.zipAnnotations(annotations, user.abreviatedName + "_nmls.zip")
    } yield {
      Ok.sendFile(zipped.file)
    }
  }
}
