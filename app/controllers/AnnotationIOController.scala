package controllers

import java.io.File

import akka.actor.ActorSystem
import akka.stream.ActorMaterializer
import akka.stream.scaladsl._
import akka.util.ByteString
import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.io.{NamedEnumeratorStream, ZipIO}
import com.scalableminds.util.tools.{Fox, FoxImplicits, TextUtils}
import com.scalableminds.webknossos.datastore.models.datasource.{AbstractSegmentationLayer, SegmentationLayer}
import com.scalableminds.webknossos.tracingstore.SkeletonTracing.{SkeletonTracing, SkeletonTracingOpt, SkeletonTracings}
import com.scalableminds.webknossos.tracingstore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeTracingDefaults
import com.scalableminds.webknossos.tracingstore.tracings.{ProtoGeometryImplicits, TracingType}
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import models.annotation.AnnotationState._
import models.annotation._
import models.annotation.nml.{NmlResults, NmlService, NmlWriter}
import models.binary.{DataSet, DataSetDAO, DataSetService}
import models.project.ProjectDAO
import models.task._
import models.team.OrganizationDAO
import models.user._
import oxalis.security.WkEnv
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.Files.TemporaryFile
import play.api.libs.iteratee.Enumerator
import play.api.libs.iteratee.streams.IterateeStreams
import play.api.libs.json.Json
import utils.ObjectId

import scala.concurrent.{ExecutionContext, Future}

class AnnotationIOController @Inject()(nmlWriter: NmlWriter,
                                       annotationDAO: AnnotationDAO,
                                       projectDAO: ProjectDAO,
                                       dataSetDAO: DataSetDAO,
                                       organizationDAO: OrganizationDAO,
                                       dataSetService: DataSetService,
                                       userService: UserService,
                                       taskDAO: TaskDAO,
                                       taskTypeDAO: TaskTypeDAO,
                                       tracingStoreService: TracingStoreService,
                                       annotationService: AnnotationService,
                                       sil: Silhouette[WkEnv],
                                       provider: AnnotationInformationProvider,
                                       nmlService: NmlService)(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits
    with ProtoGeometryImplicits
    with LazyLogging {
  implicit val actorSystem = ActorSystem()
  implicit val materializer = ActorMaterializer()

  private def nameForUploaded(fileNames: Seq[String]) =
    if (fileNames.size == 1)
      fileNames.headOption.map(_.replaceAll("\\.nml$", "").replaceAll("\\.zip", ""))
    else
      None

  private def descriptionForNMLs(descriptions: Seq[Option[String]]) =
    if (descriptions.size == 1) descriptions.headOption.flatten.getOrElse("") else ""

  def upload = sil.SecuredAction.async(parse.multipartFormData) { implicit request =>
    def returnError(zipParseResult: NmlResults.ZipParseResult) =
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

    def assertAllOnSameDataSet(skeletons: List[SkeletonTracing], volume: Option[VolumeTracing]): Fox[String] =
      for {
        dataSetName <- volume.map(_.dataSetName).orElse(skeletons.headOption.map(_.dataSetName)).toFox
        _ <- bool2Fox(skeletons.forall(_.dataSetName == dataSetName))
      } yield dataSetName

    def assertAllOnSameOrganization(organizationNames: List[String]) =
      if (organizationNames.isEmpty) Fox.successful(None)
      else {
        for {
          organizationName <- organizationNames.headOption.toFox
          _ <- bool2Fox(organizationNames.forall(name => name == organizationName))
        } yield Some(organizationName)
      }

    log {

      val shouldCreateGroupForEachFile: Boolean =
        request.body.dataParts("createGroupForEachFile").headOption.contains("true")

      val overwritingDataSetName: Option[String] =
        request.body.dataParts.get("datasetName").flatMap(_.headOption)

      val parsedFiles =
        nmlService.extractFromFiles(request.body.files.map(f => (new File(f.ref.path.toString), f.filename)),
                                    useZipName = true,
                                    overwritingDataSetName)

      val tracingsProcessed =
        if (shouldCreateGroupForEachFile)
          nmlService.wrapTreesInGroups(parsedFiles.parseResults)
        else
          nmlService.addPrefixesToTreeNames(parsedFiles.parseResults)

      val parseSuccesses = tracingsProcessed.filter(_.succeeded)

      if (!parsedFiles.isEmpty) {
        val tracings = parseSuccesses.flatMap(_.bothTracingOpts)
        val (skeletonTracings, volumeTracingsWithDataLocations) = nmlService.splitVolumeAndSkeletonTracings(tracings)
        val name = nameForUploaded(parseSuccesses.map(_.fileName))
        val description = descriptionForNMLs(parseSuccesses.map(_.description))

        for {
          _ <- bool2Fox(skeletonTracings.nonEmpty || volumeTracingsWithDataLocations.nonEmpty) ?~> "nml.file.noFile"
          _ <- bool2Fox(volumeTracingsWithDataLocations.isEmpty || volumeTracingsWithDataLocations.tail.isEmpty) ?~> "nml.file.multipleVolumes"
          dataSetName <- assertAllOnSameDataSet(skeletonTracings, volumeTracingsWithDataLocations.headOption.map(_._1)) ?~> "nml.file.differentDatasets"
          organizationNameOpt <- assertAllOnSameOrganization(parseSuccesses.flatMap(s => s.organizationName)) ?~> "nml.file.differentDatasets"
          organizationIdOpt <- Fox.runOptional(organizationNameOpt) {
            organizationDAO.findOneByName(_)(GlobalAccessContext).map(_._id)
          } ?~> Messages("organization.notFound", organizationNameOpt.getOrElse("")) ~> NOT_FOUND
          organizationId <- Fox.fillOption(organizationIdOpt) {
            dataSetDAO.getOrganizationForDataSet(dataSetName)(GlobalAccessContext)
          } ?~> Messages("dataSet.noAccess", dataSetName) ~> FORBIDDEN
          dataSet <- dataSetDAO.findOneByNameAndOrganization(dataSetName, organizationId) ?~> Messages(
            "dataSet.noAccess",
            dataSetName) ~> FORBIDDEN
          tracingStoreClient <- tracingStoreService.clientFor(dataSet)
          volumeTracingIdOpt <- Fox.runOptional(volumeTracingsWithDataLocations.headOption) { v =>
            for {
              processedVolumeTracing <- adaptPropertiesToFallbackLayer(v._1, dataSet)
              savedTracingId <- tracingStoreClient
                .saveVolumeTracing(processedVolumeTracing, parsedFiles.otherFiles.get(v._2).map(_.path.toFile))
            } yield savedTracingId
          }
          mergedSkeletonTracingIdOpt <- Fox.runOptional(skeletonTracings.headOption) { _ =>
            tracingStoreClient.mergeSkeletonTracingsByContents(
              SkeletonTracings(skeletonTracings.map(t => SkeletonTracingOpt(Some(t)))),
              persistTracing = true)
          }
          annotation <- annotationService.createFrom(request.identity,
                                                     dataSet,
                                                     mergedSkeletonTracingIdOpt,
                                                     volumeTracingIdOpt,
                                                     AnnotationType.Explorational,
                                                     name,
                                                     description)
        } yield
          JsonOk(
            Json.obj("annotation" -> Json.obj("typ" -> annotation.typ, "id" -> annotation.id)),
            Messages("nml.file.uploadSuccess")
          )
      } else {
        returnError(parsedFiles)
      }
    }
  }

  private def adaptPropertiesToFallbackLayer(volumeTracing: VolumeTracing, dataSet: DataSet)(
      implicit ctx: DBAccessContext): Fox[VolumeTracing] =
    for {
      dataSource <- dataSetService.dataSourceFor(dataSet).flatMap(_.toUsable)
      fallbackLayer = dataSource.dataLayers.flatMap {
        case layer: SegmentationLayer if volumeTracing.fallbackLayer contains layer.name         => Some(layer)
        case layer: AbstractSegmentationLayer if volumeTracing.fallbackLayer contains layer.name => Some(layer)
        case _                                                                                   => None
      }.headOption
    } yield {
      volumeTracing.copy(
        boundingBox =
          if (volumeTracing.boundingBox.isEmpty) boundingBoxToProto(dataSource.boundingBox)
          else volumeTracing.boundingBox,
        elementClass = fallbackLayer
          .map(layer => elementClassToProto(layer.elementClass))
          .getOrElse(elementClassToProto(VolumeTracingDefaults.elementClass)),
        fallbackLayer = fallbackLayer.map(_.name),
        largestSegmentId = fallbackLayer.map(_.largestSegmentId).getOrElse(VolumeTracingDefaults.largestSegmentId)
      )
    }

  def download(typ: String,
               id: String,
               skeletonVersion: Option[Long],
               volumeVersion: Option[Long],
               skipVolumeData: Option[Boolean]) =
    sil.SecuredAction.async { implicit request =>
      logger.trace(s"Requested download for annotation: $typ/$id")
      for {
        identifier <- AnnotationIdentifier.parse(typ, id)
        result <- identifier.annotationType match {
          case AnnotationType.View            => Fox.failure("Cannot download View annotation")
          case AnnotationType.CompoundProject => downloadProject(id, request.identity, skipVolumeData.getOrElse(false))
          case AnnotationType.CompoundTask    => downloadTask(id, request.identity, skipVolumeData.getOrElse(false))
          case AnnotationType.CompoundTaskType =>
            downloadTaskType(id, request.identity, skipVolumeData.getOrElse(false))
          case _ =>
            downloadExplorational(id,
                                  typ,
                                  request.identity,
                                  skeletonVersion,
                                  volumeVersion,
                                  skipVolumeData.getOrElse(false))
        }
      } yield result
    }

  private def downloadExplorational(annotationId: String,
                                    typ: String,
                                    issuingUser: User,
                                    skeletonVersion: Option[Long],
                                    volumeVersion: Option[Long],
                                    skipVolumeData: Boolean)(implicit ctx: DBAccessContext, m: MessagesProvider) = {

    def skeletonToDownloadStream(dataSet: DataSet, annotation: Annotation, name: String, organizationName: String) =
      for {
        tracingStoreClient <- tracingStoreService.clientFor(dataSet)
        skeletonTracingId <- annotation.skeletonTracingId.toFox
        tracing <- tracingStoreClient.getSkeletonTracing(skeletonTracingId, skeletonVersion)
        user <- userService.findOneById(annotation._user, useCache = true)
        taskOpt <- Fox.runOptional(annotation._task)(taskDAO.findOne)
      } yield {
        (nmlWriter.toNmlStream(Some(tracing),
                               None,
                               Some(annotation),
                               dataSet.scale,
                               None,
                               organizationName,
                               Some(user),
                               taskOpt),
         name + ".nml")
      }

    def volumeOrHybridToDownloadStream(dataSet: DataSet,
                                       annotation: Annotation,
                                       name: String,
                                       organizationName: String) =
      for {
        tracingStoreClient <- tracingStoreService.clientFor(dataSet)
        volumeTracingId <- annotation.volumeTracingId.toFox
        (volumeTracing, data: Option[Source[ByteString, _]]) <- tracingStoreClient.getVolumeTracing(volumeTracingId,
                                                                                                    volumeVersion,
                                                                                                    skipVolumeData)
        skeletonTracingOpt <- Fox.runOptional(annotation.skeletonTracingId)(skeletonId =>
          tracingStoreClient.getSkeletonTracing(skeletonId, skeletonVersion))
        user <- userService.findOneById(annotation._user, useCache = true)
        taskOpt <- Fox.runOptional(annotation._task)(taskDAO.findOne)
      } yield {
        val dataEnumerator = data.map(d => Enumerator.fromStream(d.runWith(StreamConverters.asInputStream())))
        val nmlStream = NamedEnumeratorStream(name + ".nml",
                                              nmlWriter.toNmlStream(skeletonTracingOpt,
                                                                    Some(volumeTracing),
                                                                    Some(annotation),
                                                                    dataSet.scale,
                                                                    None,
                                                                    organizationName,
                                                                    Some(user),
                                                                    taskOpt))
        val dataStream: Option[NamedEnumeratorStream] = dataEnumerator.map(d => NamedEnumeratorStream("data.zip", d))
        (Enumerator.outputStream { outputStream =>
          ZipIO.zip(
            dataStream.map(d => List(nmlStream, d)).getOrElse(List(nmlStream)),
            outputStream
          )
        }, name + ".zip")
      }

    def tracingToDownloadStream(dataSet: DataSet, annotation: Annotation, name: String, organizationName: String) =
      if (annotation.tracingType == TracingType.skeleton)
        skeletonToDownloadStream(dataSet, annotation, name, organizationName)
      else
        volumeOrHybridToDownloadStream(dataSet, annotation, name, organizationName)

    for {
      annotation <- provider.provideAnnotation(typ, annotationId, issuingUser) ~> NOT_FOUND
      restrictions <- provider.restrictionsFor(typ, annotationId)
      name <- provider.nameFor(annotation) ?~> "annotation.name.impossible"
      _ <- restrictions.allowDownload(issuingUser) ?~> "annotation.download.notAllowed" ~> FORBIDDEN
      dataSet <- dataSetDAO.findOne(annotation._dataSet)(GlobalAccessContext) ?~> "dataSet.notFoundForAnnotation" ~> NOT_FOUND
      organization <- organizationDAO.findOne(dataSet._organization)(GlobalAccessContext) ?~> "organization.notFound" ~> NOT_FOUND
      (downloadStream, fileName) <- tracingToDownloadStream(dataSet, annotation, name, organization.name)
    } yield {
      Ok.chunked(Source.fromPublisher(IterateeStreams.enumeratorToPublisher(downloadStream)))
        .as(if (fileName.toLowerCase.endsWith(".zip")) "application/zip" else "application/xml")
        .withHeaders(CONTENT_DISPOSITION ->
          s"attachment;filename=${'"'}${fileName}${'"'}")
    }
  }

  private def downloadProject(projectId: String, user: User, skipVolumeData: Boolean)(implicit ctx: DBAccessContext,
                                                                                      m: MessagesProvider) =
    for {
      projectIdValidated <- ObjectId.parse(projectId)
      project <- projectDAO.findOne(projectIdValidated) ?~> Messages("project.notFound", projectId) ~> NOT_FOUND
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(user, project._team)) ?~> "notAllowed" ~> FORBIDDEN
      annotations <- annotationDAO.findAllFinishedForProject(projectIdValidated)
      zip <- annotationService.zipAnnotations(annotations, project.name, skipVolumeData)
    } yield {
      val file = new File(zip.path.toString)
      Ok.sendFile(file, inline = false, fileName = _ => TextUtils.normalize(project.name + "_nmls.zip"))
    }

  private def downloadTask(taskId: String, user: User, skipVolumeData: Boolean)(implicit ctx: DBAccessContext,
                                                                                m: MessagesProvider) = {
    def createTaskZip(task: Task): Fox[TemporaryFile] = annotationService.annotationsFor(task._id).flatMap {
      annotations =>
        val finished = annotations.filter(_.state == Finished)
        annotationService.zipAnnotations(finished, task._id.toString, skipVolumeData)
    }

    for {
      task <- taskDAO.findOne(ObjectId(taskId)).toFox ?~> Messages("task.notFound") ~> NOT_FOUND
      project <- projectDAO.findOne(task._project) ?~> Messages("project.notFound") ~> NOT_FOUND
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(user, project._team)) ?~> Messages("notAllowed") ~> FORBIDDEN
      zip <- createTaskZip(task)
    } yield {
      val file = new File(zip.path.toString)
      Ok.sendFile(file, inline = false, fileName = _ => TextUtils.normalize(task._id.toString + "_nmls.zip"))
    }
  }

  private def downloadTaskType(taskTypeId: String, user: User, skipVolumeData: Boolean)(implicit ctx: DBAccessContext,
                                                                                        m: MessagesProvider) = {
    def createTaskTypeZip(taskType: TaskType) =
      for {
        tasks <- taskDAO.findAllByTaskType(taskType._id)
        annotations <- Fox
          .serialCombined(tasks)(task => annotationService.annotationsFor(task._id))
          .map(_.flatten)
          .toFox
        finishedAnnotations = annotations.filter(_.state == Finished)
        zip <- annotationService.zipAnnotations(finishedAnnotations, taskType.summary, skipVolumeData)
      } yield zip

    for {
      taskTypeIdValidated <- ObjectId.parse(taskTypeId) ?~> "taskType.id.invalid"
      taskType <- taskTypeDAO.findOne(taskTypeIdValidated) ?~> "taskType.notFound" ~> NOT_FOUND
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(user, taskType._team)) ?~> "notAllowed" ~> FORBIDDEN
      zip <- createTaskTypeZip(taskType)
    } yield {
      val file = new File(zip.path.toString)
      Ok.sendFile(file, inline = false, fileName = _ => TextUtils.normalize(taskType.summary + "_nmls.zip"))
    }
  }
}
