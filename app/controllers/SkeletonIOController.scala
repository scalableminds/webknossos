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

class SkeletonIOController @Inject()(val messagesApi: MessagesApi) extends Controller with Secured {

  private def nameForNMLs(fileNames: Seq[String]) =
    if (fileNames.size == 1)
      fileNames.headOption.map(_.replaceAll("\\.nml$", ""))
    else
      None

  def upload = Authenticated.async(parse.multipartFormData) { implicit request =>
    val parsedFiles = request.body.files.map(f => f.contentType match {
      case Some("application/zip") => NMLService.extractFromZip(f.ref.file, Some(f.filename))
      case _                       => List(NMLService.extractFromNML(f.ref.file, Some(f.filename)))
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

  // TODO: secure
  def projectDownload(projectName: String) = Authenticated.async { implicit request =>
    def createProjectZip(project: Project) =
      for {
        tasks <- TaskDAO.findAllByProject(project.name)
        annotations <- Fox.serialSequence(tasks)(_.annotations).map(_.flatten.filter(_.state.isFinished))
        zip <- AnnotationService.zipAnnotations(annotations, projectName + "_nmls.zip")
      } yield zip

    for {
      project <- ProjectDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
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
        tracings <- Fox.serialSequence(tasks)(_.annotations).map(_.flatten.filter(_.state.isFinished))
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
      annotations <- AnnotationService.findTasksOf(user, isFinished = Some(true), limit = Int.MaxValue)
      zipped <- AnnotationService.zipAnnotations(annotations, user.abreviatedName + "_nmls.zip")
    } yield {
      Ok.sendFile(zipped.file)
    }
  }
}
