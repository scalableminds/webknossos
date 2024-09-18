package com.scalableminds.webknossos.tracingstore.controllers

import com.google.inject.Inject
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.ExtendedTypes.ExtendedString
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.AgglomerateGraph.AgglomerateGraph
import com.scalableminds.webknossos.datastore.ListOfLong.ListOfLong
import com.scalableminds.webknossos.datastore.VolumeTracing.{VolumeTracing, VolumeTracingOpt, VolumeTracings}
import com.scalableminds.webknossos.datastore.geometry.ListOfVec3IntProto
import com.scalableminds.webknossos.datastore.helpers.{
  GetSegmentIndexParameters,
  ProtoGeometryImplicits,
  SegmentStatisticsParameters
}
import com.scalableminds.webknossos.datastore.models.datasource.{AdditionalAxis, DataLayer}
import com.scalableminds.webknossos.datastore.models.{
  LengthUnit,
  VoxelSize,
  WebknossosAdHocMeshRequest,
  WebknossosDataRequest
}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.services.{
  EditableMappingSegmentListResult,
  FullMeshRequest,
  UserAccessRequest
}
import com.scalableminds.webknossos.tracingstore.annotation.{AnnotationTransactionService, UpdateActionGroup}
import com.scalableminds.webknossos.tracingstore.slacknotification.TSSlackNotificationService
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.{
  EditableMappingService,
  MinCutParameters,
  NeighborsParameters
}
import com.scalableminds.webknossos.tracingstore.tracings.volume.{
  MergedVolumeStats,
  ResolutionRestrictions,
  TSFullMeshService,
  UpdateMappingNameVolumeAction,
  VolumeDataZipFormat,
  VolumeSegmentIndexService,
  VolumeSegmentStatisticsService,
  VolumeTracingService
}
import com.scalableminds.webknossos.tracingstore.tracings.KeyValueStoreImplicits
import com.scalableminds.webknossos.tracingstore.{
  TSRemoteDatastoreClient,
  TSRemoteWebknossosClient,
  TracingStoreAccessTokenService,
  TracingStoreConfig,
  TracingUpdatesReport
}
import net.liftweb.common.{Box, Empty, Failure, Full}
import play.api.i18n.Messages
import play.api.libs.Files.TemporaryFile
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, MultipartFormData, PlayBodyParsers}

import java.io.File
import java.nio.{ByteBuffer, ByteOrder}
import scala.concurrent.ExecutionContext

class VolumeTracingController @Inject()(
    val tracingService: VolumeTracingService,
    val config: TracingStoreConfig,
    val remoteDataStoreClient: TSRemoteDatastoreClient,
    val accessTokenService: TracingStoreAccessTokenService,
    annotationTransactionService: AnnotationTransactionService,
    editableMappingService: EditableMappingService,
    val slackNotificationService: TSSlackNotificationService,
    val remoteWebknossosClient: TSRemoteWebknossosClient,
    volumeSegmentStatisticsService: VolumeSegmentStatisticsService,
    volumeSegmentIndexService: VolumeSegmentIndexService,
    fullMeshService: TSFullMeshService,
    val rpc: RPC)(implicit val ec: ExecutionContext, val bodyParsers: PlayBodyParsers)
    extends TracingController[VolumeTracing, VolumeTracings]
    with ProtoGeometryImplicits
    with KeyValueStoreImplicits {

  implicit val tracingsCompanion: VolumeTracings.type = VolumeTracings

  implicit def packMultiple(tracings: List[VolumeTracing]): VolumeTracings =
    VolumeTracings(tracings.map(t => VolumeTracingOpt(Some(t))))

  implicit def packMultipleOpt(tracings: List[Option[VolumeTracing]]): VolumeTracings =
    VolumeTracings(tracings.map(t => VolumeTracingOpt(t)))

  implicit def unpackMultiple(tracings: VolumeTracings): List[Option[VolumeTracing]] =
    tracings.tracings.toList.map(_.tracing)

  def initialData(token: Option[String],
                  annotationId: String,
                  tracingId: String,
                  minResolution: Option[Int],
                  maxResolution: Option[Int]): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        logTime(slackNotificationService.noticeSlowRequest) {
          accessTokenService.validateAccess(UserAccessRequest.webknossos) {
            for {
              initialData <- request.body.asRaw.map(_.asFile) ?~> Messages("zipFile.notFound")
              tracing <- tracingService.find(annotationId, tracingId) ?~> Messages("tracing.notFound")
              resolutionRestrictions = ResolutionRestrictions(minResolution, maxResolution)
              resolutions <- tracingService
                .initializeWithData(annotationId, tracingId, tracing, initialData, resolutionRestrictions)
                .toFox
              _ <- tracingService.updateResolutionList(tracingId, tracing, resolutions)
            } yield Ok(Json.toJson(tracingId))
          }
        }
      }
    }

  def mergedFromContents(token: Option[String], persist: Boolean): Action[VolumeTracings] =
    Action.async(validateProto[VolumeTracings]) { implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.webknossos) {
          for {
            _ <- Fox.successful(())
            tracings = request.body
            shouldCreateSegmentIndex = volumeSegmentIndexService.shouldCreateSegmentIndexForMerged(tracings.flatten)
            mt <- tracingService.merge(tracings.flatten, MergedVolumeStats.empty(shouldCreateSegmentIndex), Empty).toFox

            // segment lists for multi-volume uploads are not supported yet, compare https://github.com/scalableminds/webknossos/issues/6887
            mergedTracing = mt.copy(segments = List.empty)

            newId <- tracingService.save(mergedTracing, None, mergedTracing.version, toCache = !persist)
          } yield Ok(Json.toJson(newId))
        }
      }
    }

  def initialDataMultiple(token: Option[String], annotationId: String, tracingId: String): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        logTime(slackNotificationService.noticeSlowRequest) {
          accessTokenService.validateAccess(UserAccessRequest.webknossos) {
            for {
              initialData <- request.body.asRaw.map(_.asFile) ?~> Messages("zipFile.notFound")
              tracing <- tracingService.find(annotationId, tracingId) ?~> Messages("tracing.notFound")
              resolutions <- tracingService
                .initializeWithDataMultiple(annotationId, tracingId, tracing, initialData)
                .toFox
              _ <- tracingService.updateResolutionList(tracingId, tracing, resolutions)
            } yield Ok(Json.toJson(tracingId))
          }
        }
      }
    }

  def allDataZip(token: Option[String],
                 annotationId: String,
                 tracingId: String,
                 volumeDataZipFormat: String,
                 version: Option[Long],
                 voxelSizeFactor: Option[String],
                 voxelSizeUnit: Option[String]): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId)) {
          for {
            tracing <- tracingService.find(annotationId, tracingId, version) ?~> Messages("tracing.notFound")
            volumeDataZipFormatParsed <- VolumeDataZipFormat.fromString(volumeDataZipFormat).toFox
            voxelSizeFactorParsedOpt <- Fox.runOptional(voxelSizeFactor)(Vec3Double.fromUriLiteral)
            voxelSizeUnitParsedOpt <- Fox.runOptional(voxelSizeUnit)(LengthUnit.fromString)
            voxelSize = voxelSizeFactorParsedOpt.map(voxelSizeParsed =>
              VoxelSize.fromFactorAndUnitWithDefault(voxelSizeParsed, voxelSizeUnitParsedOpt))
            data <- tracingService.allDataZip(
              tracingId,
              tracing,
              volumeDataZipFormatParsed,
              voxelSize
            )
          } yield Ok.sendFile(data)
        }
      }
    }

  def data(token: Option[String], annotationId: String, tracingId: String): Action[List[WebknossosDataRequest]] =
    Action.async(validateJson[List[WebknossosDataRequest]]) { implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId)) {
          for {
            tracing <- tracingService.find(annotationId, tracingId) ?~> Messages("tracing.notFound")
            (data, indices) <- if (tracing.getHasEditableMapping)
              editableMappingService.volumeData(tracing, tracingId, request.body)
            else tracingService.data(tracingId, tracing, request.body)
          } yield Ok(data).withHeaders(getMissingBucketsHeaders(indices): _*)
        }
      }
    }

  private def getMissingBucketsHeaders(indices: List[Int]): Seq[(String, String)] =
    List("MISSING-BUCKETS" -> formatMissingBucketList(indices), "Access-Control-Expose-Headers" -> "MISSING-BUCKETS")

  private def formatMissingBucketList(indices: List[Int]): String =
    "[" + indices.mkString(", ") + "]"

  def duplicate(token: Option[String],
                annotationId: String,
                tracingId: String,
                fromTask: Option[Boolean],
                minResolution: Option[Int],
                maxResolution: Option[Int],
                downsample: Option[Boolean],
                editPosition: Option[String],
                editRotation: Option[String],
                boundingBox: Option[String]): Action[AnyContent] = Action.async { implicit request =>
    log() {
      logTime(slackNotificationService.noticeSlowRequest) {
        accessTokenService.validateAccess(UserAccessRequest.webknossos) {
          for {
            tracing <- tracingService.find(annotationId, tracingId) ?~> Messages("tracing.notFound")
            _ = logger.info(s"Duplicating volume tracing $tracingId...")
            datasetBoundingBox = request.body.asJson.flatMap(_.validateOpt[BoundingBox].asOpt.flatten)
            resolutionRestrictions = ResolutionRestrictions(minResolution, maxResolution)
            editPositionParsed <- Fox.runOptional(editPosition)(Vec3Int.fromUriLiteral)
            editRotationParsed <- Fox.runOptional(editRotation)(Vec3Double.fromUriLiteral)
            boundingBoxParsed <- Fox.runOptional(boundingBox)(BoundingBox.fromLiteral)
            remoteFallbackLayerOpt <- Fox.runIf(tracing.getHasEditableMapping)(
              tracingService.remoteFallbackLayerFromVolumeTracing(tracing, tracingId))
            newTracingId = tracingService.generateTracingId
            _ <- Fox.runIf(tracing.getHasEditableMapping)(
              editableMappingService.duplicate(tracingId, newTracingId, version = None, remoteFallbackLayerOpt))
            (newId, newTracing) <- tracingService.duplicate(
              annotationId,
              tracingId,
              newTracingId,
              tracing,
              fromTask.getOrElse(false),
              datasetBoundingBox,
              resolutionRestrictions,
              editPositionParsed,
              editRotationParsed,
              boundingBoxParsed,
              mappingName = None
            )
            _ <- Fox.runIfOptionTrue(downsample)(tracingService.downsample(annotationId, newId, tracingId, newTracing))
          } yield Ok(Json.toJson(newId))
        }
      }
    }
  }

  def importVolumeData(token: Option[String],
                       annotationId: String,
                       tracingId: String): Action[MultipartFormData[TemporaryFile]] =
    Action.async(parse.multipartFormData) { implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.writeTracing(tracingId)) {
          for {
            tracing <- tracingService.find(annotationId, tracingId) ?~> Messages("tracing.notFound")
            currentVersion <- request.body.dataParts("currentVersion").headOption.flatMap(_.toIntOpt).toFox
            zipFile <- request.body.files.headOption.map(f => new File(f.ref.path.toString)).toFox
            largestSegmentId <- tracingService.importVolumeData(annotationId,
                                                                tracingId,
                                                                tracing,
                                                                zipFile,
                                                                currentVersion)
          } yield Ok(Json.toJson(largestSegmentId))
        }
      }
    }

  def addSegmentIndex(token: Option[String],
                      annotationId: String,
                      tracingId: String,
                      dryRun: Boolean): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.webknossos) {
          for {
            tracing <- tracingService.find(annotationId, tracingId) ?~> Messages("tracing.notFound")
            currentVersion <- tracingService.currentVersion(tracingId)
            before = Instant.now
            canAddSegmentIndex <- tracingService.checkIfSegmentIndexMayBeAdded(tracingId, tracing)
            processedBucketCountOpt <- Fox.runIf(canAddSegmentIndex)(tracingService
              .addSegmentIndex(annotationId, tracingId, tracing, currentVersion, dryRun)) ?~> "addSegmentIndex.failed"
            currentVersionNew <- tracingService.currentVersion(tracingId)
            _ <- Fox.runIf(!dryRun)(bool2Fox(
              processedBucketCountOpt.isEmpty || currentVersionNew == currentVersion + 1L) ?~> "Version increment failed. Looks like someone edited the annotation layer in the meantime.")
            duration = Instant.since(before)
            _ = processedBucketCountOpt.foreach { processedBucketCount =>
              logger.info(
                s"Added segment index (dryRun=$dryRun) for tracing $tracingId. Took $duration for $processedBucketCount buckets")
            }
          } yield Ok
        }
      }
    }

  def updateActionLog(token: Option[String],
                      tracingId: String,
                      newestVersion: Option[Long] = None,
                      oldestVersion: Option[Long] = None): Action[AnyContent] = Action.async { implicit request =>
    log() {
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId)) {
        for {
          updateLog <- tracingService.updateActionLog(tracingId, newestVersion, oldestVersion)
        } yield Ok(updateLog)
      }
    }
  }

  def requestAdHocMesh(token: Option[String],
                       annotationId: String,
                       tracingId: String): Action[WebknossosAdHocMeshRequest] =
    Action.async(validateJson[WebknossosAdHocMeshRequest]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId)) {
        for {
          // The client expects the ad-hoc mesh as a flat float-array. Three consecutive floats form a 3D point, three
          // consecutive 3D points (i.e., nine floats) form a triangle.
          // There are no shared vertices between triangles.
          tracing <- tracingService.find(annotationId, tracingId) ?~> Messages("tracing.notFound")
          (vertices, neighbors) <- if (tracing.getHasEditableMapping)
            editableMappingService.createAdHocMesh(tracing, tracingId, request.body)
          else tracingService.createAdHocMesh(annotationId, tracingId, request.body)
        } yield {
          // We need four bytes for each float
          val responseBuffer = ByteBuffer.allocate(vertices.length * 4).order(ByteOrder.LITTLE_ENDIAN)
          responseBuffer.asFloatBuffer().put(vertices)
          Ok(responseBuffer.array()).withHeaders(getNeighborIndices(neighbors): _*)
        }
      }
    }

  def loadFullMeshStl(token: Option[String], annotationId: String, tracingId: String): Action[FullMeshRequest] =
    Action.async(validateJson[FullMeshRequest]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId)) {
        for {
          data: Array[Byte] <- fullMeshService.loadFor(annotationId, tracingId, request.body) ?~> "mesh.file.loadChunk.failed"
        } yield Ok(data)
      }
    }

  private def getNeighborIndices(neighbors: List[Int]) =
    List("NEIGHBORS" -> formatNeighborList(neighbors), "Access-Control-Expose-Headers" -> "NEIGHBORS")

  private def formatNeighborList(neighbors: List[Int]): String =
    "[" + neighbors.mkString(", ") + "]"

  def findData(token: Option[String], annotationId: String, tracingId: String): Action[AnyContent] = Action.async {
    implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId)) {
        for {
          positionOpt <- tracingService.findData(annotationId, tracingId)
        } yield {
          Ok(Json.obj("position" -> positionOpt, "resolution" -> positionOpt.map(_ => Vec3Int.ones)))
        }
      }
  }

  def agglomerateSkeleton(token: Option[String],
                          annotationId: String,
                          tracingId: String,
                          agglomerateId: Long): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId)) {
        for {
          tracing <- tracingService.find(annotationId, tracingId)
          _ <- bool2Fox(tracing.getHasEditableMapping) ?~> "Cannot query agglomerate skeleton for volume annotation"
          mappingName <- tracing.mappingName ?~> "annotation.agglomerateSkeleton.noMappingSet"
          remoteFallbackLayer <- tracingService.remoteFallbackLayerFromVolumeTracing(tracing, tracingId)
          agglomerateSkeletonBytes <- editableMappingService.getAgglomerateSkeletonWithFallback(mappingName,
                                                                                                remoteFallbackLayer,
                                                                                                agglomerateId)
        } yield Ok(agglomerateSkeletonBytes)
      }
    }

  def makeMappingEditable(token: Option[String], annotationId: String, tracingId: String): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId)) {
          for {
            tracing <- tracingService.find(annotationId, tracingId)
            tracingMappingName <- tracing.mappingName ?~> "annotation.noMappingSet"
            _ <- assertMappingIsNotLocked(tracing)
            _ <- bool2Fox(tracingService.volumeBucketsAreEmpty(tracingId)) ?~> "annotation.volumeBucketsNotEmpty"
            editableMappingInfo <- editableMappingService.create(tracingId, baseMappingName = tracingMappingName)
            volumeUpdate = UpdateMappingNameVolumeAction(Some(tracingId),
                                                         isEditable = Some(true),
                                                         isLocked = Some(true),
                                                         actionTracingId = tracingId,
                                                         actionTimestamp = Some(System.currentTimeMillis()))
            _ <- annotationTransactionService
              .handleUpdateGroups( // TODO replace this route by the update action only? address editable mappings by volume tracing id?
                annotationId,
                List(
                  UpdateActionGroup(tracing.version + 1,
                                    System.currentTimeMillis(),
                                    None,
                                    List(volumeUpdate),
                                    None,
                                    None,
                                    "dummyTransactionId",
                                    1,
                                    0))
              )
            infoJson <- editableMappingService.infoJson(tracingId = tracingId,
                                                        editableMappingInfo = editableMappingInfo,
                                                        version = Some(0L))
          } yield Ok(infoJson)
        }
      }
    }

  private def assertMappingIsNotLocked(volumeTracing: VolumeTracing): Fox[Unit] =
    bool2Fox(!volumeTracing.mappingIsLocked.getOrElse(false)) ?~> "annotation.mappingIsLocked"

  def agglomerateGraphMinCut(token: Option[String], annotationId: String, tracingId: String): Action[MinCutParameters] =
    Action.async(validateJson[MinCutParameters]) { implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId)) {
          for {
            tracing <- tracingService.find(annotationId, tracingId)
            _ <- bool2Fox(tracing.getHasEditableMapping) ?~> "Mapping is not editable"
            remoteFallbackLayer <- tracingService.remoteFallbackLayerFromVolumeTracing(tracing, tracingId)
            edges <- editableMappingService.agglomerateGraphMinCut(tracingId, request.body, remoteFallbackLayer)
          } yield Ok(Json.toJson(edges))
        }
      }
    }

  def agglomerateGraphNeighbors(token: Option[String],
                                annotationId: String,
                                tracingId: String): Action[NeighborsParameters] =
    Action.async(validateJson[NeighborsParameters]) { implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId)) {
          for {
            tracing <- tracingService.find(annotationId, tracingId)
            _ <- editableMappingService.assertTracingHasEditableMapping(tracing)
            remoteFallbackLayer <- tracingService.remoteFallbackLayerFromVolumeTracing(tracing, tracingId)
            (segmentId, edges) <- editableMappingService.agglomerateGraphNeighbors(tracingId,
                                                                                   request.body,
                                                                                   remoteFallbackLayer)
          } yield Ok(Json.obj("segmentId" -> segmentId, "neighbors" -> Json.toJson(edges)))
        }
      }
    }

  def updateEditableMapping(token: Option[String],
                            annotationId: String,
                            tracingId: String): Action[List[UpdateActionGroup]] =
    Action.async(validateJson[List[UpdateActionGroup]]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.writeTracing(tracingId)) {
        for {
          tracing <- tracingService.find(annotationId, tracingId)
          mappingName <- tracing.mappingName.toFox
          _ <- editableMappingService.assertTracingHasEditableMapping(tracing)
          currentVersion <- editableMappingService.getClosestMaterializableVersionOrZero(mappingName, None)
          _ <- bool2Fox(request.body.length == 1) ?~> "Editable mapping update request must contain exactly one update group"
          updateGroup <- request.body.headOption.toFox
          _ <- bool2Fox(updateGroup.version == currentVersion + 1) ?~> "version mismatch"
          report = TracingUpdatesReport(
            annotationId, // TODO integrate all of this into annotation update
            timestamps = List(Instant(updateGroup.timestamp)),
            statistics = None,
            significantChangesCount = updateGroup.actions.length,
            viewChangesCount = 0,
            tokenContextForRequest.userTokenOpt
          )
          _ <- remoteWebknossosClient.reportTracingUpdates(report)
          remoteFallbackLayer <- tracingService.remoteFallbackLayerFromVolumeTracing(tracing, tracingId)
          _ <- editableMappingService.update(mappingName, updateGroup, updateGroup.version, remoteFallbackLayer)
        } yield Ok
      }
    }

  def editableMappingInfo(token: Option[String],
                          annotationId: String,
                          tracingId: String,
                          version: Option[Long]): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId)) {
          for {
            tracing <- tracingService.find(annotationId, tracingId)
            _ <- editableMappingService.assertTracingHasEditableMapping(tracing)
            editableMappingInfo <- editableMappingService.getInfoNEW(annotationId, tracingId, version)
            infoJson <- editableMappingService.infoJson(tracingId = tracingId,
                                                        editableMappingInfo = editableMappingInfo,
                                                        version = version)
          } yield Ok(infoJson)
        }
      }
    }

  def editableMappingAgglomerateIdsForSegments(token: Option[String],
                                               annotationId: String,
                                               tracingId: String): Action[ListOfLong] =
    Action.async(validateProto[ListOfLong]) { implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId)) {
          for {
            tracing <- tracingService.find(annotationId, tracingId)
            _ <- editableMappingService.assertTracingHasEditableMapping(tracing)
            remoteFallbackLayer <- tracingService.remoteFallbackLayerFromVolumeTracing(tracing, tracingId)
            (editableMappingInfo, editableMappingVersion) <- editableMappingService.getInfoAndActualVersion(
              tracingId,
              requestedVersion = None,
              remoteFallbackLayer = remoteFallbackLayer)
            relevantMapping: Map[Long, Long] <- editableMappingService.generateCombinedMappingForSegmentIds(
              request.body.items.toSet,
              editableMappingInfo,
              editableMappingVersion,
              tracingId,
              remoteFallbackLayer)
            agglomerateIdsSorted = relevantMapping.toSeq.sortBy(_._1).map(_._2)
          } yield Ok(ListOfLong(agglomerateIdsSorted).toByteArray)
        }
      }
    }

  def editableMappingSegmentIdsForAgglomerate(token: Option[String],
                                              annotationId: String,
                                              tracingId: String,
                                              agglomerateId: Long): Action[AnyContent] = Action.async {
    implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId)) {
          for {
            tracing <- tracingService.find(annotationId, tracingId)
            mappingName <- tracing.mappingName.toFox
            remoteFallbackLayer <- tracingService.remoteFallbackLayerFromVolumeTracing(tracing, tracingId)
            agglomerateGraphBox: Box[AgglomerateGraph] <- editableMappingService
              .getAgglomerateGraphForId(mappingName, agglomerateId, remoteFallbackLayer)
              .futureBox
            segmentIds <- agglomerateGraphBox match {
              case Full(agglomerateGraph) => Fox.successful(agglomerateGraph.segments)
              case Empty                  => Fox.successful(List.empty)
              case f: Failure             => f.toFox
            }
            agglomerateIdIsPresent = agglomerateGraphBox.isDefined
          } yield Ok(Json.toJson(EditableMappingSegmentListResult(segmentIds.toList, agglomerateIdIsPresent)))
        }
      }
  }

  def getSegmentVolume(token: Option[String],
                       annotationId: String,
                       tracingId: String): Action[SegmentStatisticsParameters] =
    Action.async(validateJson[SegmentStatisticsParameters]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId)) {
        for {
          tracing <- tracingService.find(annotationId, tracingId)
          mappingName <- tracingService.baseMappingName(tracing)
          segmentVolumes <- Fox.serialCombined(request.body.segmentIds) { segmentId =>
            volumeSegmentStatisticsService.getSegmentVolume(annotationId,
                                                            tracingId,
                                                            segmentId,
                                                            request.body.mag,
                                                            mappingName,
                                                            request.body.additionalCoordinates)
          }
        } yield Ok(Json.toJson(segmentVolumes))
      }
    }

  def getSegmentBoundingBox(token: Option[String],
                            annotationId: String,
                            tracingId: String): Action[SegmentStatisticsParameters] =
    Action.async(validateJson[SegmentStatisticsParameters]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId)) {
        for {
          tracing <- tracingService.find(annotationId, tracingId)
          mappingName <- tracingService.baseMappingName(tracing)
          segmentBoundingBoxes: List[BoundingBox] <- Fox.serialCombined(request.body.segmentIds) { segmentId =>
            volumeSegmentStatisticsService.getSegmentBoundingBox(annotationId,
                                                                 tracingId,
                                                                 segmentId,
                                                                 request.body.mag,
                                                                 mappingName,
                                                                 request.body.additionalCoordinates)
          }
        } yield Ok(Json.toJson(segmentBoundingBoxes))
      }
    }

  def getSegmentIndex(token: Option[String],
                      annotationId: String,
                      tracingId: String,
                      segmentId: Long): Action[GetSegmentIndexParameters] =
    Action.async(validateJson[GetSegmentIndexParameters]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId)) {
        for {
          fallbackLayer <- tracingService.getFallbackLayer(annotationId, tracingId)
          tracing <- tracingService.find(annotationId, tracingId)
          mappingName <- tracingService.baseMappingName(tracing)
          _ <- bool2Fox(DataLayer.bucketSize <= request.body.cubeSize) ?~> "cubeSize must be at least one bucket (32³)"
          bucketPositionsRaw: ListOfVec3IntProto <- volumeSegmentIndexService
            .getSegmentToBucketIndexWithEmptyFallbackWithoutBuffer(
              fallbackLayer,
              tracingId,
              segmentId,
              request.body.mag,
              additionalCoordinates = request.body.additionalCoordinates,
              additionalAxes = AdditionalAxis.fromProtosAsOpt(tracing.additionalAxes),
              mappingName = mappingName,
              editableMappingTracingId = tracingService.editableMappingTracingId(tracing, tracingId)
            )
          bucketPositionsForCubeSize = bucketPositionsRaw.values
            .map(vec3IntFromProto)
            .map(_.scale(DataLayer.bucketLength)) // bucket positions raw are indices of 32³ buckets
            .map(_ / request.body.cubeSize)
            .distinct // divide by requested cube size to map them to larger buckets, select unique
            .map(_ * request.body.cubeSize) // return positions, not indices
        } yield Ok(Json.toJson(bucketPositionsForCubeSize))
      }
    }

}
