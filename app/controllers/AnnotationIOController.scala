package controllers

import akka.actor.ActorSystem
import akka.stream.ActorMaterializer
import akka.stream.scaladsl._
import akka.util.ByteString
import javax.inject.Inject
import com.scalableminds.util.io.{NamedEnumeratorStream, ZipIO}
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, SkeletonTracings}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.tracings.TracingType
import com.typesafe.scalalogging.LazyLogging
import models.annotation.AnnotationState._
import models.annotation.nml.{NmlResults, NmlService, NmlWriter}
import models.annotation._
import models.binary.{DataSet, DataSetDAO, DataSetService}
import models.project.ProjectDAO
import models.task._
import models.user._
import oxalis.security.WkEnv
import com.mohiva.play.silhouette.api.Silhouette
import com.mohiva.play.silhouette.api.actions.{SecuredRequest, UserAwareRequest}
import play.api.http.HttpEntity
import play.api.i18n.{Messages, MessagesApi, MessagesProvider}
import play.api.libs.Files.TemporaryFile
import play.api.libs.iteratee.Enumerator
import play.api.libs.iteratee.streams.IterateeStreams
import play.api.libs.json.Json
import play.api.mvc.{ResponseHeader, Result}
import utils.ObjectId

import scala.concurrent.{ExecutionContext, Future}


class AnnotationIOController @Inject()(nmlWriter: NmlWriter,
                                       annotationDAO: AnnotationDAO,
                                       projectDAO: ProjectDAO,
                                       dataSetDAO: DataSetDAO,
                                       dataSetService: DataSetService,
                                       userService: UserService,
                                       taskDAO: TaskDAO,
                                       taskTypeDAO: TaskTypeDAO,
                                       annotationService: AnnotationService,
                                       sil: Silhouette[WkEnv],
                                       provider: AnnotationInformationProvider,
                                       nmlService: NmlService)
                                      (implicit ec: ExecutionContext)
  extends Controller
    with FoxImplicits
    with LazyLogging {
  implicit val actorSystem = ActorSystem()
  implicit val materializer = ActorMaterializer()

  private def nameForNmls(fileNames: Seq[String]) =
    if (fileNames.size == 1)
      fileNames.headOption.map(_.replaceAll("\\.nml$", ""))
    else
      None

  private def descriptionForNMLs(descriptions: Seq[Option[String]]) =
    if (descriptions.size == 1) descriptions.headOption.flatten.getOrElse("") else ""


  def upload = sil.SecuredAction.async(parse.multipartFormData) { implicit request =>

    def returnError(zipParseResult: NmlResults.ZipParseResult) = {
      if (zipParseResult.containsFailure) {
        val errors = zipParseResult.parseResults.flatMap {
          case result: NmlResults.NmlParseFailure =>
            Some("error" -> Messages("nml.file.invalid", result.fileName, result.error))
          case _ => None
        }
        Future.successful(JsonBadRequest(errors))
      } else {
        Future.successful(JsonBadRequest(Messages("nml.file.noFile")))
      }
    }

    def assertAllOnSameDataSet(skeletons: List[SkeletonTracing], volume: Option[VolumeTracing]): Fox[String] =
      for {
        dataSetName <- volume.map(_.dataSetName).orElse(skeletons.headOption.map(_.dataSetName)).toFox
        _ <- bool2Fox(skeletons.forall(_.dataSetName == dataSetName))
      } yield dataSetName

    val shouldCreateGroupForEachFile: Boolean = request.body.dataParts("createGroupForEachFile")(0) == "true"

    val parsedFiles = request.body.files.foldLeft(NmlResults.ZipParseResult()) {
      case (acc, next) => acc.combineWith(nmlService.extractFromFile(next.ref.file, next.filename))
    }


    val tracingsProcessed =
      if (shouldCreateGroupForEachFile)
        nmlService.wrapTreesInGroups(parsedFiles.parseResults)
      else
        nmlService.addPrefixesToTreeNames(parsedFiles.parseResults)

    val parseSuccess = tracingsProcessed.filter(_.succeeded)

    if (!parsedFiles.isEmpty) {
      val tracings = parseSuccess.flatMap(_.bothTracingOpts)
      val (skeletonTracings, volumeTracingsWithDataLocations) = nmlService.splitVolumeAndSkeletonTracings(tracings)
      val name = nameForNmls(parseSuccess.map(_.fileName))
      val description = descriptionForNMLs(parseSuccess.map(_.description))

      for {
        _ <- bool2Fox(skeletonTracings.nonEmpty || volumeTracingsWithDataLocations.nonEmpty) ?~> "nml.file.noFile"
        _ <- bool2Fox(volumeTracingsWithDataLocations.size <= 1) ?~> "nml.file.multipleVolumes"
        dataSetName <- assertAllOnSameDataSet(skeletonTracings, volumeTracingsWithDataLocations.headOption.map(_._1)) ?~> "nml.file.differentDatasets"
        dataSet <- dataSetDAO.findOneByName(dataSetName)
        dataStoreHandler <- dataSetService.handlerFor(dataSet)
        volumeTracingIdOpt <- Fox.runOptional(volumeTracingsWithDataLocations.headOption){ v =>
          dataStoreHandler.saveVolumeTracing(v._1, parsedFiles.otherFiles.get(v._2).map(_.file))
        }
        mergedSkeletonTracingIdOpt <- Fox.runOptional(skeletonTracings.headOption){ s =>
          dataStoreHandler.mergeSkeletonTracingsByContents(SkeletonTracings(skeletonTracings), persistTracing=true)
        }
        annotation <- annotationService.createFrom(
          request.identity, dataSet, mergedSkeletonTracingIdOpt, volumeTracingIdOpt, AnnotationType.Explorational, name, description)
      } yield JsonOk(
        Json.obj("annotation" -> Json.obj("typ" -> annotation.typ, "id" -> annotation.id)),
        Messages("nml.file.uploadSuccess")
      )
    } else {
      returnError(parsedFiles)
    }
  }

  def download(typ: String, id: String) = sil.SecuredAction.async { implicit request =>
    logger.trace(s"Requested download for annotation: $typ/$id")
    for {
      identifier <- AnnotationIdentifier.parse(typ, id)
      result <- identifier.annotationType match {
        case AnnotationType.View => Fox.failure("Cannot download View annotation")
        case AnnotationType.CompoundProject => downloadProject(id, request.identity)
        case AnnotationType.CompoundTask => downloadTask(id, request.identity)
        case AnnotationType.CompoundTaskType => downloadTaskType(id, request.identity)
        case _ => downloadExplorational(id, typ, request.identity)
      }
    } yield result
  }

  def downloadExplorational(annotationId: String, typ: String, issuingUser: User)(implicit ctx: DBAccessContext, m: MessagesProvider) = {

    def skeletonToDownloadStream(dataSet: DataSet, annotation: Annotation, name: String) = {
      for {
        dataStoreHandler <- dataSetService.handlerFor(dataSet)
        skeletonTracingId <- annotation.skeletonTracingId.toFox
        tracing <- dataStoreHandler.getSkeletonTracing(skeletonTracingId)
        user <- userService.findOneById(annotation._user, useCache = true)
        taskOpt <- Fox.runOptional(annotation._task)(taskDAO.findOne)
      } yield {
        (nmlWriter.toNmlStream(Some(tracing), None, Some(annotation), dataSet.scale, Some(user), taskOpt), name + ".nml")
      }
    }

    def volumeOrHybridToDownloadStream(dataSet: DataSet, annotation: Annotation, name: String) = {
      for {
        dataStoreHandler <- dataSetService.handlerFor(dataSet)
        volumeTracingId <- annotation.volumeTracingId.toFox
        (volumeTracing, data: Source[ByteString, _]) <- dataStoreHandler.getVolumeTracing(volumeTracingId)
        skeletonTracingOpt <- Fox.runOptional(annotation.skeletonTracingId)(dataStoreHandler.getSkeletonTracing)
        user <- userService.findOneById(annotation._user, useCache = true)
        taskOpt <- Fox.runOptional(annotation._task)(taskDAO.findOne)
      } yield {
        val dataEnumerator = Enumerator.fromStream(data.runWith(StreamConverters.asInputStream()))
        (Enumerator.outputStream { outputStream =>
          ZipIO.zip(
            List(
              new NamedEnumeratorStream(name + ".nml", nmlWriter.toNmlStream(skeletonTracingOpt, Some(volumeTracing), Some(annotation), dataSet.scale, Some(user), taskOpt)),
              new NamedEnumeratorStream("data.zip", dataEnumerator)
            ), outputStream)
        }, name + ".zip")
      }
    }

    def tracingToDownloadStream(dataSet: DataSet, annotation: Annotation, name: String) = {
      if (annotation.tracingType == TracingType.skeleton)
        skeletonToDownloadStream(dataSet, annotation, name)
      else
        volumeOrHybridToDownloadStream(dataSet, annotation, name)
    }

    for {
      annotation <- provider.provideAnnotation(typ, annotationId, issuingUser)
      restrictions <- provider.restrictionsFor(typ, annotationId)
      name <- provider.nameFor(annotation) ?~> Messages("annotation.name.impossible")
      _ <- restrictions.allowDownload(issuingUser) ?~> Messages("annotation.download.notAllowed")
      dataSet <- dataSetDAO.findOne(annotation._dataSet)(GlobalAccessContext) ?~> "dataSet.notFound"
      (downloadStream, fileName) <- tracingToDownloadStream(dataSet, annotation, name)
    } yield {
      Ok.chunked(Source.fromPublisher(IterateeStreams.enumeratorToPublisher(downloadStream)))
        .as(if (fileName.toLowerCase.endsWith(".zip")) "application/zip" else "application/xml")
        .withHeaders(
        CONTENT_DISPOSITION ->
          s"attachment;filename=${'"'}${fileName}${'"'}")
    }
  }

  def downloadProject(projectId: String, user: User)(implicit ctx: DBAccessContext, m: MessagesProvider) = {
    for {
      projectIdValidated <- ObjectId.parse(projectId)
      project <- projectDAO.findOne(projectIdValidated) ?~> Messages("project.notFound", projectId)
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(user, project._team))
      annotations <- annotationDAO.findAllFinishedForProject(projectIdValidated)
      zip <- annotationService.zipAnnotations(annotations, project.name + "_nmls.zip")
    } yield {
      Ok.sendFile(zip.file, inline = false)
    }
  }

  def downloadTask(taskId: String, user: User)(implicit ctx: DBAccessContext, m: MessagesProvider) = {
    def createTaskZip(task: Task): Fox[TemporaryFile] = annotationService.annotationsFor(task._id).flatMap { annotations =>
      val finished = annotations.filter(_.state == Finished)
      annotationService.zipAnnotations(finished, task._id.toString + "_nmls.zip")
    }

    for {
      task <- taskDAO.findOne(ObjectId(taskId)).toFox ?~> Messages("task.notFound")
      project <- projectDAO.findOne(task._project) ?~> Messages("project.notFound")
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(user, project._team)) ?~> Messages("notAllowed")
      zip <- createTaskZip(task)
    } yield Ok.sendFile(zip.file, inline = false)
  }

  def downloadTaskType(taskTypeId: String, user: User)(implicit ctx: DBAccessContext, m: MessagesProvider) = {
    def createTaskTypeZip(taskType: TaskType) =
      for {
        tasks <- taskDAO.findAllByTaskType(taskType._id)
        annotations <- Fox.serialCombined(tasks)(task => annotationService.annotationsFor(task._id)).map(_.flatten).toFox
        finishedAnnotations = annotations.filter(_.state == Finished)
        zip <- annotationService.zipAnnotations(finishedAnnotations, taskType.summary + "_nmls.zip")
      } yield zip

    for {
      taskTypeIdValidated <- ObjectId.parse(taskTypeId)
      tasktype <- taskTypeDAO.findOne(taskTypeIdValidated) ?~> Messages("taskType.notFound")
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(user, tasktype._team)) ?~> Messages("notAllowed")
      zip <- createTaskTypeZip(tasktype)
    } yield Ok.sendFile(zip.file, inline = false)
  }
}
