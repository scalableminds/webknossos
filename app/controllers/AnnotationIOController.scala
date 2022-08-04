package controllers

import java.io.{BufferedOutputStream, File, FileOutputStream}
import java.util.zip.Deflater

import akka.actor.ActorSystem
import akka.stream.Materializer
import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.io.{NamedEnumeratorStream, ZipIO}
import com.scalableminds.util.tools.{Fox, FoxImplicits, TextUtils}
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, SkeletonTracingOpt, SkeletonTracings}
import com.scalableminds.webknossos.datastore.VolumeTracing.{VolumeTracing, VolumeTracingOpt, VolumeTracings}
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.datasource.{
  AbstractSegmentationLayer,
  DataLayerLike,
  GenericDataSource,
  SegmentationLayer
}
import com.scalableminds.webknossos.tracingstore.tracings.TracingType
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeTracingDefaults
import com.typesafe.scalalogging.LazyLogging
import io.swagger.annotations._
import javax.inject.Inject
import models.analytics.{AnalyticsService, DownloadAnnotationEvent, UploadAnnotationEvent}
import models.annotation.AnnotationState._
import models.annotation._
import models.annotation.nml.NmlResults.{NmlParseResult, NmlParseSuccess}
import models.annotation.nml.{NmlResults, NmlWriter}
import models.binary.{DataSet, DataSetDAO, DataSetService}
import models.organization.OrganizationDAO
import models.project.ProjectDAO
import models.task._
import models.user._
import oxalis.security.WkEnv
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.Files.{TemporaryFile, TemporaryFileCreator}
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, MultipartFormData}
import utils.ObjectId

import scala.concurrent.{ExecutionContext, Future}

@Api
class AnnotationIOController @Inject()(
    nmlWriter: NmlWriter,
    annotationDAO: AnnotationDAO,
    projectDAO: ProjectDAO,
    dataSetDAO: DataSetDAO,
    organizationDAO: OrganizationDAO,
    dataSetService: DataSetService,
    userService: UserService,
    taskDAO: TaskDAO,
    taskTypeDAO: TaskTypeDAO,
    tracingStoreService: TracingStoreService,
    temporaryFileCreator: TemporaryFileCreator,
    annotationService: AnnotationService,
    analyticsService: AnalyticsService,
    sil: Silhouette[WkEnv],
    provider: AnnotationInformationProvider,
    annotationUploadService: AnnotationUploadService)(implicit ec: ExecutionContext, val materializer: Materializer)
    extends Controller
    with FoxImplicits
    with ProtoGeometryImplicits
    with LazyLogging {
  implicit val actorSystem: ActorSystem = ActorSystem()

  @ApiOperation(
    value =
      """Upload NML(s) or ZIP(s) of NML(s) to create a new explorative annotation.
Expects:
 - As file attachment:
    - Any number of NML files or ZIP files containing NMLs, optionally with volume data ZIPs referenced from an NML in a ZIP
    - If multiple annotations are uploaded, they are merged into one.
       - This is not supported if any of the annotations has multiple volume layers.
 - As form parameter: createGroupForEachFile [String] should be one of "true" or "false"
   - If "true": in merged annotation, create tree group wrapping the trees of each file
   - If "false": in merged annotation, rename trees with the respective file name as prefix""",
    nickname = "annotationUpload"
  )
  @ApiResponses(
    Array(
      new ApiResponse(
        code = 200,
        message =
          "JSON object containing annotation information about the newly created annotation, including the assigned id"),
      new ApiResponse(code = 400, message = badRequestLabel)
    ))
  def upload: Action[MultipartFormData[TemporaryFile]] = sil.SecuredAction.async(parse.multipartFormData) {
    implicit request =>
      log() {
        val shouldCreateGroupForEachFile: Boolean =
          request.body.dataParts("createGroupForEachFile").headOption.contains("true")
        val overwritingDataSetName: Option[String] =
          request.body.dataParts.get("datasetName").flatMap(_.headOption)
        val attachedFiles = request.body.files.map(f => (f.ref.path.toFile, f.filename))
        val parsedFiles =
          annotationUploadService.extractFromFiles(attachedFiles, useZipName = true, overwritingDataSetName)
        val parsedFilesWraped =
          annotationUploadService.wrapOrPrefixTrees(parsedFiles.parseResults, shouldCreateGroupForEachFile)
        val parseResultsFiltered: List[NmlParseResult] = parsedFilesWraped.filter(_.succeeded)

        if (parseResultsFiltered.isEmpty) {
          returnError(parsedFiles)
        } else {
          for {
            parseSuccesses <- Fox.serialCombined(parseResultsFiltered)(r => r.toSuccessBox)
            name = nameForUploaded(parseResultsFiltered.map(_.fileName))
            description = descriptionForNMLs(parseResultsFiltered.map(_.description))
            _ <- assertNonEmpty(parseSuccesses)
            skeletonTracings = parseSuccesses.flatMap(_.skeletonTracing)
            // Create a list of volume layers for each uploaded (non-skeleton-only) annotation.
            // This is what determines the merging strategy for volume layers
            volumeLayersGroupedRaw = parseSuccesses.map(_.volumeLayers).filter(_.nonEmpty)
            dataSet <- findDataSetForUploadedAnnotations(skeletonTracings,
                                                         volumeLayersGroupedRaw.flatten.map(_.tracing))
            volumeLayersGrouped <- adaptVolumeTracingsToFallbackLayer(volumeLayersGroupedRaw, dataSet)
            tracingStoreClient <- tracingStoreService.clientFor(dataSet)
            mergedVolumeLayers <- mergeAndSaveVolumeLayers(volumeLayersGrouped,
                                                           tracingStoreClient,
                                                           parsedFiles.otherFiles)
            mergedSkeletonLayers <- mergeAndSaveSkeletonLayers(skeletonTracings, tracingStoreClient)
            annotation <- annotationService.createFrom(request.identity,
                                                       dataSet,
                                                       mergedSkeletonLayers ::: mergedVolumeLayers,
                                                       AnnotationType.Explorational,
                                                       name,
                                                       description)
            _ = analyticsService.track(UploadAnnotationEvent(request.identity, annotation))
          } yield
            JsonOk(
              Json.obj("annotation" -> Json.obj("typ" -> annotation.typ, "id" -> annotation.id)),
              Messages("nml.file.uploadSuccess")
            )
        }
      }
  }

  private def mergeAndSaveVolumeLayers(volumeLayersGrouped: Seq[List[UploadedVolumeLayer]],
                                       client: WKRemoteTracingStoreClient,
                                       otherFiles: Map[String, File]): Fox[List[AnnotationLayer]] =
    if (volumeLayersGrouped.isEmpty)
      Fox.successful(List())
    else if (volumeLayersGrouped.length > 1 && volumeLayersGrouped.exists(_.length > 1))
      Fox.failure("Cannot merge multiple annotations that each have multiple volume layers.")
    else if (volumeLayersGrouped.length == 1) { // Just one annotation was uploaded, keep its layers separate
      Fox.serialCombined(volumeLayersGrouped.toList.flatten.zipWithIndex) { volumeLayerWithIndex =>
        val uploadedVolumeLayer = volumeLayerWithIndex._1
        val idx = volumeLayerWithIndex._2
        for {
          savedTracingId <- client.saveVolumeTracing(uploadedVolumeLayer.tracing,
                                                     uploadedVolumeLayer.getDataZipFrom(otherFiles))
        } yield
          AnnotationLayer(
            savedTracingId,
            AnnotationLayerType.Volume,
            uploadedVolumeLayer.name.getOrElse(AnnotationLayer.defaultVolumeLayerName + idx.toString)
          )
      }
    } else { // Multiple annotations with volume layers (but at most one each) was uploaded merge those volume layers into one
      val uploadedVolumeLayersFlat = volumeLayersGrouped.toList.flatten
      for {
        mergedTracingId <- client.mergeVolumeTracingsByContents(
          VolumeTracings(uploadedVolumeLayersFlat.map(v => VolumeTracingOpt(Some(v.tracing)))),
          uploadedVolumeLayersFlat.map(v => v.getDataZipFrom(otherFiles)),
          persistTracing = true
        )
      } yield
        List(
          AnnotationLayer(
            mergedTracingId,
            AnnotationLayerType.Volume,
            AnnotationLayer.defaultVolumeLayerName
          ))
    }

  private def mergeAndSaveSkeletonLayers(skeletonTracings: List[SkeletonTracing],
                                         tracingStoreClient: WKRemoteTracingStoreClient): Fox[List[AnnotationLayer]] =
    if (skeletonTracings.isEmpty)
      Fox.successful(List())
    else {
      for {
        mergedTracingId <- tracingStoreClient.mergeSkeletonTracingsByContents(
          SkeletonTracings(skeletonTracings.map(t => SkeletonTracingOpt(Some(t)))),
          persistTracing = true)
      } yield
        List(AnnotationLayer(mergedTracingId, AnnotationLayerType.Skeleton, AnnotationLayer.defaultSkeletonLayerName))
    }

  private def assertNonEmpty(parseSuccesses: List[NmlParseSuccess]) =
    bool2Fox(parseSuccesses.exists(p => p.skeletonTracing.nonEmpty || p.volumeLayers.nonEmpty)) ?~> "nml.file.noFile"

  private def findDataSetForUploadedAnnotations(
      skeletonTracings: List[SkeletonTracing],
      volumeTracings: List[VolumeTracing])(implicit mp: MessagesProvider, ctx: DBAccessContext): Fox[DataSet] =
    for {
      dataSetName <- assertAllOnSameDataSet(skeletonTracings, volumeTracings) ?~> "nml.file.differentDatasets"
      organizationNameOpt <- assertAllOnSameOrganization(skeletonTracings, volumeTracings) ?~> "nml.file.differentDatasets"
      organizationIdOpt <- Fox.runOptional(organizationNameOpt) {
        organizationDAO.findOneByName(_)(GlobalAccessContext).map(_._id)
      } ?~> Messages("organization.notFound", organizationNameOpt.getOrElse("")) ~> NOT_FOUND
      organizationId <- Fox.fillOption(organizationIdOpt) {
        dataSetDAO.getOrganizationForDataSet(dataSetName)(GlobalAccessContext)
      } ?~> Messages("dataSet.noAccess", dataSetName) ~> FORBIDDEN
      dataSet <- dataSetDAO.findOneByNameAndOrganization(dataSetName, organizationId) ?~> Messages(
        "dataSet.noAccess",
        dataSetName) ~> FORBIDDEN
    } yield dataSet

  private def nameForUploaded(fileNames: Seq[String]) =
    if (fileNames.size == 1)
      fileNames.headOption.map(_.replaceAll("\\.nml$", "").replaceAll("\\.zip", ""))
    else
      None

  private def descriptionForNMLs(descriptions: Seq[Option[String]]) =
    if (descriptions.size == 1) descriptions.headOption.flatten.getOrElse("") else ""

  private def returnError(zipParseResult: NmlResults.MultiNmlParseResult)(implicit messagesProvider: MessagesProvider) =
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

  private def assertAllOnSameDataSet(skeletons: List[SkeletonTracing], volumes: List[VolumeTracing]): Fox[String] =
    for {
      dataSetName <- volumes.headOption.map(_.dataSetName).orElse(skeletons.headOption.map(_.dataSetName)).toFox
      _ <- bool2Fox(skeletons.forall(_.dataSetName == dataSetName))
      _ <- bool2Fox(volumes.forall(_.dataSetName == dataSetName))
    } yield dataSetName

  private def assertAllOnSameOrganization(skeletons: List[SkeletonTracing],
                                          volumes: List[VolumeTracing]): Fox[Option[String]] = {
    // Note that organizationNames are optional. Tracings with no organization attribute are ignored here
    val organizationNames = skeletons.flatMap(_.organizationName) ::: volumes.flatMap(_.organizationName)
    for {
      _ <- Fox.runOptional(organizationNames.headOption)(name => bool2Fox(organizationNames.forall(_ == name)))
    } yield organizationNames.headOption
  }

  private def adaptVolumeTracingsToFallbackLayer(volumeLayersGrouped: List[List[UploadedVolumeLayer]],
                                                 dataSet: DataSet): Fox[List[List[UploadedVolumeLayer]]] =
    for {
      dataSource <- dataSetService.dataSourceFor(dataSet).flatMap(_.toUsable)
      allAdapted <- Fox.serialCombined(volumeLayersGrouped) { volumeLayers =>
        Fox.serialCombined(volumeLayers) { volumeLayer =>
          for {
            tracingAdapted <- adaptPropertiesToFallbackLayer(volumeLayer.tracing, dataSource)
          } yield volumeLayer.copy(tracing = tracingAdapted)
        }
      }
    } yield allAdapted

  private def adaptPropertiesToFallbackLayer[T <: DataLayerLike](volumeTracing: VolumeTracing,
                                                                 dataSource: GenericDataSource[T]): Fox[VolumeTracing] =
    for {
      _ <- Fox.successful(())
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

  @ApiOperation(value = "Download an annotation as NML/ZIP", nickname = "annotationDownloadByType")
  @ApiResponses(
    Array(
      new ApiResponse(
        code = 200,
        message =
          "NML or Zip file containing skeleton and/or volume data of this annotation. In case of Compound annotations, multiple such annotations wrapped in another zip"
      ),
      new ApiResponse(code = 400, message = badRequestLabel)
    ))
  def download(
      @ApiParam(value =
                  "Type of the annotation, one of Task, Explorational, CompoundTask, CompoundProject, CompoundTaskType",
                example = "Explorational") typ: String,
      @ApiParam(
        value =
          "For Task and Explorational annotations, id is an annotation id. For CompoundTask, id is a task id. For CompoundProject, id is a project id. For CompoundTaskType, id is a task type id")
      id: String,
      skeletonVersion: Option[Long],
      volumeVersion: Option[Long],
      skipVolumeData: Option[Boolean]): Action[AnyContent] =
    sil.UserAwareAction.async { implicit request =>
      logger.trace(s"Requested download for annotation: $typ/$id")
      for {
        identifier <- AnnotationIdentifier.parse(typ, id)
        _ = request.identity.foreach(user => analyticsService.track(DownloadAnnotationEvent(user, id, typ)))
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

  @ApiOperation(value = "Download an annotation as NML/ZIP", nickname = "annotationDownload")
  @ApiResponses(
    Array(
      new ApiResponse(code = 200,
                      message = "NML or Zip file containing skeleton and/or volume data of this annotation."),
      new ApiResponse(code = 400, message = badRequestLabel)
    ))
  def downloadWithoutType(@ApiParam(value = "Id of the stored annotation")
                          id: String,
                          skeletonVersion: Option[Long],
                          volumeVersion: Option[Long],
                          skipVolumeData: Option[Boolean]): Action[AnyContent] =
    sil.UserAwareAction.async { implicit request =>
      for {
        annotation <- provider.provideAnnotation(id, request.identity)
        result <- download(annotation.typ.toString, id, skeletonVersion, volumeVersion, skipVolumeData)(request)
      } yield result
    }

  // TODO: select versions per layer
  private def downloadExplorational(annotationId: String,
                                    typ: String,
                                    issuingUser: Option[User],
                                    skeletonVersion: Option[Long],
                                    volumeVersion: Option[Long],
                                    skipVolumeData: Boolean)(implicit ctx: DBAccessContext) = {

    def skeletonToTemporaryFile(dataSet: DataSet,
                                annotation: Annotation,
                                organizationName: String): Fox[TemporaryFile] =
      for {
        tracingStoreClient <- tracingStoreService.clientFor(dataSet)
        fetchedAnnotationLayers <- Fox.serialCombined(annotation.skeletonAnnotationLayers)(
          tracingStoreClient.getSkeletonTracing(_, skeletonVersion))
        user <- userService.findOneById(annotation._user, useCache = true)
        taskOpt <- Fox.runOptional(annotation._task)(taskDAO.findOne)
        nmlStream = nmlWriter.toNmlStream(fetchedAnnotationLayers,
                                          Some(annotation),
                                          dataSet.scale,
                                          None,
                                          organizationName,
                                          Some(user),
                                          taskOpt)
        nmlTemporaryFile = temporaryFileCreator.create()
        temporaryFileStream = new BufferedOutputStream(new FileOutputStream(nmlTemporaryFile))
        _ <- NamedEnumeratorStream("", nmlStream).writeTo(temporaryFileStream)
        _ = temporaryFileStream.close()
      } yield nmlTemporaryFile

    def volumeOrHybridToTemporaryFile(dataset: DataSet,
                                      annotation: Annotation,
                                      name: String,
                                      organizationName: String): Fox[TemporaryFile] =
      for {
        tracingStoreClient <- tracingStoreService.clientFor(dataset)
        fetchedVolumeLayers: List[FetchedAnnotationLayer] <- Fox.serialCombined(annotation.volumeAnnotationLayers) {
          volumeAnnotationLayer =>
            tracingStoreClient.getVolumeTracing(volumeAnnotationLayer, volumeVersion, skipVolumeData)
        }
        fetchedSkeletonLayers: List[FetchedAnnotationLayer] <- Fox.serialCombined(annotation.skeletonAnnotationLayers) {
          skeletonAnnotationLayer =>
            tracingStoreClient.getSkeletonTracing(skeletonAnnotationLayer, skeletonVersion)
        }
        user <- userService.findOneById(annotation._user, useCache = true)
        taskOpt <- Fox.runOptional(annotation._task)(taskDAO.findOne)
        nmlStream = nmlWriter.toNmlStream(fetchedSkeletonLayers ::: fetchedVolumeLayers,
                                          Some(annotation),
                                          dataset.scale,
                                          None,
                                          organizationName,
                                          Some(user),
                                          taskOpt,
                                          skipVolumeData)
        temporaryFile = temporaryFileCreator.create()
        zipper = ZipIO.startZip(new BufferedOutputStream(new FileOutputStream(new File(temporaryFile.path.toString))))
        _ <- zipper.addFileFromEnumerator(name + ".nml", nmlStream)
        _ = fetchedVolumeLayers.zipWithIndex.map {
          case (volumeLayer, index) =>
            volumeLayer.volumeDataOpt.foreach { volumeData =>
              val dataZipName = volumeLayer.volumeDataZipName(index, fetchedVolumeLayers.length == 1)
              zipper.stream.setLevel(Deflater.BEST_SPEED)
              zipper.addFileFromBytes(dataZipName, volumeData)
            }
        }
        _ = zipper.close()
      } yield temporaryFile

    def annotationToTemporaryFile(dataSet: DataSet,
                                  annotation: Annotation,
                                  name: String,
                                  organizationName: String): Fox[TemporaryFile] =
      if (annotation.tracingType == TracingType.skeleton)
        skeletonToTemporaryFile(dataSet, annotation, organizationName)
      else
        volumeOrHybridToTemporaryFile(dataSet, annotation, name, organizationName)

    def exportExtensionForAnnotation(annotation: Annotation): String =
      if (annotation.tracingType == TracingType.skeleton)
        ".nml"
      else
        ".zip"

    def exportMimeTypeForAnnotation(annotation: Annotation): String =
      if (annotation.tracingType == TracingType.skeleton)
        xmlMimeType
      else
        zipMimeType

    for {
      annotation <- provider.provideAnnotation(typ, annotationId, issuingUser) ~> NOT_FOUND
      restrictions <- provider.restrictionsFor(typ, annotationId)
      name <- provider.nameFor(annotation) ?~> "annotation.name.impossible"
      fileExtension = exportExtensionForAnnotation(annotation)
      fileName = name + fileExtension
      mimeType = exportMimeTypeForAnnotation(annotation)
      _ <- restrictions.allowDownload(issuingUser) ?~> "annotation.download.notAllowed" ~> FORBIDDEN
      dataSet <- dataSetDAO.findOne(annotation._dataSet)(GlobalAccessContext) ?~> "dataSet.notFoundForAnnotation" ~> NOT_FOUND
      organization <- organizationDAO.findOne(dataSet._organization)(GlobalAccessContext) ?~> "organization.notFound" ~> NOT_FOUND
      temporaryFile <- annotationToTemporaryFile(dataSet, annotation, name, organization.name)
    } yield {
      Ok.sendFile(temporaryFile, inline = false)
        .as(mimeType)
        .withHeaders(CONTENT_DISPOSITION ->
          s"attachment;filename=${'"'}$fileName${'"'}")
    }
  }

  private def downloadProject(projectId: String, userOpt: Option[User], skipVolumeData: Boolean)(
      implicit ctx: DBAccessContext,
      m: MessagesProvider) =
    for {
      user <- userOpt.toFox ?~> Messages("notAllowed") ~> FORBIDDEN
      projectIdValidated <- ObjectId.fromString(projectId)
      project <- projectDAO.findOne(projectIdValidated) ?~> Messages("project.notFound", projectId) ~> NOT_FOUND
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(user, project._team)) ?~> "notAllowed" ~> FORBIDDEN
      annotations <- annotationDAO.findAllFinishedForProject(projectIdValidated)
      zip <- annotationService.zipAnnotations(annotations, project.name, skipVolumeData)
    } yield {
      val file = new File(zip.path.toString)
      Ok.sendFile(file, inline = false, fileName = _ => Some(TextUtils.normalize(project.name + "_nmls.zip")))
    }

  private def downloadTask(taskId: String, userOpt: Option[User], skipVolumeData: Boolean)(
      implicit ctx: DBAccessContext,
      m: MessagesProvider) = {
    def createTaskZip(task: Task): Fox[TemporaryFile] = annotationService.annotationsFor(task._id).flatMap {
      annotations =>
        val finished = annotations.filter(_.state == Finished)
        annotationService.zipAnnotations(finished, task._id.toString, skipVolumeData)
    }

    for {
      user <- userOpt.toFox ?~> Messages("notAllowed") ~> FORBIDDEN
      task <- taskDAO.findOne(ObjectId(taskId)).toFox ?~> Messages("task.notFound") ~> NOT_FOUND
      project <- projectDAO.findOne(task._project) ?~> Messages("project.notFound") ~> NOT_FOUND
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(user, project._team)) ?~> Messages("notAllowed") ~> FORBIDDEN
      zip <- createTaskZip(task)
    } yield {
      val file = new File(zip.path.toString)
      Ok.sendFile(file, inline = false, fileName = _ => Some(TextUtils.normalize(task._id.toString + "_nmls.zip")))
    }
  }

  private def downloadTaskType(taskTypeId: String, userOpt: Option[User], skipVolumeData: Boolean)(
      implicit ctx: DBAccessContext,
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
      user <- userOpt.toFox ?~> Messages("notAllowed") ~> FORBIDDEN
      taskTypeIdValidated <- ObjectId.fromString(taskTypeId) ?~> "taskType.id.invalid"
      taskType <- taskTypeDAO.findOne(taskTypeIdValidated) ?~> "taskType.notFound" ~> NOT_FOUND
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(user, taskType._team)) ?~> "notAllowed" ~> FORBIDDEN
      zip <- createTaskTypeZip(taskType)
    } yield {
      val file = new File(zip.path.toString)
      Ok.sendFile(file, inline = false, fileName = _ => Some(TextUtils.normalize(taskType.summary + "_nmls.zip")))
    }
  }
}
