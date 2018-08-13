package controllers

import javax.inject.Inject
import com.scalableminds.util.io.{NamedEnumeratorStream, ZipIO}
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, SkeletonTracings}
import com.scalableminds.webknossos.datastore.tracings.TracingType
import com.typesafe.scalalogging.LazyLogging
import models.annotation.AnnotationState._
import models.annotation.nml.{NmlService, NmlWriter}
import models.annotation._
import models.binary.{DataSet, DataSetDAO}
import models.project.ProjectDAO
import models.task._
import models.user._
import oxalis.security.WebknossosSilhouette.{SecuredAction, UserAwareRequest}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.Files.TemporaryFile
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.iteratee.Enumerator
import play.api.libs.json.Json
import utils.ObjectId

import scala.concurrent.Future


class AnnotationIOController @Inject()(val messagesApi: MessagesApi)
  extends Controller
    with AnnotationInformationProvider
    with FoxImplicits
    with LazyLogging {

  private def nameForNmls(fileNames: Seq[String]) =
    if (fileNames.size == 1)
      fileNames.headOption.map(_.replaceAll("\\.nml$", ""))
    else
      None

  private def descriptionForNMLs(descriptions: Seq[Option[String]]) =
    if (descriptions.size == 1) descriptions.headOption.flatten.getOrElse("") else ""


  def upload = SecuredAction.async(parse.multipartFormData) { implicit request =>

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

    def storeMergedSkeletonTracing(tracings: List[SkeletonTracing], dataSet: DataSet): Fox[String] = {
      for {
        dataStoreHandler <- dataSet.dataStoreHandler
        newTracingId <- dataStoreHandler.mergeSkeletonTracingsByContents(SkeletonTracings(tracings), persistTracing=true)
      } yield newTracingId
    }

    val parsedFiles = request.body.files.foldLeft(NmlService.ZipParseResult()) {
      case (acc, next) => acc.combineWith(NmlService.extractFromFile(next.ref.file, next.filename))
    }

    val parseResultsPrefixed = NmlService.addPrefixesToTreeNames(parsedFiles.parseResults)

    val parseSuccess = parseResultsPrefixed.filter(_.succeeded)

    if (!parsedFiles.isEmpty) {
      val tracings = parseSuccess.flatMap(_.bothTracingOpts)
      //val (skeletonTracings, volumeTracings) = NmlService.splitVolumeAndSkeletonTracings(tracings)
      val name = nameForNmls(parseSuccess.map(_.fileName))
      val description = descriptionForNMLs(parseSuccess.map(_.description))
      //TODO
      if (volumeTracings.nonEmpty) {
        for {
          dataSet <- DataSetDAO.findOneByName(volumeTracings.head._1.dataSetName).toFox ?~> Messages("dataSet.notFound", volumeTracings.head._1.dataSetName)
          dataStoreHandler <- dataSet.dataStoreHandler
          volumeTracingId <- dataStoreHandler.saveVolumeTracing(volumeTracings.head._1, parsedFiles.otherFiles.get(volumeTracings.head._2).map(_.file))
          annotation <- AnnotationService.createFrom(
            request.identity, dataSet, None, Some(volumeTracingId), AnnotationType.Explorational, name, description)
        } yield JsonOk(
          Json.obj("annotation" -> Json.obj("typ" -> annotation.typ, "id" -> annotation.id)),
          Messages("nml.file.uploadSuccess")
        )
      } else if (skeletonTracings.nonEmpty) {
        for {
          dataSet <- DataSetDAO.findOneByName(skeletonTracings.head.dataSetName).toFox ?~> Messages("dataSet.notFound", skeletonTracings.head.dataSetName)
          mergedSkeltonTracingReference <- storeMergedSkeletonTracing(skeletonTracings, dataSet)
          annotation <- AnnotationService.createFrom(
            request.identity, dataSet, Some(mergedSkeltonTracingReference), None, AnnotationType.Explorational, name, description)
        } yield JsonOk(
          Json.obj("annotation" -> Json.obj("typ" -> annotation.typ, "id" -> annotation.id)),
          Messages("nml.file.uploadSuccess")
        )
      } else {
        returnError(parsedFiles)
      }
    } else {
      returnError(parsedFiles)
    }
  }

  def download(typ: String, id: String) = SecuredAction.async { implicit request =>
    logger.trace(s"Requested download for annotation: $typ/$id")
    for {
      identifier <- AnnotationIdentifier.parse(typ, id)
      result <- identifier.annotationType match {
        case AnnotationType.View => Fox.failure("Cannot download View annotation")
        case AnnotationType.CompoundProject => downloadProject(id, request.identity)
        case AnnotationType.CompoundTask => downloadTask(id, request.identity)
        case AnnotationType.CompoundTaskType => downloadTaskType(id, request.identity)
        case _ => downloadExplorational(id, typ, request.identity)(securedRequestToUserAwareRequest)
      }
    } yield result
  }

  def downloadExplorational(annotationId: String, typ: String, user: User)(implicit request: UserAwareRequest[_]) = {

    def skeletonToDownloadStream(dataSet: DataSet, annotation: Annotation, name: String) = {
      for {
        dataStoreHandler <- dataSet.dataStoreHandler
        skeletonTracingId <- annotation.skeletonTracingId.toFox
        tracing <- dataStoreHandler.getSkeletonTracing(skeletonTracingId)
      } yield {
        (NmlWriter.toNmlStream(Left(tracing), annotation, dataSet.scale), name + ".nml")
      }
    }

    def volumeToDownloadStream(dataSet: DataSet, annotation: Annotation, name: String) = {
      for {
        dataStoreHandler <- dataSet.dataStoreHandler
        volumeTracingId <- annotation.volumeTracingId.toFox
        (tracing, data) <- dataStoreHandler.getVolumeTracing(volumeTracingId)
      } yield {
        (Enumerator.outputStream { outputStream =>
          ZipIO.zip(
            List(
              new NamedEnumeratorStream(name + ".nml", NmlWriter.toNmlStream(Right(tracing), annotation, dataSet.scale)),
              new NamedEnumeratorStream("data.zip", data)
            ), outputStream)
        }, name + ".zip")
      }
    }

    def tracingToDownloadStream(dataSet: DataSet, annotation: Annotation, name: String) = {
      annotation.tracingType match {
        case TracingType.skeleton =>
          skeletonToDownloadStream(dataSet, annotation, name)
        case TracingType.volume =>
          volumeToDownloadStream(dataSet, annotation, name)
        case TracingType.hybrid =>
          Fox.failure("Download for hybrid tracings is not yet implemented")
      }
    }

    for {
      annotation <- provideAnnotation(typ, annotationId)
      restrictions <- restrictionsFor(typ, annotationId)
      name <- nameFor(annotation) ?~> Messages("annotation.name.impossible")
      _ <- restrictions.allowDownload(user) ?~> Messages("annotation.download.notAllowed")
      dataSet <- annotation.dataSet
      (downloadStream, fileName) <- tracingToDownloadStream(dataSet, annotation, name)
    } yield {
      Ok.chunked(downloadStream).withHeaders(
        CONTENT_TYPE ->
          "application/octet-stream",
        CONTENT_DISPOSITION ->
          s"filename=${'"'}${fileName}${'"'}")
    }
  }

  def downloadProject(projectId: String, user: User)(implicit ctx: DBAccessContext) = {
    for {
      projectIdValidated <- ObjectId.parse(projectId)
      project <- ProjectDAO.findOne(projectIdValidated) ?~> Messages("project.notFound", projectId)
      _ <- Fox.assertTrue(user.isTeamManagerOrAdminOf(project._team))
      annotations <- AnnotationDAO.findAllFinishedForProject(projectIdValidated)
      zip <- AnnotationService.zipAnnotations(annotations, project.name + "_nmls.zip")
    } yield {
      Ok.sendFile(zip.file)
    }
  }

  def downloadTask(taskId: String, user: User)(implicit ctx: DBAccessContext) = {
    def createTaskZip(task: Task): Fox[TemporaryFile] = task.annotations.flatMap { annotations =>
      val finished = annotations.filter(_.state == Finished)
      AnnotationService.zipAnnotations(finished, task._id.toString + "_nmls.zip")
    }

    for {
      task <- TaskDAO.findOne(ObjectId(taskId)).toFox ?~> Messages("task.notFound")
      project <- task.project ?~> Messages("project.notFound")
      _ <- ensureTeamAdministration(user, project._team) ?~> Messages("notAllowed")
      zip <- createTaskZip(task)
    } yield Ok.sendFile(zip.file)
  }

  def downloadTaskType(taskTypeId: String, user: User)(implicit ctx: DBAccessContext) = {
    def createTaskTypeZip(taskType: TaskType) =
      for {
        tasks <- TaskDAO.findAllByTaskType(taskType._id)
        annotations <- Fox.serialCombined(tasks)(_.annotations).map(_.flatten).toFox
        finishedAnnotations = annotations.filter(_.state == Finished)
        zip <- AnnotationService.zipAnnotations(finishedAnnotations, taskType.summary + "_nmls.zip")
      } yield zip

    for {
      taskTypeIdValidated <- ObjectId.parse(taskTypeId)
      tasktype <- TaskTypeDAO.findOne(taskTypeIdValidated) ?~> Messages("taskType.notFound")
      _ <- ensureTeamAdministration(user, tasktype._team) ?~> Messages("notAllowed")
      zip <- createTaskTypeZip(tasktype)
    } yield Ok.sendFile(zip.file)
  }
}
