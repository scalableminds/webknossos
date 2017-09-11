package controllers

import javax.inject.Inject

import com.scalableminds.braingames.datastore.SkeletonTracing.{SkeletonTracing, SkeletonTracings}
import com.scalableminds.braingames.datastore.tracings.TracingReference
import com.scalableminds.braingames.datastore.tracings.skeleton.NmlWriter
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import models.annotation.{AnnotationType, _}
import models.binary.{DataSet, DataSetDAO}
import models.project.{Project, ProjectDAO}
import models.task.{Task, _}
import models.user._
import org.apache.commons.io.FilenameUtils
import oxalis.security.{Secured, UserAwareRequest}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.Files.TemporaryFile
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import play.api.mvc.MultipartFormData

import scala.concurrent.Future

class AnnotationIOController @Inject()(val messagesApi: MessagesApi)
  extends Controller
    with Secured
    with AnnotationInformationProvider
    with FoxImplicits
    with LazyLogging {

  private def nameForNmls(fileNames: Seq[String]) =
    if (fileNames.size == 1)
      fileNames.headOption.map(_.replaceAll("\\.nml$", ""))
    else
      None

  def upload = Authenticated.async(parse.multipartFormData) { implicit request =>
    def isZipFile(f: MultipartFormData.FilePart[TemporaryFile]): Boolean =
      f.contentType.contains("application/zip") || FilenameUtils.isExtension(f.filename, "zip")

    def parseFile(f: MultipartFormData.FilePart[TemporaryFile]) = {
      if (isZipFile(f)) {
        NmlService.extractFromZip(f.ref.file, Some(f.filename))
      } else {
        val nml = NmlService.extractFromNml(f.ref.file, f.filename)
        NmlService.ZipParseResult(List(nml), Map.empty)
      }
    }

    def returnError(zipParseResult: NmlService.ZipParseResult) = {
      if (zipParseResult.containsFailure) {
        val errors = zipParseResult.parseResults.flatMap {
          case result: NmlService.NmlParseFailure =>
            Some("error" -> Messages("nml.file.invalid", result.fileName, result.error))
          case _ => None
        }
        Future.successful(JsonBadRequest(errors))
      } else {
        Future.successful(JsonBadRequest(Messages("nml.file.noFile")))
      }
    }

    def storeMergedSkeletonTracing(tracings: List[SkeletonTracing], dataSet: DataSet): Fox[TracingReference] = {
      for {
        newTracingReference <- dataSet.dataStore.mergeSkeletonTracingsByContents(SkeletonTracings(tracings), persistTracing=true)
      } yield {
        newTracingReference
      }
    }

    val parsedFiles = request.body.files.foldLeft(NmlService.ZipParseResult()) {
      case (acc, next) => acc.combineWith(parseFile(next))
    }
    if (!parsedFiles.isEmpty) {
      val parseSuccess = parsedFiles.parseResults.filter(_.succeeded)
      val fileNames = parseSuccess.map(_.fileName)
      val tracings = parseSuccess.flatMap(_.tracing)
      val (skeletonTracings, volumeTracings) = NmlService.splitVolumeAndSkeletonTracings(tracings)
      val name = nameForNmls(fileNames)
      if (volumeTracings.nonEmpty)
        //TODO: RocksDB: process uploaded volume tracing
        returnError(parsedFiles)
      else {
        for {
          dataSet: DataSet <- DataSetDAO.findOneBySourceName(skeletonTracings.head.dataSetName).toFox
          mergedTracingReference <- storeMergedSkeletonTracing(skeletonTracings, dataSet)
          annotation <- AnnotationService.createFrom(
            request.user, dataSet, mergedTracingReference, AnnotationType.Explorational, AnnotationSettings.defaultFor(mergedTracingReference.typ), name)
        } yield JsonOk(
          Json.obj("annotation" -> Json.obj("typ" -> annotation.typ, "id" -> annotation.id)),
          Messages("nml.file.uploadSuccess")
        )
      }
    } else {
      returnError(parsedFiles)
    }
  }


  def download(typ: String, id: String) = UserAwareAction.async { implicit request =>
    logger.trace(s"Requested download for annotation: $typ/$id")
    //TODO: RocksDB: prettier dispatch?
    request.userOpt match {
      case Some(user) => {
        if (typ == AnnotationType.View.toString) Fox.failure("Cannot download View annotation")
        else if (typ == AnnotationType.CompoundProject.toString) downloadProject(id, user)
        else if (typ == AnnotationType.CompoundTask.toString) downloadTask(id, user)
        else if (typ == AnnotationType.CompoundTaskType.toString) downloadTaskType(id, user)
        else downloadExplorational(id, typ, request.userOpt)
      }
      case None => {
        if (typ == AnnotationType.Explorational.toString) downloadExplorational(id, typ, request.userOpt)
        else Fox.failure("Failed to download annotation")
      }
    }
  }

  def downloadExplorational(annotationId: String, typ: String, user: Option[User])(implicit request: UserAwareRequest[_]) = {
    for {
      annotation <- findAnnotation(AnnotationIdentifier(typ, annotationId))
      name <- nameForAnnotation(annotation) ?~> Messages("annotation.name.impossible")
      restrictions <- restrictionsFor(AnnotationIdentifier(typ, annotationId))
      _ <- restrictions.allowDownload(user) ?~> Messages("annotation.download.notAllowed")
      dataSet <- DataSetDAO.findOneBySourceName(annotation.dataSetName) ?~> Messages("dataSet.notFound", annotation.dataSetName)
      tracing <- dataSet.dataStore.getSkeletonTracing(annotation.tracingReference) //TODO: RocksDB: what if it is a volume tracing?
      scale <- dataSet.dataSource.toUsable.map(_.scale)
      nmlStream = NmlWriter.toNmlStream(Left(tracing), scale)
    } yield {
      Ok.chunked(nmlStream).withHeaders(
        CONTENT_TYPE ->
          "application/octet-stream",
        CONTENT_DISPOSITION ->
          s"filename=${'"'}${name}.nml${'"'}")
    }
  }

  def downloadProject(projectId: String, user: User)(implicit ctx: DBAccessContext) = {
    def createProjectZip(project: Project) =
      for {
        tasks <- TaskDAO.findAllByProject(project.name)
        annotations <- Fox.serialSequence(tasks)(_.annotations).map(_.flatten.filter(_.state.isFinished))
        zip <- AnnotationService.zipAnnotations(annotations, project.name + "_nmls.zip")
      } yield zip

    for {
      project <- ProjectDAO.findOneById(projectId) ?~> Messages("project.notFound", projectId)
      _ <- user.adminTeamNames.contains(project.team) ?~> Messages("notAllowed")
      zip <- createProjectZip(project)
    } yield {
      Ok.sendFile(zip.file)
    }
  }

  def downloadTask(taskId: String, user: User)(implicit ctx: DBAccessContext) = {
    def createTaskZip(task: Task): Fox[TemporaryFile] = task.annotations.flatMap { annotations =>
      val finished = annotations.filter(_.state.isFinished)
      AnnotationService.zipAnnotations(finished, task.id + "_nmls.zip")
    }

    for {
      task <- TaskDAO.findOneById(taskId).toFox ?~> Messages("task.notFound")
      _ <- ensureTeamAdministration(user, task.team) ?~> Messages("notAllowed")
      zip <- createTaskZip(task)
    } yield Ok.sendFile(zip.file)
  }

  def downloadTaskType(taskTypeId: String, user: User)(implicit ctx: DBAccessContext) = {
    def createTaskTypeZip(taskType: TaskType) =
      for {
        tasks <- TaskDAO.findAllByTaskType(taskType._id)
        annotations <- Fox.serialSequence(tasks)(_.annotations).map(_.flatten.filter(_.state.isFinished))
        zip <- AnnotationService.zipAnnotations(annotations, taskType.summary + "_nmls.zip")
      } yield zip

    for {
      tasktype <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
      _ <- ensureTeamAdministration(user, tasktype.team) ?~> Messages("notAllowed")
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
