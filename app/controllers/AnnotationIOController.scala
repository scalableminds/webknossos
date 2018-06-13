package controllers

import javax.inject.Inject
import com.scalableminds.util.io.{NamedEnumeratorStream, ZipIO}
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, SkeletonTracings}
import com.scalableminds.webknossos.datastore.tracings.{TracingReference, TracingType}
import com.typesafe.scalalogging.LazyLogging
import models.annotation.AnnotationState._
import models.annotation.nml.{NmlService, NmlWriter}
import models.annotation.{AnnotationType, _}
import models.binary.{DataSet, DataSetDAO}
import models.project.ProjectSQLDAO
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

    def storeMergedSkeletonTracing(tracings: List[SkeletonTracing], dataSet: DataSet): Fox[TracingReference] = {
      for {
        newTracingReference <- dataSet.dataStore.mergeSkeletonTracingsByContents(SkeletonTracings(tracings), persistTracing=true)
      } yield {
        newTracingReference
      }
    }

    val parsedFiles = request.body.files.foldLeft(NmlService.ZipParseResult()) {
      case (acc, next) => acc.combineWith(NmlService.extractFromFile(next.ref.file, next.filename))
    }

    val parseResultsPrefixed = NmlService.addPrefixesToTreeNames(parsedFiles.parseResults)

    val parseSuccess = parseResultsPrefixed.filter(_.succeeded)

    if (!parsedFiles.isEmpty) {
      val tracings = parseSuccess.flatMap(_.tracing)
      val (skeletonTracings, volumeTracings) = NmlService.splitVolumeAndSkeletonTracings(tracings)
      val name = nameForNmls(parseSuccess.map(_.fileName))
      val description = descriptionForNMLs(parseSuccess.map(_.description))
      if (volumeTracings.nonEmpty) {
        for {
          dataSet: DataSet <- DataSetDAO.findOneBySourceName(volumeTracings.head._1.dataSetName).toFox ?~> Messages("dataSet.notFound", volumeTracings.head._1.dataSetName)
          tracingReference <- dataSet.dataStore.saveVolumeTracing(volumeTracings.head._1, parsedFiles.otherFiles.get(volumeTracings.head._2).map(_.file))
          annotation <- AnnotationService.createFrom(
            request.identity, dataSet, tracingReference, AnnotationType.Explorational, AnnotationSettings.defaultFor(tracingReference.typ), name, description)
        } yield JsonOk(
          Json.obj("annotation" -> Json.obj("typ" -> annotation.typ, "id" -> annotation.id)),
          Messages("nml.file.uploadSuccess")
        )
      } else if (skeletonTracings.nonEmpty) {
        for {
          dataSet: DataSet <- DataSetDAO.findOneBySourceName(skeletonTracings.head.dataSetName).toFox ?~> Messages("dataSet.notFound", skeletonTracings.head.dataSetName)
          mergedTracingReference <- storeMergedSkeletonTracing(skeletonTracings, dataSet)
          annotation <- AnnotationService.createFrom(
            request.identity, dataSet, mergedTracingReference, AnnotationType.Explorational, AnnotationSettings.defaultFor(mergedTracingReference.typ), name, description)
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
    typ match {
      case AnnotationType.View => Fox.failure("Cannot download View annotation")
      case AnnotationType.CompoundProject => downloadProject(id, request.identity)
      case AnnotationType.CompoundTask => downloadTask(id, request.identity)
      case AnnotationType.CompoundTaskType => downloadTaskType(id, request.identity)
      case _ => downloadExplorational(id, typ, request.identity)(securedRequestToUserAwareRequest)
    }
  }

  def downloadExplorational(annotationId: String, typ: String, user: User)(implicit request: UserAwareRequest[_]) = {

    def skeletonToDownloadStream(dataSet: DataSet, annotation: Annotation, name: String) = {
      for {
        tracing <- dataSet.dataStore.getSkeletonTracing(annotation.tracingReference)
      } yield {
        (NmlWriter.toNmlStream(Left(tracing), annotation, dataSet.dataSource.scaleOpt), name + ".nml")
      }
    }

    def volumeToDownloadStream(dataSet: DataSet, annotation: Annotation, name: String) = {
      for {
        (tracing, data) <- dataSet.dataStore.getVolumeTracing(annotation.tracingReference)
      } yield {
        (Enumerator.outputStream { outputStream =>
          ZipIO.zip(
            List(
              new NamedEnumeratorStream(name + ".nml", NmlWriter.toNmlStream(Right(tracing), annotation, dataSet.dataSource.scaleOpt)),
              new NamedEnumeratorStream("data.zip", data)
            ), outputStream)
        }, name + ".zip")
      }
    }

    def tracingToDownloadStream(dataSet: DataSet, annotation: Annotation, name: String) = {
      annotation.tracingReference.typ match {
        case TracingType.skeleton =>
          skeletonToDownloadStream(dataSet, annotation, name)
        case TracingType.volume =>
          volumeToDownloadStream(dataSet, annotation, name)
      }
    }

    for {
      annotation <- findAnnotation(AnnotationIdentifier(typ, annotationId))
      name <- nameForAnnotation(annotation) ?~> Messages("annotation.name.impossible")
      restrictions <- restrictionsFor(AnnotationIdentifier(typ, annotationId))
      _ <- restrictions.allowDownload(user) ?~> Messages("annotation.download.notAllowed")
      dataSet <- DataSetDAO.findOneBySourceName(annotation.dataSetName) ?~> Messages("dataSet.notFound", annotation.dataSetName)
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
      project <- ProjectSQLDAO.findOne(ObjectId(projectId)) ?~> Messages("project.notFound", projectId)
      teamIdBson <- project._team.toBSONObjectId.toFox
      _ <- user.assertTeamManagerOrAdminOf(teamIdBson)
      annotations <- AnnotationDAO.findFinishedForProject(projectId)
      zip <- AnnotationService.zipAnnotations(annotations, project.name + "_nmls.zip")
    } yield {
      Ok.sendFile(zip.file)
    }
  }

  def downloadTask(taskId: String, user: User)(implicit ctx: DBAccessContext) = {
    def createTaskZip(task: TaskSQL): Fox[TemporaryFile] = task.annotations.flatMap { annotations =>
      val finished = annotations.filter(_.state == Finished)
      AnnotationService.zipAnnotations(finished, task._id.toString + "_nmls.zip")
    }

    for {
      task <- TaskSQLDAO.findOne(ObjectId(taskId)).toFox ?~> Messages("task.notFound")
      project <- task.project ?~> Messages("project.notFound")
      _ <- ensureTeamAdministration(user, project._team) ?~> Messages("notAllowed")
      zip <- createTaskZip(task)
    } yield Ok.sendFile(zip.file)
  }

  def downloadTaskType(taskTypeId: String, user: User)(implicit ctx: DBAccessContext) = {
    def createTaskTypeZip(taskType: TaskType) =
      for {
        tasks <- TaskSQLDAO.findAllByTaskType(ObjectId.fromBsonId(taskType._id))
        annotations <- Fox.serialSequence(tasks)(_.annotations).map(_.flatten.filter(_.state == Finished))
        zip <- AnnotationService.zipAnnotations(annotations, taskType.summary + "_nmls.zip")
      } yield zip

    for {
      tasktype <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
      _ <- ensureTeamAdministration(user, tasktype._team) ?~> Messages("notAllowed")
      zip <- createTaskTypeZip(tasktype)
    } yield Ok.sendFile(zip.file)
  }
}
