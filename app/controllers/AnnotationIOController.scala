package controllers

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.box.Empty
import com.scalableminds.util.box.Box.tryo
import com.scalableminds.util.collections.SequenceUtils
import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.io.ZipIO
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, TextUtils}
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.util.tools.StringNumberConversions.toDoubleOpt
import com.google.protobuf.ByteString
import com.scalableminds.webknossos.datastore.Annotation.AnnotationProto
import com.scalableminds.webknossos.datastore.AnnotationBookmark.UploadedAnnotationBookmarkProto
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, SkeletonTracingOpt, SkeletonTracings}
import com.scalableminds.webknossos.datastore.VolumeTracing.{VolumeTracing, VolumeTracingOpt, VolumeTracings}
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryConversions
import com.scalableminds.webknossos.datastore.models.annotation.{
  AnnotationLayer,
  AnnotationLayerStatistics,
  AnnotationLayerType,
  FetchedAnnotationLayer
}
import com.scalableminds.webknossos.datastore.models.datasource.*
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.tracingstore.annotation.BookmarkThumbnailSize
import com.scalableminds.webknossos.tracingstore.tracings.TracingId
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeDataZipFormat.VolumeDataZipFormat
import com.scalableminds.webknossos.tracingstore.tracings.volume.{
  VolumeDataZipFormat,
  VolumeTracingDefaults,
  VolumeTracingMags
}
import com.typesafe.scalalogging.LazyLogging
import files.WkTempFileService

import javax.inject.Inject
import models.analytics.{AnalyticsService, DownloadAnnotationEvent, UploadAnnotationEvent}
import models.annotation.AnnotationState.*
import models.annotation.*
import models.annotation.nml.NmlResults.{NmlParseResult, NmlParseSuccess}
import models.annotation.nml.{
  NmlAnnotationLayerRef,
  NmlBookmarkToWrite,
  NmlBookmarks,
  NmlParsedBookmark,
  NmlResults,
  NmlSkeletonLayerRef,
  NmlVolumeLayerRef,
  NmlWriter
}
import models.dataset.*
import models.organization.OrganizationDAO
import models.project.ProjectDAO
import models.task.*
import models.user.*
import org.apache.pekko.stream.Materializer
import play.api.libs.Files.TemporaryFile
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, MultipartFormData, Result}
import play.silhouette.api.Silhouette
import security.WkEnv
import utils.WkConf

import java.io.{BufferedOutputStream, File, FileOutputStream}
import java.net.URLEncoder
import java.nio.file.{Files, Path}
import java.util.zip.Deflater
import scala.concurrent.ExecutionContext

class AnnotationIOController @Inject() (
    nmlWriter: NmlWriter,
    annotationDAO: AnnotationDAO,
    projectDAO: ProjectDAO,
    datasetDAO: DatasetDAO,
    datasetLayerDAO: DatasetLayerDAO,
    organizationDAO: OrganizationDAO,
    datasetService: DatasetService,
    userService: UserService,
    taskDAO: TaskDAO,
    multiUserDAO: MultiUserDAO,
    taskTypeDAO: TaskTypeDAO,
    tracingStoreService: TracingStoreService,
    tempFileService: WkTempFileService,
    annotationService: AnnotationService,
    analyticsService: AnalyticsService,
    conf: WkConf,
    rpc: RPC,
    sil: Silhouette[WkEnv],
    dataStoreDAO: DataStoreDAO,
    provider: AnnotationInformationProvider,
    annotationUploadService: AnnotationUploadService
)(implicit ec: ExecutionContext, val materializer: Materializer)
    extends Controller
    with ProtoGeometryConversions
    with AnnotationLayerPrecedence
    with LazyLogging {

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
      - As optional form parameter: description [String]
        - If set, this will be the description of the resulting annotation, overwriting any description specified in NML files.
      - As optional form parameter: fallbackEditPosition [String], e.g. "1,2,3"
        - If set, this will be used as the editPosition for annotations that do not specify their own.
      - As optional form parameter: fallbackEditRotation [String], e.g. "1,2,3"
        - If set, this will be used as the editRotation for annotations that do not specify their own.
      - As optional form parameter: fallbackZoomLevel [String], e.g. "1.5"
        - If set, this will be used as the zoomLevel for annotations that do not specify their own.
     Returns:
        JSON object containing annotation information about the newly created annotation, including the assigned id
   */
  def upload: Action[MultipartFormData[TemporaryFile]] = sil.SecuredAction.fox(parse.multipartFormData) {
    implicit request =>
      log() {
        val shouldCreateGroupForEachFile: Boolean =
          request.body.dataParts("createGroupForEachFile").headOption.contains("true")
        val overwritingDatasetId: Option[String] =
          request.body.dataParts.get("datasetId").flatMap(_.headOption)
        val overwritingDescription: Option[String] = request.body.dataParts.get("description").flatMap(_.headOption)
        val fallbackEditPositionRaw: Option[String] =
          request.body.dataParts.get("fallbackEditPosition").flatMap(_.headOption)
        val fallbackEditRotationRaw: Option[String] =
          request.body.dataParts.get("fallbackEditRotation").flatMap(_.headOption)
        val fallbackZoomLevelRaw: Option[String] =
          request.body.dataParts.get("fallbackZoomLevel").flatMap(_.headOption)
        val userOrganizationId = request.identity._organization
        val attachedFiles = request.body.files.map(f => (f.ref.path.toFile, f.filename))
        for {
          fallbackEditPosition <- Fox.runOptional(fallbackEditPositionRaw)(p => Vec3Int.fromUriLiteral(p).toFox)
          fallbackEditRotation <- Fox.runOptional(fallbackEditRotationRaw)(r => Vec3Double.fromUriLiteral(r).toFox)
          fallbackZoomLevel <- Fox.runOptional(fallbackZoomLevelRaw)(z => z.toDoubleOpt.toFox)
          parsedFiles <- annotationUploadService.extractFromFiles(
            attachedFiles,
            SharedParsingParameters(
              useZipName = true,
              overwritingDatasetId,
              userOrganizationId,
              fallbackEditPosition = fallbackEditPosition,
              fallbackEditRotation = fallbackEditRotation,
              fallbackZoomLevel = fallbackZoomLevel
            )
          )
          parsedFilesWrapped = annotationUploadService.wrapOrPrefixGroups(
            parsedFiles.parseResults,
            shouldCreateGroupForEachFile
          )
          parseResultsFiltered: List[NmlParseResult] = parsedFilesWrapped.filter(_.succeeded)
          _ <- Fox.fromBool(parseResultsFiltered.nonEmpty).orElse(returnError(parsedFiles))
          parseSuccesses <- Fox.serialCombined(parseResultsFiltered)(r => r.toSuccessBox.toFox)
          name = nameForUploaded(parseResultsFiltered.map(_.fileName))
          description = overwritingDescription.getOrElse(descriptionForNMLs(parseResultsFiltered.map(_.description)))
          wkUrl = wkUrlsForNMLs(parseResultsFiltered.map(_.wkUrl))
          skeletonTracings = parseSuccesses.map(_.skeletonTracing)
          // Create a list of volume layers for each uploaded (non-skeleton-only) annotation.
          // This is what determines the merging strategy for volume layers
          volumeLayersGroupedRaw = parseSuccesses.map(_.volumeLayers).filter(_.nonEmpty)
          datasetIds = parseSuccesses.map(_.datasetId)
          dataset <- findDatasetForUploadedAnnotations(
            skeletonTracings,
            volumeLayersGroupedRaw.flatten,
            datasetIds,
            wkUrl
          )
          usableDataSource <- datasetService.usableDataSourceFor(dataset)
          volumeLayersGrouped <- adaptVolumeTracingsToFallbackLayer(volumeLayersGroupedRaw, dataset, usableDataSource)
          tracingStoreClient <- tracingStoreService.clientFor(dataset)
          newAnnotationId = ObjectId.generate
          (mergedVolumeLayers, earliestAccessibleVersion) <- mergeAndSaveVolumeLayers(
            newAnnotationId,
            volumeLayersGrouped,
            tracingStoreClient,
            parsedFiles.otherFiles,
            usableDataSource,
            dataset._id
          )
          mergedSkeletonLayers <- mergeAndSaveSkeletonLayers(skeletonTracings, tracingStoreClient)
          uploadedBookmarks = bookmarksForUpload(
            parseSuccesses,
            volumeLayersGrouped.flatten,
            mergedVolumeLayers,
            mergedSkeletonLayers,
            usableDataSource,
            parsedFiles.otherFiles,
            earliestAccessibleVersion
          )
          // Saved before the AnnotationProto that lists their ids.
          _ <- Fox.runIf(uploadedBookmarks.nonEmpty)(
            tracingStoreClient.saveUploadedBookmarks(newAnnotationId, uploadedBookmarks)
          )
          annotation = annotationService.createFrom(
            request.identity,
            dataset,
            mergedSkeletonLayers ::: mergedVolumeLayers,
            AnnotationType.Explorational,
            name,
            description,
            newAnnotationId
          )
          annotationProto = AnnotationProto(
            description = annotation.description,
            version = 0L,
            annotationLayers = annotation.annotationLayers.map(_.toProto),
            earliestAccessibleVersion = earliestAccessibleVersion,
            bookmarkIds = uploadedBookmarks.map(_.bookmark.id)
          )
          _ <- tracingStoreClient.saveAnnotationProto(annotation._id, annotationProto)
          _ <- annotationDAO.insertOne(annotation)
          _ = analyticsService.track(UploadAnnotationEvent(request.identity, annotation))
        } yield JsonOk(
          Json.obj("annotation" -> Json.obj("typ" -> annotation.typ, "id" -> annotation.id)),
          Msg.Nml.uploadSuccess
        )
      }
  }

  // Bookmarks are only imported if a single NML was uploaded. Merging several NMLs may change node and segment ids,
  // which the bookmarks would then need to be adapted to. The references to annotation layers are resolved to the
  // new tracingIds, references to things that do not exist (anymore) are dropped. The bookmarks count as created at
  // the first accessible version, together with their thumbnails.
  private def bookmarksForUpload(
      parseSuccesses: List[NmlParseSuccess],
      uploadedVolumeLayers: List[UploadedVolumeLayer],
      savedVolumeLayers: List[AnnotationLayer], // in the same order as uploadedVolumeLayers
      savedSkeletonLayers: List[AnnotationLayer],
      dataSource: UsableDataSource,
      otherFiles: Map[String, File],
      version: Long
  ): Seq[UploadedAnnotationBookmarkProto] =
    parseSuccesses match {
      case List(parseSuccess) =>
        val uploadedAndSavedVolumeLayers = uploadedVolumeLayers.zip(savedVolumeLayers)
        val volumeTracingIdsByName = uploadedAndSavedVolumeLayers.flatMap { case (uploaded, saved) =>
          uploaded.name.map(_ -> saved.tracingId)
        }.toMap
        // Editable mappings are named after the tracingId of their volume layer.
        val editableMappingNamesByVolumeName = uploadedAndSavedVolumeLayers.flatMap { case (uploaded, saved) =>
          uploaded.name.filter(_ => uploaded.editedMappingEdgesLocation.isDefined).map(_ -> saved.tracingId)
        }.toMap
        val skeletonTracingIdOpt = savedSkeletonLayers.headOption.map(_.tracingId)
        val datasetLayerNames = dataSource.dataLayers.map(_.name).toSet
        val nodeIds = parseSuccess.skeletonTracing.trees.flatMap(_.nodes.map(_.id)).toSet

        def readThumbnail(parsedBookmark: NmlParsedBookmark, size: BookmarkThumbnailSize.Value): Option[ByteString] =
          parsedBookmark.thumbnailLocations
            .get(size)
            .flatMap(otherFiles.get)
            .flatMap(file => tryo(Files.readAllBytes(file.toPath)).toOption)
            .filter(NmlBookmarks.isJpeg)
            .map(ByteString.copyFrom)

        parseSuccess.bookmarks.map { parsedBookmark =>
          val bookmarkWithResolvedLayers = NmlBookmarks.rewriteLayerReferences(
            parsedBookmark.bookmark,
            layerName = name =>
              NmlAnnotationLayerRef.decode(name) match {
                case Some(NmlVolumeLayerRef(volumeLayerName)) => volumeTracingIdsByName.get(volumeLayerName)
                case Some(NmlSkeletonLayerRef)                => skeletonTracingIdOpt
                case None                                     => Option.when(datasetLayerNames.contains(name))(name)
              },
            mappingName = name =>
              NmlAnnotationLayerRef.decode(name) match {
                case Some(NmlVolumeLayerRef(volumeLayerName)) => editableMappingNamesByVolumeName.get(volumeLayerName)
                case Some(NmlSkeletonLayerRef)                => None
                case None                                     => Some(name)
              }
          )
          val state = bookmarkWithResolvedLayers.state
          val smallThumbnail = readThumbnail(parsedBookmark, BookmarkThumbnailSize.small)
          val largeThumbnail = readThumbnail(parsedBookmark, BookmarkThumbnailSize.large)
          val hasThumbnails = smallThumbnail.isDefined || largeThumbnail.isDefined
          val bookmark = bookmarkWithResolvedLayers
            .withState(state.copy(activeNodeId = state.activeNodeId.filter(nodeIds.contains)))
            .withCreatedAtVersion(version)
            .copy(
              thumbnailVersion = Option.when(hasThumbnails)(version),
              thumbnailViewport = bookmarkWithResolvedLayers.thumbnailViewport.filter(_ => hasThumbnails)
            )
          UploadedAnnotationBookmarkProto(bookmark, smallThumbnail, largeThumbnail)
        }
      case _ =>
        if (parseSuccesses.exists(_.bookmarks.nonEmpty))
          logger.info(s"Dropping the bookmarks of ${parseSuccesses.length} merged annotation files on upload.")
        Seq.empty
    }

  private def layersHaveDuplicateFallbackLayer(annotationLayers: Seq[UploadedVolumeLayer]) = {
    val withFallbackLayer = annotationLayers.filter(_.tracing.fallbackLayer.isDefined)
    withFallbackLayer.length > withFallbackLayer.distinctBy(_.tracing.fallbackLayer).length
  }

  private def mergeAndSaveVolumeLayers(
      newAnnotationId: ObjectId,
      volumeLayersGrouped: Seq[List[UploadedVolumeLayer]],
      client: WKRemoteTracingStoreClient,
      otherFiles: Map[String, File],
      dataSource: UsableDataSource,
      datasetId: ObjectId
  ): Fox[(List[AnnotationLayer], Long)] =
    if (volumeLayersGrouped.isEmpty)
      Fox.successful(List(), 0L)
    else if (volumeLayersGrouped.exists(layersHaveDuplicateFallbackLayer(_)))
      Fox.failure("Cannot save annotation with multiple volume layers that have the same fallback segmentation layer.")
    else if (volumeLayersGrouped.length > 1 && volumeLayersGrouped.exists(_.length > 1))
      Fox.failure("Cannot merge multiple annotations that each have multiple volume layers.")
    else if (
      volumeLayersGrouped.length > 1 && volumeLayersGrouped.exists(_.exists(_.editedMappingEdgesLocation.isDefined))
    ) {
      Fox.failure("Cannot merge multiple annotations with editable mapping (proofreading) edges.")
    } else if (volumeLayersGrouped.length == 1) { // Just one annotation was uploaded, keep its layers separate
      var layerUpdatesStartVersionMutable = 1L
      var savedAnyEditableMappingVersionsMutable = false
      for {
        annotationLayers <- Fox.serialCombined(volumeLayersGrouped.toList.flatten.zipWithIndex) {
          volumeLayerWithIndex =>
            val uploadedVolumeLayer = volumeLayerWithIndex._1
            val idx = volumeLayerWithIndex._2
            val newTracingId = TracingId.generate
            for {
              numberOfSavedVersions <- client.saveEditableMappingIfPresent(
                newAnnotationId,
                newTracingId,
                uploadedVolumeLayer.getEditableMappingEdgesZipFrom(otherFiles),
                uploadedVolumeLayer.editedMappingBaseMappingName,
                startVersion = layerUpdatesStartVersionMutable
              )
              // The next layer’s update actions then need to start after this one
              _ = layerUpdatesStartVersionMutable = layerUpdatesStartVersionMutable + numberOfSavedVersions
              _ = if (numberOfSavedVersions > 0) savedAnyEditableMappingVersionsMutable = true
              mappingName =
                if (uploadedVolumeLayer.editedMappingEdgesLocation.isDefined) Some(newTracingId)
                else uploadedVolumeLayer.tracing.mappingName
              _ <- client.saveVolumeTracing(
                newAnnotationId,
                newTracingId,
                uploadedVolumeLayer.tracing.copy(mappingName = mappingName),
                uploadedVolumeLayer.getDataZipFrom(otherFiles),
                dataSource = dataSource,
                datasetId = datasetId
              )
            } yield AnnotationLayer(
              newTracingId,
              AnnotationLayerType.Volume,
              uploadedVolumeLayer.name.getOrElse(AnnotationLayer.defaultVolumeLayerName + idx.toString),
              AnnotationLayerStatistics.unknown
            )
        }
        // Only editable mapping (proofreading) uploads actually write update actions whose
        // history should stay inaccessible; plain volume/skeleton uploads keep earliestAccessibleVersion at 0.
        earliestAccessibleVersion =
          if (savedAnyEditableMappingVersionsMutable) layerUpdatesStartVersionMutable
          else 0L
      } yield (annotationLayers, earliestAccessibleVersion)
    } else { // Multiple annotations with volume layers (but at most one each) were uploaded, they have no editable mappings. Merge those volume layers into one
      val uploadedVolumeLayersFlat = volumeLayersGrouped.toList.flatten
      val newTracingId = TracingId.generate
      for {
        _ <- client.mergeVolumeTracingsByContents(
          newAnnotationId,
          newTracingId,
          VolumeTracings(uploadedVolumeLayersFlat.map(v => VolumeTracingOpt(Some(v.tracing)))),
          dataSource,
          datasetId,
          uploadedVolumeLayersFlat.map(v => v.getDataZipFrom(otherFiles))
        )
      } yield (
        List(
          AnnotationLayer(
            newTracingId,
            AnnotationLayerType.Volume,
            AnnotationLayer.defaultVolumeLayerName,
            AnnotationLayerStatistics.unknown
          )
        ),
        0L
      )
    }

  private def mergeAndSaveSkeletonLayers(
      skeletonTracings: List[SkeletonTracing],
      tracingStoreClient: WKRemoteTracingStoreClient
  ): Fox[List[AnnotationLayer]] =
    if (skeletonTracings.isEmpty)
      Fox.successful(List())
    else {
      val newTracingId = TracingId.generate
      for {
        _ <- tracingStoreClient.mergeSkeletonTracingsByContents(
          newTracingId,
          SkeletonTracings(skeletonTracings.map(t => SkeletonTracingOpt(Some(t))))
        )
      } yield List(
        AnnotationLayer(
          newTracingId,
          AnnotationLayerType.Skeleton,
          AnnotationLayer.defaultSkeletonLayerName,
          AnnotationLayerStatistics.unknown
        )
      )
    }

  private def findDatasetForUploadedAnnotations(
      skeletonTracings: List[SkeletonTracing],
      volumeTracings: List[UploadedVolumeLayer],
      datasetIds: List[ObjectId],
      wkUrl: String
  )(using ctx: DBAccessContext): Fox[Dataset] =
    for {
      datasetId <- SequenceUtils.findUniqueElement(datasetIds).toFox ?~> Msg.Nml.differentDatasets
      organizationIdOpt <- assertAllOnSameOrganization(skeletonTracings, volumeTracings) ?~> Msg.Nml.differentDatasets
      organizationIdOpt <- Fox.runOptional(organizationIdOpt) {
        organizationDAO.findOne(_)(using GlobalAccessContext).map(_._id)
      } ?~> (if (wkUrl.nonEmpty && conf.Http.uri != wkUrl) {
               Msg.Organization.notFoundWrongHost(organizationIdOpt.getOrElse(""), wkUrl, conf.Http.uri)
             } else Msg.Organization.notFound(organizationIdOpt.getOrElse(""))) ~> NOT_FOUND
      organizationId <- Fox.fillOption(organizationIdOpt) {
        organizationDAO.findOrganizationIdForDataset(datasetId)(using GlobalAccessContext)
      } ?~> Msg.Dataset.notFound(datasetId) ~> FORBIDDEN
      dataset <- datasetDAO.findOne(datasetId) ?~> (if (wkUrl.nonEmpty && conf.Http.uri != wkUrl) {
                                                      Msg.Dataset.notFoundWrongHost(datasetId, wkUrl, conf.Http.uri)
                                                    } else Msg.Dataset.notFound(datasetId)) ~> FORBIDDEN
      _ <- Fox.fromBool(organizationId == dataset._organization) ?~> Msg.Dataset.notFound(datasetId) ~> FORBIDDEN
    } yield dataset

  private def nameForUploaded(fileNames: Seq[String]) =
    if (fileNames.size == 1)
      fileNames.headOption.map(_.replaceAll("\\.nml$", "").replaceAll("\\.zip", ""))
    else
      None

  private def descriptionForNMLs(descriptions: Seq[Option[String]]) = {
    val nonEmptyDescriptions = descriptions.flatMap {
      case Some("")  => None
      case None      => None
      case Some(str) => Some(str.trim)
    }
    SequenceUtils.findUniqueElement(nonEmptyDescriptions).getOrElse("")
  }

  private def wkUrlsForNMLs(wkUrls: Seq[Option[String]]) =
    if (wkUrls.toSet.size == 1) wkUrls.headOption.flatten.getOrElse("") else ""

  private def returnError(zipParseResult: NmlResults.MultiNmlParseResult): Fox[Nothing] =
    if (zipParseResult.containsFailure) {
      val errors = zipParseResult.parseResults.flatMap {
        case result: NmlResults.NmlParseFailure =>
          Some("error" -> Msg.Nml.parseFailed(result.fileName, result.error))
        case _ => None
      }
      Fox.paramFailure("NML upload failed", Empty, Empty, Json.toJson(errors.map(m => Json.obj(m._1 -> m._2))))
    } else {
      // This does not work. It is not caught and processed properly
      Fox.paramFailure("NML upload failed", Empty, Empty, None)
    }

  private def assertAllOnSameOrganization(
      skeletons: List[SkeletonTracing],
      volumes: List[UploadedVolumeLayer]
  ): Fox[Option[String]] = {
    // Note that organizationIds are optional. Tracings with no organization attribute are ignored here
    val organizationIds = skeletons.flatMap(_.organizationId) ::: volumes.flatMap(_.tracing.organizationId)
    for {
      _ <- Fox.runOptional(organizationIds.headOption)(name => Fox.fromBool(organizationIds.forall(_ == name)))
    } yield organizationIds.headOption
  }

  private def adaptVolumeTracingsToFallbackLayer(
      volumeLayersGrouped: List[List[UploadedVolumeLayer]],
      dataset: Dataset,
      dataSource: UsableDataSource
  ): Fox[List[List[UploadedVolumeLayer]]] =
    for {
      dataStore <- dataStoreDAO.findOneByName(dataset._dataStore.trim)(using
        GlobalAccessContext
      ) ?~> Msg.DataStore.notFoundForDataset
      remoteDataStoreClient = new WKRemoteDataStoreClient(dataStore, rpc)
      allAdapted <- Fox.serialCombined(volumeLayersGrouped) { volumeLayers =>
        Fox.serialCombined(volumeLayers) { volumeLayer =>
          for {
            adaptedTracing <- adaptPropertiesToFallbackLayer(
              volumeLayer.tracing,
              dataSource,
              dataset,
              remoteDataStoreClient
            )
            adaptedAnnotationLayer = volumeLayer.copy(tracing = adaptedTracing)
          } yield adaptedAnnotationLayer
        }
      }
    } yield allAdapted

  private def adaptPropertiesToFallbackLayer(
      volumeTracing: VolumeTracing,
      dataSource: UsableDataSource,
      dataset: Dataset,
      remoteDataStoreClient: WKRemoteDataStoreClient
  ): Fox[VolumeTracing] = {
    val fallbackLayerOpt = dataSource.dataLayers.flatMap {
      case layer: StaticSegmentationLayer if volumeTracing.fallbackLayer contains layer.name => Some(layer)
      case _                                                                                 => None
    }.headOption
    val bbox =
      if (boundingBoxFromProto(volumeTracing.boundingBox).isEmpty)
        boundingBoxToProto(fallbackLayerOpt.map(_.boundingBox).getOrElse(dataSource.boundingBox))
      else volumeTracing.boundingBox

    for {
      tracingCanHaveSegmentIndex <- canHaveSegmentIndex(
        dataset._id,
        fallbackLayerOpt.map(_.name),
        remoteDataStoreClient
      )
      elementClassProto <- fallbackLayerOpt
        .map(layer => ElementClass.toProto(layer.elementClass))
        .getOrElse(ElementClass.toProto(VolumeTracingDefaults.elementClass))
        .toFox
    } yield volumeTracing.copy(
      boundingBox = bbox,
      elementClass = elementClassProto,
      fallbackLayer = fallbackLayerOpt.map(_.name),
      largestSegmentId =
        combineLargestSegmentIdsByPrecedence(volumeTracing.largestSegmentId, fallbackLayerOpt.map(_.largestSegmentId)),
      mags = VolumeTracingMags.magsForVolumeTracing(dataSource, fallbackLayerOpt).map(vec3IntToProto),
      hasSegmentIndex = Some(tracingCanHaveSegmentIndex)
    )
  }

  private def canHaveSegmentIndex(
      datasetId: ObjectId,
      fallbackLayerName: Option[String],
      remoteDataStoreClient: WKRemoteDataStoreClient
  )(implicit ec: ExecutionContext): Fox[Boolean] =
    fallbackLayerName match {
      case Some(layerName) =>
        remoteDataStoreClient.hasSegmentIndexFile(datasetId, layerName)
      case None =>
        Fox.successful(true)
    }

  // NML or Zip file containing skeleton and/or volume data of this annotation. In case of Compound annotations, multiple such annotations wrapped in another zip
  def download(
      typ: String,
      id: ObjectId,
      version: Option[Long],
      skipVolumeData: Option[Boolean],
      volumeDataZipFormat: Option[String]
  ): Action[AnyContent] =
    sil.UserAwareAction.fox { implicit request =>
      logger.trace(s"Requested download for annotation: $typ/$id")
      for {
        identifier <- AnnotationIdentifier.parse(typ, id)
        volumeDataZipFormatParsed = volumeDataZipFormat.flatMap(VolumeDataZipFormat.fromString)
        _ = request.identity.foreach(user => analyticsService.track(DownloadAnnotationEvent(user, id.toString, typ)))
        result <- identifier.annotationType match {
          case AnnotationType.View             => Fox.failure("Cannot download View annotation")
          case AnnotationType.CompoundProject  => downloadProject(id, request.identity, skipVolumeData.getOrElse(false))
          case AnnotationType.CompoundTask     => downloadTask(id, request.identity, skipVolumeData.getOrElse(false))
          case AnnotationType.CompoundTaskType =>
            downloadTaskType(id, request.identity, skipVolumeData.getOrElse(false))
          case _ =>
            downloadExplorational(
              id,
              typ,
              request.identity,
              version,
              skipVolumeData.getOrElse(false),
              volumeDataZipFormatParsed.getOrElse(VolumeDataZipFormat.wkw)
            ) ?~> Msg.Annotation.Download.failed
        }
      } yield result
    }

  def downloadWithoutType(
      id: ObjectId,
      version: Option[Long],
      skipVolumeData: Option[Boolean],
      volumeDataZipFormat: Option[String]
  ): Action[AnyContent] =
    sil.UserAwareAction.fox { implicit request =>
      for {
        annotation <- provider.provideAnnotation(id, request.identity) ?~> Msg.Annotation.notFound ~> NOT_FOUND
        result <- Fox.fromFuture(
          download(annotation.typ.toString, id, version, skipVolumeData, volumeDataZipFormat)(request)
        )
      } yield result
    }

  private def downloadExplorational(
      annotationId: ObjectId,
      typ: String,
      requestingUser: Option[User],
      version: Option[Long],
      skipVolumeData: Boolean,
      volumeDataZipFormat: VolumeDataZipFormat
  )(using ctx: DBAccessContext): Fox[Result] = {

    // Note: volumeVersion cannot currently be supplied per layer, see https://github.com/scalableminds/webknossos/issues/5925

    // Bookmark thumbnails are optional, missing ones are skipped.
    def fetchBookmarksWithThumbnails(
        tracingStoreClient: WKRemoteTracingStoreClient,
        annotationId: ObjectId
    ): Fox[Seq[NmlBookmarkToWrite]] =
      for {
        bookmarks <- tracingStoreClient.getBookmarks(annotationId, version)
        thumbnailRequests =
          for {
            bookmark <- bookmarks
            size <- BookmarkThumbnailSize.values.toSeq
          } yield (bookmark, size)
        // One request per thumbnail, so several are made at once.
        fetchedThumbnails <- Fox.batchCombined(thumbnailRequests, parallelity = 8) { request =>
          val (bookmark, size) = request
          tracingStoreClient
            .getBookmarkThumbnail(annotationId, bookmark, size)
            .map((thumbnailOpt: Option[Array[Byte]]) => thumbnailOpt.map(thumbnail => (bookmark.id, size, thumbnail)))
        }
        thumbnailsByBookmarkId: Map[Int, Map[BookmarkThumbnailSize.Value, Array[Byte]]] = fetchedThumbnails.flatten
          .groupBy(_._1)
          .map { case (bookmarkId, thumbnails) => bookmarkId -> thumbnails.map(t => t._2 -> t._3).toMap }
      } yield bookmarks.map(bookmark =>
        NmlBookmarkToWrite(bookmark, thumbnailsByBookmarkId.getOrElse(bookmark.id, Map.empty))
      )

    def annotationToTemporaryFile(
        dataset: Dataset,
        annotation: Annotation,
        name: String,
        organizationId: String
    ): Fox[Path] =
      for {
        tracingStoreClient <- tracingStoreService.clientFor(dataset)
        fetchedVolumeLayers: List[FetchedAnnotationLayer] <- Fox.serialCombined(annotation.volumeAnnotationLayers) {
          volumeAnnotationLayer =>
            tracingStoreClient.getVolumeTracing(
              annotation._id,
              volumeAnnotationLayer,
              version,
              skipVolumeData,
              volumeDataZipFormat,
              dataset.voxelSize
            )
        } ?~> Msg.Annotation.Download.fetchVolumeLayerFailed
        fetchedSkeletonLayers: List[FetchedAnnotationLayer] <- Fox.serialCombined(annotation.skeletonAnnotationLayers) {
          skeletonAnnotationLayer =>
            tracingStoreClient.getSkeletonTracing(annotation._id, skeletonAnnotationLayer, version)
        } ?~> Msg.Annotation.Download.fetchSkeletonLayerFailed
        annotationOwner <- userService.findOneCached(annotation._user)(using
          GlobalAccessContext
        ) ?~> Msg.Annotation.Download.findUserFailed
        ownerMultiUser <- multiUserDAO.findOne(annotationOwner._multiUser)(using GlobalAccessContext)
        taskOpt <- Fox.runOptional(annotation._task)(
          taskDAO.findOne(_)(using GlobalAccessContext)
        ) ?~> Msg.Task.notFound
        annotationProto <- tracingStoreClient.getAnnotationProto(annotation._id, version)
        bookmarks <- fetchBookmarksWithThumbnails(
          tracingStoreClient,
          annotation._id
        ) ?~> Msg.Annotation.Download.fetchBookmarksFailed
        datasetLayers <- datasetLayerDAO.findAllForDataset(dataset._id)
        nmlStream = nmlWriter.toNmlStream(
          name,
          annotationProto,
          fetchedSkeletonLayers ::: fetchedVolumeLayers,
          Some(annotation),
          dataset.voxelSize,
          None,
          organizationId,
          conf.Http.uri,
          dataset.name,
          dataset._id,
          annotation._user,
          ownerMultiUser.fullName,
          taskOpt,
          skipVolumeData,
          volumeDataZipFormat,
          requestingUser,
          bookmarks,
          Some(datasetLayers.map(_.name).toSet)
        )
        temporaryFile = tempFileService.create()
        zipper = ZipIO.startZip(new BufferedOutputStream(new FileOutputStream(new File(temporaryFile.toString))))
        _ <- Fox.withCleanup(for {
          _ <- zipper.addFileFromNamedStream(nmlStream, suffix = ".nml") ?~> Msg.Annotation.Download.zipNmlFailed
          _ = fetchedVolumeLayers.zipWithIndex.foreach { case (volumeLayer, index) =>
            volumeLayer.volumeDataOpt.foreach { volumeData =>
              val dataZipName = volumeLayer.volumeDataZipName(index, fetchedVolumeLayers.length == 1)
              zipper.stream.setLevel(Deflater.BEST_SPEED)
              zipper.addFileFromBytes(dataZipName, volumeData)
            }
            volumeLayer.editedMappingEdgesOpt.foreach { editedEdgesData =>
              val editedEdgesZipName = volumeLayer.editedMappingEdgesZipName(index, fetchedVolumeLayers.length == 1)
              zipper.stream.setLevel(Deflater.BEST_SPEED)
              zipper.addFileFromBytes(editedEdgesZipName, editedEdgesData)
            }
          }
          _ = bookmarks.foreach { bookmarkToWrite =>
            bookmarkToWrite.thumbnails.foreach { case (size, thumbnail) =>
              zipper.addFileFromBytes(NmlBookmarks.thumbnailLocation(bookmarkToWrite.bookmark.id, size), thumbnail)
            }
          }
        } yield ())(zipper.close())
      } yield temporaryFile

    for {
      annotation <- provider.provideAnnotation(typ, annotationId, requestingUser) ~> NOT_FOUND
      restrictions <- provider.restrictionsFor(typ, annotationId) ?~> Msg.Annotation.Restrictions.notFound
      name <- provider.nameFor(annotation) ?~> Msg.Annotation.nameNotAvailable
      fileName = URLEncoder.encode(name + ".zip", "UTF-8").replace("+", "%20")
      _ <- Fox.assertTrue(
        restrictions.allowDownload(requestingUser)
      ) ?~> Msg.Annotation.Download.notAllowed ~> FORBIDDEN
      dataset <- datasetDAO.findOne(annotation._dataset)(using GlobalAccessContext) ?~> Msg.Dataset
        .notFoundForAnnotation(annotation._dataset, annotation._id) ~> NOT_FOUND
      organization <- organizationDAO.findOne(dataset._organization)(using GlobalAccessContext) ?~> Msg.Organization
        .notFound(
          dataset._organization
        ) ~> NOT_FOUND
      temporaryFile <- annotationToTemporaryFile(
        dataset,
        annotation,
        name,
        organization._id
      ) ?~> Msg.Annotation.Download.writeToFileFailed
    } yield Ok
      .sendPath(temporaryFile, inline = false)
      .as(zipMimeType)
      .withHeaders(CONTENT_DISPOSITION -> s"""attachment; filename="$fileName"""")
  }

  private def downloadProject(projectId: ObjectId, requestingUserOpt: Option[User], skipVolumeData: Boolean)(implicit
      ctx: DBAccessContext
  ) =
    for {
      requestingUser <- requestingUserOpt.toFox ?~> Msg.notAllowed ~> FORBIDDEN
      project <- projectDAO.findOne(projectId) ?~> Msg.Project.notFound(projectId) ~> NOT_FOUND
      _ <- Fox.assertTrue(
        userService.isTeamManagerOrAdminOf(requestingUser, project._team)
      ) ?~> Msg.notAllowed ~> FORBIDDEN
      annotations <- annotationDAO.findAllFinishedForProject(projectId)
      zipTempFilePath <- annotationService.zipAnnotations(
        annotations,
        project.name,
        skipVolumeData,
        volumeDataZipFormatForCompoundAnnotations
      )
    } yield Ok.sendPath(
      zipTempFilePath,
      inline = false,
      fileName = _ => Some(TextUtils.normalize(project.name + "_nmls.zip"))
    )

  private def downloadTask(taskId: ObjectId, requestingUserOpt: Option[User], skipVolumeData: Boolean)(implicit
      ctx: DBAccessContext
  ) = {
    def createTaskZip(task: Task): Fox[Path] = annotationService.annotationsFor(task._id).flatMap { annotations =>
      val finished = annotations.filter(_.state == Finished)
      annotationService.zipAnnotations(
        finished,
        task._id.toString,
        skipVolumeData,
        volumeDataZipFormatForCompoundAnnotations
      )
    }

    for {
      requestingUser <- requestingUserOpt.toFox ?~> Msg.notAllowed ~> FORBIDDEN
      task <- taskDAO.findOne(taskId) ?~> Msg.Task.notFound(taskId) ~> NOT_FOUND
      project <- projectDAO.findOne(task._project) ?~> Msg.Project.notFound(task._project) ~> NOT_FOUND
      _ <- Fox.assertTrue(
        userService.isTeamManagerOrAdminOf(requestingUser, project._team)
      ) ?~> Msg.notAllowed ~> FORBIDDEN
      zipTempFilePath <- createTaskZip(task)
    } yield Ok.sendPath(
      zipTempFilePath,
      inline = false,
      fileName = _ => Some(TextUtils.normalize(task._id.toString + "_nmls.zip"))
    )
  }

  private def downloadTaskType(taskTypeId: ObjectId, requestingUserOpt: Option[User], skipVolumeData: Boolean)(implicit
      ctx: DBAccessContext
  ) = {
    def createTaskTypeZip(taskType: TaskType) =
      for {
        tasks <- taskDAO.findAllByTaskType(taskType._id)
        annotations <- Fox.serialCombined(tasks)(task => annotationService.annotationsFor(task._id)).map(_.flatten)
        finishedAnnotations = annotations.filter(_.state == Finished)
        zip <- annotationService.zipAnnotations(
          finishedAnnotations,
          taskType.summary,
          skipVolumeData,
          volumeDataZipFormatForCompoundAnnotations
        )
      } yield zip

    for {
      requestingUser <- requestingUserOpt.toFox ?~> Msg.notAllowed ~> FORBIDDEN
      taskType <- taskTypeDAO.findOne(taskTypeId) ?~> Msg.TaskType.notFound(taskTypeId) ~> NOT_FOUND
      _ <- Fox.assertTrue(
        userService.isTeamManagerOrAdminOf(requestingUser, taskType._team)
      ) ?~> Msg.notAllowed ~> FORBIDDEN
      zipTempFilePath <- createTaskTypeZip(taskType)
    } yield Ok.sendPath(
      zipTempFilePath,
      inline = false,
      fileName = _ => Some(TextUtils.normalize(taskType.summary + "_nmls.zip"))
    )
  }
}
