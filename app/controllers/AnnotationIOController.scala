package controllers

import javax.inject.Inject

import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import models.annotation.{AnnotationType, _}
import models.project.{Project, ProjectDAO}
import models.task.{Task, _}
import models.user._
import org.apache.commons.io.FilenameUtils
import oxalis.security.Secured
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.Files.TemporaryFile
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import play.api.mvc.MultipartFormData

import scala.concurrent.Future

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
    //TODO: RocksDB
    Fox.successful(JsonOk)
//    def isZipFile(f: MultipartFormData.FilePart[TemporaryFile]): Boolean =
//      f.contentType.contains("application/zip") || FilenameUtils.isExtension(f.filename, "zip")
//
//    def parseFile(f: MultipartFormData.FilePart[TemporaryFile]) = {
//      if (isZipFile(f)) {
//        NMLService.extractFromZip(f.ref.file, Some(f.filename))
//      } else {
//        val nml = NMLService.extractFromNML(f.ref.file, f.filename)
//        NMLService.ZipParseResult(List(nml), Map.empty)
//      }
//    }
//
//    def returnError(parsedFiles: NMLService.ZipParseResult) = {
//      if (parsedFiles.containsFailure) {
//        val errors = parsedFiles.nmls.flatMap {
//          case result: NMLService.NMLParseFailure =>
//            Some("error" -> Messages("nml.file.invalid", result.fileName, result.error))
//          case _                                  => None
//        }
//        Future.successful(JsonBadRequest(errors))
//      } else {
//        Future.successful(JsonBadRequest(Messages("nml.file.noFile")))
//      }
//    }
//
//    val parsedFiles = request.body.files.foldLeft(NMLService.ZipParseResult()) {
//      case (acc, next) => acc.combineWith(parseFile(next))
//    }
//    if (!parsedFiles.isEmpty) {
//      val parseSuccess = parsedFiles.nmls.filter(_.succeeded)
//      val fileNames = parseSuccess.map(_.fileName)
//      val nmls = parseSuccess.flatMap(_.nml)
//      val name = nameForNMLs(fileNames)
//      for {
//        annotation <- AnnotationService.createAnnotationFrom(
//          request.user, nmls, parsedFiles.otherFiles, AnnotationType.Explorational, name)
//      } yield JsonOk(
//        Json.obj("annotation" -> Json.obj("typ" -> annotation.typ, "id" -> annotation.id)),
//        Messages("nml.file.uploadSuccess")
//      )
//    } else {
//      returnError(parsedFiles)
//    }
  }

  def projectDownload(projectName: String) = Authenticated.async { implicit request =>
    Fox.successful(Ok)
/*    def createProjectZip(project: Project) =
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
    }*/
  }

  def taskDownload(taskId: String) = Authenticated.async { implicit request =>
    Fox.successful(Ok)
    /*
    def createTaskZip(task: Task) = task.annotations.flatMap { annotations =>
      val finished = annotations.filter(_.state.isFinished)
      AnnotationService.zipAnnotations(finished, task.id + "_nmls.zip")
    }

    for {
      task <- TaskDAO.findOneById(taskId) ?~> Messages("task.notFound")
      _ <- ensureTeamAdministration(request.user, task.team) ?~> Messages("notAllowed")
      zip <- createTaskZip(task)
    } yield Ok.sendFile(zip.file)*/
  }

  def taskTypeDownload(taskTypeId: String) = Authenticated.async { implicit request =>
    Fox.successful(Ok)
    /*
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
    } yield Ok.sendFile(zip.file)*/
  }

  def userDownload(userId: String) = Authenticated.async { implicit request =>
    Fox.successful(Ok)
    /*
    for {
      user <- UserService.findOneById(userId, useCache = true) ?~> Messages("user.notFound")
      _ <- user.isEditableBy(request.user) ?~> Messages("notAllowed")
      annotations <- AnnotationService.findTasksOf(user, isFinished = Some(true), limit = Int.MaxValue)
      zipped <- AnnotationService.zipAnnotations(annotations, user.abreviatedName + "_nmls.zip")
    } yield {
      Ok.sendFile(zipped.file)
    }*/
  }
}
