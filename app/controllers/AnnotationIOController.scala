package controllers

import javax.inject.Inject

import scala.concurrent.Future

import models.annotation.{AnnotationType, _}
import models.task.{Task, _}
import models.user._
import oxalis.nml._
import oxalis.security.Secured
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import scala.collection.JavaConversions._
import scala.collection.JavaConverters._

import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import models.project.{Project, ProjectDAO}
import org.apache.commons.io.{FileUtils, FilenameUtils}
import play.api.libs.Files.TemporaryFile
import play.api.libs.iteratee.Enumerator
import play.api.mvc.MultipartFormData

class AnnotationIOController @Inject()(val messagesApi: MessagesApi)
  extends Controller
    with Secured
    with TracingInformationProvider
    with LazyLogging {

  private def nameForNMLs(fileNames: Seq[String]) =
    if (fileNames.size == 1)
      fileNames.headOption.map(_.replaceAll("\\.nml$", ""))
    else
      None

  def upload = Authenticated.async(parse.multipartFormData) { implicit request =>
    def isZipFile(f: MultipartFormData.FilePart[TemporaryFile]): Boolean =
      f.contentType.contains("application/zip") || FilenameUtils.isExtension(f.filename, "zip")

    def parseFile(f: MultipartFormData.FilePart[TemporaryFile]) = {
      if (isZipFile(f)) {
        NMLService.extractFromZip(f.ref.file, Some(f.filename))
      } else {
        val nml = NMLService.extractFromNML(f.ref.file, f.filename)
        NMLService.ZipParseResult(List(nml), Map.empty)
      }
    }

    def returnError(parsedFiles: NMLService.ZipParseResult) = {
      if (parsedFiles.containsFailure) {
        val errors = parsedFiles.nmls.flatMap {
          case result: NMLService.NMLParseFailure =>
            Some("error" -> Messages("nml.file.invalid", result.fileName, result.error))
          case _                                  => None
        }
        Future.successful(JsonBadRequest(errors))
      } else {
        Future.successful(JsonBadRequest(Messages("nml.file.noFile")))
      }
    }

    val parsedFiles = request.body.files.foldLeft(NMLService.ZipParseResult()) {
      case (acc, next) => acc.combineWith(parseFile(next))
    }
    if (!parsedFiles.isEmpty) {
      val parseSuccess = parsedFiles.nmls.filter(_.succeeded)
      val fileNames = parseSuccess.map(_.fileName)
      val nmls = parseSuccess.flatMap(_.nml)
      val name = nameForNMLs(fileNames)
      for {
        annotation <- AnnotationService.createAnnotationFrom(
          request.user, nmls, parsedFiles.otherFiles, AnnotationType.Explorational, name)
      } yield JsonOk(
        Json.obj("annotation" -> Json.obj("typ" -> annotation.typ, "id" -> annotation.id)),
        Messages("nml.file.uploadSuccess")
      )
    } else {
      returnError(parsedFiles)
    }
  }


  def download(typ: String, id: String) = Authenticated.async { implicit request =>
    withAnnotation(AnnotationIdentifier(typ, id)) {
      annotation =>
        logger.trace(s"Requested download for tracing: $typ/$id")
        for {
          name <- nameAnnotation(annotation) ?~> Messages("annotation.name.impossible")
          _ <- annotation.restrictions.allowDownload(request.user) ?~> Messages("annotation.download.notAllowed")
          annotationDAO <- AnnotationDAO.findOneById(id) ?~> Messages("annotation.notFound")
          content <- annotation.content ?~> Messages("annotation.content.empty")
          stream <- content.toDownloadStream(name)
        } yield {
          Ok.chunked(stream).withHeaders(
            CONTENT_TYPE ->
              "application/octet-stream",
            CONTENT_DISPOSITION ->
              s"filename=${'"'}${name + content.downloadFileExtension}${'"'}")
        }
    }
  }

  def projectDownload(projectName: String) = Authenticated.async { implicit request =>
    def createProjectZip(project: Project) =
      for {
        tasks <- TaskDAO.findAllByProject(project.name)
        annotations <- Fox.serialSequence(tasks)(_.annotations).map(_.flatten.filter(_.state.isFinished))
        zip <- AnnotationService.zipAnnotations(annotations, projectName + "_nmls.zip")
      } yield zip

    for {
      project <- ProjectDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
      _ <- request.user.adminTeamNames.contains(project.team) ?~> Messages("notAllowed")
      zip <- createProjectZip(project)
    } yield {
      Ok.sendFile(zip.file)
    }
  }

  def taskDownload(taskId: String) = Authenticated.async { implicit request =>
    def createTaskZip(task: Task) = task.annotations.flatMap { annotations =>
      val finished = annotations.filter(_.state.isFinished)
      AnnotationService.zipAnnotations(finished, task.id + "_nmls.zip")
    }

    for {
      task <- TaskDAO.findOneById(taskId) ?~> Messages("task.notFound")
      _ <- ensureTeamAdministration(request.user, task.team) ?~> Messages("notAllowed")
      zip <- createTaskZip(task)
    } yield Ok.sendFile(zip.file)
  }

  def taskTypeDownload(taskTypeId: String) = Authenticated.async { implicit request =>
    def createTaskTypeZip(taskType: TaskType) =
      for {
        tasks <- TaskDAO.findAllByTaskType(taskType._id)
        tracings <- Fox.serialSequence(tasks)(_.annotations).map(_.flatten.filter(_.state.isFinished))
        zip <- AnnotationService.zipAnnotations(tracings, taskType.summary + "_nmls.zip")
      } yield zip

    for {
      tasktype <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
      _ <- ensureTeamAdministration(request.user, tasktype.team) ?~> Messages("notAllowed")
      zip <- createTaskTypeZip(tasktype)
    } yield Ok.sendFile(zip.file)
  }
  
  def userDownload(userId: String) = Authenticated.async { implicit request =>
    for {
      user <- UserService.findOneById(userId, useCache = true) ?~> Messages("user.notFound")
      _ <- user.isEditableBy(request.user) ?~> Messages("notAllowed")
      annotations <- AnnotationService.findTasksOf(user, isFinished = Some(true), limit = Int.MaxValue)
      zipped <- AnnotationService.zipAnnotations(annotations, user.abreviatedName + "_nmls.zip")
    } yield {
      Ok.sendFile(zipped.file)
    }
  }
}
