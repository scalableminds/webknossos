package controllers

import collections.SequenceUtils

import java.io.{BufferedOutputStream, File, FileOutputStream}
import java.util.zip.Deflater
import org.apache.pekko.actor.ActorSystem
import org.apache.pekko.stream.Materializer
import play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.io.ZipIO
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits, TextUtils}
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, SkeletonTracingOpt, SkeletonTracings}
import com.scalableminds.webknossos.datastore.VolumeTracing.{VolumeTracing, VolumeTracingOpt, VolumeTracings}
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.annotation.{
  AnnotationLayer,
  AnnotationLayerStatistics,
  AnnotationLayerType,
  FetchedAnnotationLayer
}
import com.scalableminds.webknossos.datastore.models.datasource.{
  AbstractSegmentationLayer,
  DataLayerLike,
  DataSourceLike,
  GenericDataSource,
  SegmentationLayer
}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.tracingstore.tracings.TracingType
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeDataZipFormat.VolumeDataZipFormat
import com.scalableminds.webknossos.tracingstore.tracings.volume.{
  VolumeDataZipFormat,
  VolumeTracingDefaults,
  VolumeTracingDownsampling
}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Empty

import javax.inject.Inject
import models.analytics.{AnalyticsService, DownloadAnnotationEvent, UploadAnnotationEvent}
import models.annotation.AnnotationState._
import models.annotation._
import models.annotation.nml.NmlResults.{NmlParseResult, NmlParseSuccess}
import models.annotation.nml.{NmlResults, NmlWriter}
import models.dataset.{DataStoreDAO, Dataset, DatasetDAO, DatasetService, WKRemoteDataStoreClient}
import models.organization.OrganizationDAO
import models.project.ProjectDAO
import models.task._
import models.user._
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.Files.{TemporaryFile, TemporaryFileCreator}
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, MultipartFormData}
import security.WkEnv
import utils.WkConf

import scala.concurrent.ExecutionContext

class AnnotationIOController @Inject()(
    nmlWriter: NmlWriter,
    annotationDAO: AnnotationDAO,
    projectDAO: ProjectDAO,
    datasetDAO: DatasetDAO,
    organizationDAO: OrganizationDAO,
    datasetService: DatasetService,
    userService: UserService,
    taskDAO: TaskDAO,
    taskTypeDAO: TaskTypeDAO,
    tracingStoreService: TracingStoreService,
    temporaryFileCreator: TemporaryFileCreator,
    annotationService: AnnotationService,
    analyticsService: AnalyticsService,
    conf: WkConf,
    rpc: RPC,
    sil: Silhouette[WkEnv],
    dataStoreDAO: DataStoreDAO,
    provider: AnnotationInformationProvider,
    annotationUploadService: AnnotationUploadService)(implicit ec: ExecutionContext, val materializer: Materializer)
    extends Controller
    with FoxImplicits
    with ProtoGeometryImplicits
    with LazyLogging {
  implicit val actorSystem: ActorSystem = ActorSystem()

  private val volumeDataZipFormatForCompoundAnnotations = VolumeDataZipFormat.wkw

  /* Upload NML(s) or ZIP(s) of NML(s) to create a new explorative annotation.
     Expects:
      - As file attachment:
         - Any number of NML files or ZIP files containing NMLs, optionally with volume data ZIPs referenced from an NML in a ZIP
         - If multiple annotations are uploaded, they are merged into one.
            - This is not supported if any of the annotations has multiple volume layers.
      - As form parameter: createGroupForEachFile [String] should be one of "true" or "false"
        - If "true": in merged annotation, create tree group wrapping the trees of each file
        - If "false": in merged annotation, rename trees with the respective file name as prefix
     Returns:
        JSON object containing annotation information about the newly created annotation, including the assigned id
   */
  def upload: Action[MultipartFormData[TemporaryFile]] = sil.SecuredAction.async(parse.multipartFormData) {
    implicit request =>
      log() {
        val shouldCreateGroupForEachFile: Boolean =
          request.body.dataParts("createGroupForEachFile").headOption.contains("true")
        val overwritingDatasetId: Option[String] =
          request.body.dataParts.get("datasetId").flatMap(_.headOption)
        val userOrganizationId = request.identity._organization
        val attachedFiles = request.body.files.map(f => (f.ref.path.toFile, f.filename))
        for {
          parsedFiles <- annotationUploadService.extractFromFiles(
            attachedFiles,
            SharedParsingParameters(useZipName = true, overwritingDatasetId, userOrganizationId))
          parsedFilesWrapped = annotationUploadService.wrapOrPrefixGroups(parsedFiles.parseResults,
                                                                          shouldCreateGroupForEachFile)
          parseResultsFiltered: List[NmlParseResult] = parsedFilesWrapped.filter(_.succeeded)
          _ <- bool2Fox(parseResultsFiltered.nonEmpty) orElse returnError(parsedFiles)
          parseSuccesses <- Fox.serialCombined(parseResultsFiltered)(r => r.toSuccessBox)
          name = nameForUploaded(parseResultsFiltered.map(_.fileName))
          description = descriptionForNMLs(parseResultsFiltered.map(_.description))
          wkUrl = wkUrlsForNMLs(parseResultsFiltered.map(_.wkUrl))
          _ <- assertNonEmpty(parseSuccesses)
          skeletonTracings = parseSuccesses.flatMap(_.skeletonTracingOpt)
          // Create a list of volume layers for each uploaded (non-skeleton-only) annotation.
          // This is what determines the merging strategy for volume layers
          volumeLayersGroupedRaw = parseSuccesses.map(_.volumeLayers).filter(_.nonEmpty)
          datasetIds = parseSuccesses.map(_.datasetId)
          dataset <- findDatasetForUploadedAnnotations(skeletonTracings,
                                                       volumeLayersGroupedRaw.flatten,
                                                       datasetIds,
                                                       wkUrl)
          dataSource <- datasetService.dataSourceFor(dataset) ?~> Messages("dataset.notImported", dataset.name)
          usableDataSource <- dataSource.toUsable.toFox ?~> Messages("dataset.notImported", dataset.name)
          volumeLayersGrouped <- adaptVolumeTracingsToFallbackLayer(volumeLayersGroupedRaw, dataset, usableDataSource)
          tracingStoreClient <- tracingStoreService.clientFor(dataset)
          mergedVolumeLayers <- mergeAndSaveVolumeLayers(volumeLayersGrouped,
                                                         tracingStoreClient,
                                                         parsedFiles.otherFiles,
                                                         usableDataSource)
          mergedSkeletonLayers <- mergeAndSaveSkeletonLayers(skeletonTracings, tracingStoreClient)
          annotation <- annotationService.createFrom(request.identity,
                                                     dataset,
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

  private def mergeAndSaveVolumeLayers(volumeLayersGrouped: Seq[List[UploadedVolumeLayer]],
                                       client: WKRemoteTracingStoreClient,
                                       otherFiles: Map[String, File],
                                       dataSource: DataSourceLike): Fox[List[AnnotationLayer]] =
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
                                                     uploadedVolumeLayer.getDataZipFrom(otherFiles),
                                                     dataSource = Some(dataSource))
        } yield
          AnnotationLayer(
            savedTracingId,
            AnnotationLayerType.Volume,
            uploadedVolumeLayer.name.getOrElse(AnnotationLayer.defaultVolumeLayerName + idx.toString),
            AnnotationLayerStatistics.unknown
          )
      }
    } else { // Multiple annotations with volume layers (but at most one each) was uploaded merge those volume layers into one
      val uploadedVolumeLayersFlat = volumeLayersGrouped.toList.flatten
      for {
        mergedTracingId <- client.mergeVolumeTracingsByContents(
          VolumeTracings(uploadedVolumeLayersFlat.map(v => VolumeTracingOpt(Some(v.tracing)))),
          dataSource,
          uploadedVolumeLayersFlat.map(v => v.getDataZipFrom(otherFiles)),
          persistTracing = true
        )
      } yield
        List(
          AnnotationLayer(
            mergedTracingId,
            AnnotationLayerType.Volume,
            AnnotationLayer.defaultVolumeLayerName,
            AnnotationLayerStatistics.unknown
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
        List(
          AnnotationLayer(mergedTracingId,
                          AnnotationLayerType.Skeleton,
                          AnnotationLayer.defaultSkeletonLayerName,
                          AnnotationLayerStatistics.unknown))
    }

  private def assertNonEmpty(parseSuccesses: List[NmlParseSuccess]) =
    bool2Fox(parseSuccesses.exists(p => p.skeletonTracingOpt.nonEmpty || p.volumeLayers.nonEmpty)) ?~> "nml.file.noFile"

  private def findDatasetForUploadedAnnotations(
      skeletonTracings: List[SkeletonTracing],
      volumeTracings: List[UploadedVolumeLayer],
      datasetIds: List[ObjectId],
      wkUrl: String)(implicit mp: MessagesProvider, ctx: DBAccessContext): Fox[Dataset] =
    for {
      datasetId <- SequenceUtils.findUniqueElement(datasetIds).toFox ?~> "nml.file.differentDatasets"
      organizationIdOpt <- assertAllOnSameOrganization(skeletonTracings, volumeTracings) ?~> "nml.file.differentDatasets"
      organizationIdOpt <- Fox.runOptional(organizationIdOpt) {
        organizationDAO.findOne(_)(GlobalAccessContext).map(_._id)
      } ?~> (if (wkUrl.nonEmpty && conf.Http.uri != wkUrl) {
               Messages("organization.notFound.wrongHost", organizationIdOpt.getOrElse(""), wkUrl, conf.Http.uri)
             } else { Messages("organization.notFound", organizationIdOpt.getOrElse("")) }) ~>
        NOT_FOUND
      organizationId <- Fox.fillOption(organizationIdOpt) {
        organizationDAO.findOrganizationIdForDataset(datasetId)(GlobalAccessContext)
      } ?~> Messages("dataset.noAccess", datasetId) ~> FORBIDDEN
      dataset <- datasetDAO.findOne(datasetId) ?~> (if (wkUrl.nonEmpty && conf.Http.uri != wkUrl) {
                                                      Messages("dataset.noAccess.wrongHost",
                                                               datasetId,
                                                               wkUrl,
                                                               conf.Http.uri)
                                                    } else {
                                                      Messages("dataset.noAccess", datasetId)
                                                    }) ~> FORBIDDEN
      _ <- bool2Fox(organizationId == dataset._organization) ?~> Messages("dataset.noAccess", datasetId) ~> FORBIDDEN
    } yield dataset

  private def nameForUploaded(fileNames: Seq[String]) =
    if (fileNames.size == 1)
      fileNames.headOption.map(_.replaceAll("\\.nml$", "").replaceAll("\\.zip", ""))
    else
      None

  private def descriptionForNMLs(descriptions: Seq[Option[String]]) =
    if (descriptions.size == 1) descriptions.headOption.flatten.getOrElse("") else ""

  private def wkUrlsForNMLs(wkUrls: Seq[Option[String]]) =
    if (wkUrls.toSet.size == 1) wkUrls.headOption.flatten.getOrElse("") else ""

  private def returnError(zipParseResult: NmlResults.MultiNmlParseResult)(
      implicit messagesProvider: MessagesProvider): Fox[Nothing] =
    if (zipParseResult.containsFailure) {
      val errors = zipParseResult.parseResults.flatMap {
        case result: NmlResults.NmlParseFailure =>
          Some("error" -> Messages("nml.file.invalid", result.fileName, result.error))
        case _ => None
      }
      Fox.paramFailure("NML upload failed", Empty, Empty, Json.toJson(errors.map(m => Json.obj(m._1 -> m._2))))
    } else {
      // This does not work. It is not caught and processed properly
      Fox.paramFailure("NML upload failed", Empty, Empty, None)
    }

  private def assertAllOnSameOrganization(skeletons: List[SkeletonTracing],
                                          volumes: List[UploadedVolumeLayer]): Fox[Option[String]] = {
    // Note that organizationIds are optional. Tracings with no organization attribute are ignored here
    val organizationIds = skeletons.flatMap(_.organizationId) ::: volumes.flatMap(_.tracing.organizationId)
    for {
      _ <- Fox.runOptional(organizationIds.headOption)(name => bool2Fox(organizationIds.forall(_ == name)))
    } yield organizationIds.headOption
  }

  private def adaptVolumeTracingsToFallbackLayer(volumeLayersGrouped: List[List[UploadedVolumeLayer]],
                                                 dataset: Dataset,
                                                 dataSource: DataSourceLike): Fox[List[List[UploadedVolumeLayer]]] =
    for {
      dataStore <- dataStoreDAO.findOneByName(dataset._dataStore.trim)(GlobalAccessContext) ?~> "dataStore.notFoundForDataset"
      organization <- organizationDAO.findOne(dataset._organization)(GlobalAccessContext)
      remoteDataStoreClient = new WKRemoteDataStoreClient(dataStore, rpc)
      allAdapted <- Fox.serialCombined(volumeLayersGrouped) { volumeLayers =>
        Fox.serialCombined(volumeLayers) { volumeLayer =>
          for {
            adaptedTracing <- adaptPropertiesToFallbackLayer(volumeLayer.tracing,
                                                             dataSource,
                                                             dataset,
                                                             organization._id,
                                                             remoteDataStoreClient)
            adaptedAnnotationLayer = volumeLayer.copy(tracing = adaptedTracing)
          } yield adaptedAnnotationLayer
        }
      }
    } yield allAdapted

  private def adaptPropertiesToFallbackLayer[T <: DataLayerLike](
      volumeTracing: VolumeTracing,
      dataSource: GenericDataSource[T],
      dataset: Dataset,
      organizationId: String,
      remoteDataStoreClient: WKRemoteDataStoreClient): Fox[VolumeTracing] = {
    val fallbackLayerOpt = dataSource.dataLayers.flatMap {
      case layer: SegmentationLayer if volumeTracing.fallbackLayer contains layer.name         => Some(layer)
      case layer: AbstractSegmentationLayer if volumeTracing.fallbackLayer contains layer.name => Some(layer)
      case _                                                                                   => None
    }.headOption
    val bbox =
      if (volumeTracing.boundingBox.isEmpty) boundingBoxToProto(dataSource.boundingBox)
      else volumeTracing.boundingBox
    val elementClass = fallbackLayerOpt
      .map(layer => elementClassToProto(layer.elementClass))
      .getOrElse(elementClassToProto(VolumeTracingDefaults.elementClass))
    for {
      tracingCanHaveSegmentIndex <- canHaveSegmentIndex(organizationId,
                                                        dataset.name,
                                                        fallbackLayerOpt.map(_.name),
                                                        remoteDataStoreClient)
    } yield
      volumeTracing.copy(
        boundingBox = bbox,
        elementClass = elementClass,
        fallbackLayer = fallbackLayerOpt.map(_.name),
        largestSegmentId =
          annotationService.combineLargestSegmentIdsByPrecedence(volumeTracing.largestSegmentId,
                                                                 fallbackLayerOpt.map(_.largestSegmentId)),
        mags = VolumeTracingDownsampling.magsForVolumeTracing(dataSource, fallbackLayerOpt).map(vec3IntToProto),
        hasSegmentIndex = Some(tracingCanHaveSegmentIndex)
      )
  }

  private def canHaveSegmentIndex(
      organizationId: String,
      datasetName: String,
      fallbackLayerName: Option[String],
      remoteDataStoreClient: WKRemoteDataStoreClient)(implicit ec: ExecutionContext): Fox[Boolean] =
    fallbackLayerName match {
      case Some(layerName) =>
        remoteDataStoreClient.hasSegmentIndexFile(organizationId, datasetName, layerName)
      case None =>
        Fox.successful(true)
    }

  // NML or Zip file containing skeleton and/or volume data of this annotation. In case of Compound annotations, multiple such annotations wrapped in another zip
  def download(typ: String,
               id: String,
               skeletonVersion: Option[Long],
               volumeVersion: Option[Long],
               skipVolumeData: Option[Boolean],
               volumeDataZipFormat: Option[String]): Action[AnyContent] =
    sil.UserAwareAction.async { implicit request =>
      logger.trace(s"Requested download for annotation: $typ/$id")
      for {
        identifier <- AnnotationIdentifier.parse(typ, id)
        volumeDataZipFormatParsed = volumeDataZipFormat.flatMap(VolumeDataZipFormat.fromString)
        _ = request.identity.foreach(user => analyticsService.track(DownloadAnnotationEvent(user, id, typ)))
        result <- identifier.annotationType match {
          case AnnotationType.View            => Fox.failure("Cannot download View annotation")
          case AnnotationType.CompoundProject => downloadProject(id, request.identity, skipVolumeData.getOrElse(false))
          case AnnotationType.CompoundTask    => downloadTask(id, request.identity, skipVolumeData.getOrElse(false))
          case AnnotationType.CompoundTaskType =>
            downloadTaskType(id, request.identity, skipVolumeData.getOrElse(false))
          case _ =>
            downloadExplorational(
              id,
              typ,
              request.identity,
              skeletonVersion,
              volumeVersion,
              skipVolumeData.getOrElse(false),
              volumeDataZipFormatParsed.getOrElse(VolumeDataZipFormat.wkw)) ?~> "annotation.download.failed"
        }
      } yield result
    }

  def downloadWithoutType(id: String,
                          skeletonVersion: Option[Long],
                          volumeVersion: Option[Long],
                          skipVolumeData: Option[Boolean],
                          volumeDataZipFormat: Option[String]): Action[AnyContent] =
    sil.UserAwareAction.async { implicit request =>
      for {
        annotation <- provider.provideAnnotation(id, request.identity)
        result <- download(annotation.typ.toString,
                           id,
                           skeletonVersion,
                           volumeVersion,
                           skipVolumeData,
                           volumeDataZipFormat)(request)
      } yield result
    }

  private def downloadExplorational(annotationId: String,
                                    typ: String,
                                    issuingUser: Option[User],
                                    skeletonVersion: Option[Long],
                                    volumeVersion: Option[Long],
                                    skipVolumeData: Boolean,
                                    volumeDataZipFormat: VolumeDataZipFormat)(implicit ctx: DBAccessContext) = {

    // Note: volumeVersion cannot currently be supplied per layer, see https://github.com/scalableminds/webknossos/issues/5925

    def skeletonToTemporaryFile(dataset: Dataset, annotation: Annotation, organizationId: String): Fox[TemporaryFile] =
      for {
        tracingStoreClient <- tracingStoreService.clientFor(dataset)
        fetchedAnnotationLayers <- Fox.serialCombined(annotation.skeletonAnnotationLayers)(
          tracingStoreClient.getSkeletonTracing(_, skeletonVersion))
        user <- userService.findOneCached(annotation._user)(GlobalAccessContext)
        taskOpt <- Fox.runOptional(annotation._task)(taskDAO.findOne)
        nmlStream = nmlWriter.toNmlStream(
          "temp",
          fetchedAnnotationLayers,
          Some(annotation),
          dataset.voxelSize,
          None,
          organizationId,
          conf.Http.uri,
          dataset.name,
          dataset._id,
          Some(user),
          taskOpt,
          skipVolumeData,
          volumeDataZipFormat
        )
        nmlTemporaryFile = temporaryFileCreator.create()
        temporaryFileStream = new BufferedOutputStream(new FileOutputStream(nmlTemporaryFile))
        _ <- nmlStream.writeTo(temporaryFileStream)
        _ = temporaryFileStream.close()
      } yield nmlTemporaryFile

    def volumeOrHybridToTemporaryFile(dataset: Dataset,
                                      annotation: Annotation,
                                      name: String,
                                      organizationId: String): Fox[TemporaryFile] =
      for {
        tracingStoreClient <- tracingStoreService.clientFor(dataset)
        fetchedVolumeLayers: List[FetchedAnnotationLayer] <- Fox.serialCombined(annotation.volumeAnnotationLayers) {
          volumeAnnotationLayer =>
            tracingStoreClient.getVolumeTracing(volumeAnnotationLayer,
                                                volumeVersion,
                                                skipVolumeData,
                                                volumeDataZipFormat,
                                                dataset.voxelSize)
        } ?~> "annotation.download.fetchVolumeLayer.failed"
        fetchedSkeletonLayers: List[FetchedAnnotationLayer] <- Fox.serialCombined(annotation.skeletonAnnotationLayers) {
          skeletonAnnotationLayer =>
            tracingStoreClient.getSkeletonTracing(skeletonAnnotationLayer, skeletonVersion)
        } ?~> "annotation.download.fetchSkeletonLayer.failed"
        user <- userService.findOneCached(annotation._user)(GlobalAccessContext) ?~> "annotation.download.findUser.failed"
        taskOpt <- Fox.runOptional(annotation._task)(taskDAO.findOne(_)(GlobalAccessContext)) ?~> "task.notFound"
        nmlStream = nmlWriter.toNmlStream(
          name,
          fetchedSkeletonLayers ::: fetchedVolumeLayers,
          Some(annotation),
          dataset.voxelSize,
          None,
          organizationId,
          conf.Http.uri,
          dataset.name,
          dataset._id,
          Some(user),
          taskOpt,
          skipVolumeData,
          volumeDataZipFormat
        )
        temporaryFile = temporaryFileCreator.create()
        zipper = ZipIO.startZip(new BufferedOutputStream(new FileOutputStream(new File(temporaryFile.path.toString))))
        _ <- zipper.addFileFromNamedStream(nmlStream, suffix = ".nml") ?~> "annotation.download.zipNml.failed"
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

    def annotationToTemporaryFile(dataset: Dataset,
                                  annotation: Annotation,
                                  name: String,
                                  organizationId: String): Fox[TemporaryFile] =
      if (annotation.tracingType == TracingType.skeleton)
        skeletonToTemporaryFile(dataset, annotation, organizationId) ?~> "annotation.download.skeletonToFile.failed"
      else
        volumeOrHybridToTemporaryFile(dataset, annotation, name, organizationId) ?~> "annotation.download.hybridToFile.failed"

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
      restrictions <- provider.restrictionsFor(typ, annotationId) ?~> "annotation.restrictions.unavailable"
      name <- provider.nameFor(annotation) ?~> "annotation.name.impossible"
      fileExtension = exportExtensionForAnnotation(annotation)
      fileName = name + fileExtension
      mimeType = exportMimeTypeForAnnotation(annotation)
      _ <- restrictions.allowDownload(issuingUser) ?~> "annotation.download.notAllowed" ~> FORBIDDEN
      dataset <- datasetDAO.findOne(annotation._dataset)(GlobalAccessContext) ?~> "dataset.notFoundForAnnotation" ~> NOT_FOUND
      organization <- organizationDAO.findOne(dataset._organization)(GlobalAccessContext) ?~> "organization.notFound" ~> NOT_FOUND
      temporaryFile <- annotationToTemporaryFile(dataset, annotation, name, organization._id) ?~> "annotation.writeTemporaryFile.failed"
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
      zip <- annotationService.zipAnnotations(annotations,
                                              project.name,
                                              skipVolumeData,
                                              volumeDataZipFormatForCompoundAnnotations)
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
        annotationService
          .zipAnnotations(finished, task._id.toString, skipVolumeData, volumeDataZipFormatForCompoundAnnotations)
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
        zip <- annotationService.zipAnnotations(finishedAnnotations,
                                                taskType.summary,
                                                skipVolumeData,
                                                volumeDataZipFormatForCompoundAnnotations)
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
