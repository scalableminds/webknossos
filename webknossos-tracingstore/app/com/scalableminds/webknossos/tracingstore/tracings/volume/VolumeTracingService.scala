package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.io.{NamedStream, ZipIO}
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.VolumeTracing.{VolumeTracing, VolumeUserStateProto}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.ElementClassProto
import com.scalableminds.webknossos.datastore.dataformats.wkw.WKWDataFormatHelper
import com.scalableminds.webknossos.datastore.geometry.NamedBoundingBoxProto
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.DataRequestCollection.DataRequestCollection
import com.scalableminds.webknossos.datastore.models._
import com.scalableminds.webknossos.datastore.models.datasource.{AdditionalAxis, DataLayer, ElementClass}
import com.scalableminds.webknossos.datastore.models.requests.DataServiceDataRequest
import com.scalableminds.webknossos.datastore.services._
import com.scalableminds.webknossos.datastore.services.mesh.{AdHocMeshRequest, AdHocMeshService, AdHocMeshServiceHolder}
import com.scalableminds.webknossos.tracingstore.files.TsTempFileService
import com.scalableminds.webknossos.tracingstore.tracings.GroupUtils.FunctionalGroupMapping
import com.scalableminds.webknossos.tracingstore.tracings.TracingType.TracingType
import com.scalableminds.webknossos.tracingstore.tracings._
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeDataZipFormat.VolumeDataZipFormat
import com.scalableminds.webknossos.tracingstore.{TSRemoteDatastoreClient, TSRemoteWebknossosClient}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}
import play.api.i18n.{Messages, MessagesProvider}

import java.io._
import java.nio.file.{Path, Paths}
import java.util.Base64
import java.util.zip.Deflater
import scala.collection.mutable
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

class VolumeTracingService @Inject()(
    tracingDataStore: TracingDataStore,
    adHocMeshServiceHolder: AdHocMeshServiceHolder,
    tempFileService: TsTempFileService,
    volumeSegmentIndexService: VolumeSegmentIndexService,
    datasetErrorLoggingService: TSDatasetErrorLoggingService,
    val temporaryTracingService: TemporaryTracingService,
    val remoteDatastoreClient: TSRemoteDatastoreClient,
    val remoteWebknossosClient: TSRemoteWebknossosClient
)(implicit val ec: ExecutionContext)
    extends VolumeTracingBucketHelper
    with WKWDataFormatHelper
    with FallbackDataHelper
    with DataFinder
    with ColorGenerator
    with BoundingBoxMerger
    with VolumeDataZipHelper
    with ProtoGeometryImplicits
    with FoxImplicits
    with Formatter
    with LazyLogging {

  implicit val volumeDataStore: FossilDBClient = tracingDataStore.volumeData

  implicit val tracingCompanion: VolumeTracing.type = VolumeTracing

  val tracingType: TracingType = TracingType.volume

  val tracingStore: FossilDBClient = tracingDataStore.volumes

  protected val volumeSegmentIndexClient: FossilDBClient = tracingDataStore.volumeSegmentIndex

  /* We want to reuse the bucket loading methods from binaryDataService for the volume tracings, however, it does not
     actually load anything from disk, unlike its “normal” instance in the datastore (only from the volume tracing store) */
  private val binaryDataService = new BinaryDataService(Paths.get(""), None, None, None, datasetErrorLoggingService)

  adHocMeshServiceHolder.tracingStoreAdHocMeshConfig = (binaryDataService, 30 seconds, 1)
  val adHocMeshService: AdHocMeshService = adHocMeshServiceHolder.tracingStoreAdHocMeshService

  // (tracingId, fallbackLayerNameOpt, userTokenOpt) → remoteFallbackLayerOpt
  private val fallbackLayerCache: AlfuCache[(String, Option[String], Option[String]), Option[RemoteFallbackLayer]] =
    AlfuCache(maxCapacity = 100)

  def saveVolume(tracingId: String,
                 version: Long,
                 tracing: VolumeTracing,
                 toTemporaryStore: Boolean = false): Fox[Unit] =
    if (toTemporaryStore)
      temporaryTracingService.saveVolume(tracingId, tracing)
    else
      tracingDataStore.volumes.put(tracingId, version, tracing)

  private def updateSegmentIndex(volumeLayer: VolumeTracingLayer,
                                 segmentIndexBuffer: VolumeSegmentIndexBuffer,
                                 bucketPosition: BucketPosition,
                                 bucketBytes: Array[Byte],
                                 previousBucketBytesBox: Box[Array[Byte]],
                                 editableMappingTracingId: Option[String]): Fox[Unit] =
    volumeSegmentIndexService.updateFromBucket(volumeLayer: VolumeTracingLayer,
                                               segmentIndexBuffer,
                                               bucketPosition,
                                               bucketBytes,
                                               previousBucketBytesBox,
                                               editableMappingTracingId) ?~> "volumeSegmentIndex.update.failed"

  def applyBucketMutatingActions(tracingId: String,
                                 annotationId: String,
                                 tracing: VolumeTracing,
                                 updateActions: List[BucketMutatingVolumeUpdateAction],
                                 newVersion: Long)(implicit tc: TokenContext): Fox[Unit] =
    for {
      // warning, may be called multiple times with the same version number (due to transaction management).
      // frontend ensures that each bucket is only updated once per transaction
      _ <- Fox.successful(())
      volumeLayer = volumeTracingLayer(annotationId, tracingId, tracing, includeFallbackDataIfAvailable = true)
      fallbackLayerOpt <- getFallbackLayer(annotationId, tracing)
      mappingName <- getMappingNameUnlessEditable(volumeLayer.tracing)
      segmentIndexBuffer = new VolumeSegmentIndexBuffer(
        tracingId,
        tracing.elementClass,
        mappingName,
        volumeSegmentIndexClient,
        newVersion,
        remoteDatastoreClient,
        fallbackLayerOpt,
        AdditionalAxis.fromProtosAsOpt(tracing.additionalAxes),
        temporaryTracingService,
        tc
      )
      volumeBucketBuffer = new VolumeBucketBuffer(
        newVersion,
        volumeLayer,
        volumeDataStore,
        temporaryTracingService,
        false,
        tc,
        ec
      )
      _ <- Fox.runIf(volumeLayer.tracing.getHasSegmentIndex)(volumeBucketBuffer.prefill(updateActions.flatMap {
        case a: UpdateBucketVolumeAction => Some(a.bucketPosition)
        case _                           => None
      }) ?~> "annotation.update.failed.prefillBucketBuffer")
      _ <- Fox.serialCombined(updateActions) {
        case a: UpdateBucketVolumeAction =>
          if (tracing.getHasEditableMapping) {
            Fox.failure("Cannot mutate volume data in annotation with editable mapping.")
          } else
            updateBucket(tracingId, volumeLayer, a, segmentIndexBuffer, volumeBucketBuffer) ?~> "Failed to save volume data."
        case a: DeleteSegmentDataVolumeAction =>
          if (!tracing.getHasSegmentIndex) {
            Fox.failure("Cannot delete segment data for annotations without segment index.")
          } else
            deleteSegmentData(tracingId, annotationId, tracing, a, segmentIndexBuffer, newVersion) ?~> "Failed to delete segment data."
        case _ => Fox.failure("Unknown bucket-mutating action.")
      }
      _ <- volumeBucketBuffer.flush()
      _ <- segmentIndexBuffer.flush()
    } yield ()

  private def updateBucket(tracingId: String,
                           volumeLayer: VolumeTracingLayer,
                           action: UpdateBucketVolumeAction,
                           segmentIndexBuffer: VolumeSegmentIndexBuffer,
                           volumeBucketBuffer: VolumeBucketBuffer): Fox[Unit] =
    for {
      _ <- Fox.fromBool(!action.bucketPosition.hasNegativeComponent) ?~> s"Received a bucket at negative position (${action.bucketPosition}), must be positive"
      _ <- assertMagIsValid(volumeLayer.tracing, action.mag) ?~> s"Received a mag-${action.mag.toMagLiteral(allowScalar = true)} bucket, which is invalid for this annotation."

      actionBucketData <- action.base64Data.map(Base64.getDecoder.decode).toFox
      _ <- Fox.runIf(volumeLayer.tracing.getHasSegmentIndex) {
        for {
          previousBucketBytes <- volumeBucketBuffer.getWithFallback(action.bucketPosition).shiftBox
          _ <- updateSegmentIndex(
            volumeLayer,
            segmentIndexBuffer,
            action.bucketPosition,
            actionBucketData,
            previousBucketBytes,
            editableMappingTracingId(volumeLayer.tracing, tracingId)
          ) ?~> "failed to update segment index"
        } yield ()
      }
      _ = volumeBucketBuffer.put(action.bucketPosition, actionBucketData)
    } yield ()

  def editableMappingTracingId(tracing: VolumeTracing, tracingId: String): Option[String] =
    if (tracing.getHasEditableMapping) Some(tracingId) else None

  private def getMappingNameUnlessEditable(tracing: VolumeTracing): Fox[Option[String]] =
    if (tracing.getHasEditableMapping)
      Fox.failure("getMappingNameUnlessEditable called on volumeTracing with editableMapping!")
    else Fox.successful(tracing.mappingName)

  private def deleteSegmentData(tracingId: String,
                                annotationId: String,
                                volumeTracing: VolumeTracing,
                                a: DeleteSegmentDataVolumeAction,
                                segmentIndexBuffer: VolumeSegmentIndexBuffer,
                                version: Long)(implicit tc: TokenContext): Fox[VolumeTracing] =
    for {
      _ <- Fox.successful(())
      volumeLayer = volumeTracingLayer(annotationId, tracingId, volumeTracing)
      fallbackLayer <- getFallbackLayer(annotationId, volumeTracing)
      possibleAdditionalCoordinates = AdditionalAxis.coordinateSpace(volumeLayer.additionalAxes).map(Some(_))
      additionalCoordinateList = if (possibleAdditionalCoordinates.isEmpty) {
        List(None)
      } else {
        possibleAdditionalCoordinates.toList
      }
      mappingName <- getMappingNameUnlessEditable(volumeTracing)
      _ <- Fox.serialCombined(volumeTracing.mags.toList)(magProto =>
        Fox.serialCombined(additionalCoordinateList)(additionalCoordinates => {
          val mag = vec3IntFromProto(magProto)
          for {
            bucketPositionsRaw <- volumeSegmentIndexService.getSegmentToBucketIndex(
              volumeTracing,
              fallbackLayer,
              tracingId,
              a.id,
              mag,
              mappingName,
              editableMappingTracingId(volumeTracing, tracingId),
              additionalCoordinates
            )
            bucketPositions = bucketPositionsRaw.toSeq
              .map(vec3IntFromProto)
              .map(_ * mag * DataLayer.bucketLength)
              .map(bp => BucketPosition(bp.x, bp.y, bp.z, mag, additionalCoordinates))
              .toList
            _ <- Fox.serialCombined(bucketPositions) {
              bucketPosition =>
                for {
                  data <- loadBucket(volumeLayer, bucketPosition)
                  typedData = SegmentIntegerArray.fromByteArray(data, volumeTracing.elementClass)
                  filteredData = typedData.map(elem =>
                    if (elem.toLong == a.id) SegmentInteger.zeroFromElementClass(volumeTracing.elementClass) else elem)
                  filteredBytes = SegmentIntegerArray.toByteArray(filteredData, volumeTracing.elementClass)
                  _ <- saveBucket(volumeLayer, bucketPosition, filteredBytes, version)
                  _ <- updateSegmentIndex(
                    volumeLayer,
                    segmentIndexBuffer,
                    bucketPosition,
                    filteredBytes,
                    Some(data),
                    editableMappingTracingId(volumeTracing, tracingId)
                  )
                } yield ()
            }
          } yield ()
        }))
      _ <- segmentIndexBuffer.flush()
    } yield volumeTracing.copy(volumeBucketDataHasChanged = Some(true))

  private def assertMagIsValid(tracing: VolumeTracing, mag: Vec3Int): Fox[Unit] =
    if (tracing.mags.nonEmpty) {
      Fox.fromBool(tracing.mags.exists(r => vec3IntFromProto(r) == mag))
    } else { // old volume tracings do not have a mag list, no assert possible. Check compatibility by asserting isotropic mag
      Fox.fromBool(mag.isIsotropic)
    }

  def revertVolumeData(tracingId: String,
                       annotationId: String,
                       sourceVersion: Long,
                       sourceTracing: VolumeTracing,
                       newVersion: Long,
                       tracingBeforeRevert: VolumeTracing)(implicit tc: TokenContext): Fox[Unit] = {
    val before = Instant.now

    val volumeLayer = volumeTracingLayer(annotationId, tracingId, tracingBeforeRevert)
    val bucketStreamBeforeRevert =
      volumeLayer.volumeBucketProvider.bucketStreamWithVersion(version = Some(tracingBeforeRevert.version))

    for {
      fallbackLayer <- getFallbackLayer(annotationId, tracingBeforeRevert)
      mappingName <- getMappingNameUnlessEditable(sourceTracing)
      segmentIndexBuffer = new VolumeSegmentIndexBuffer(
        tracingId,
        volumeLayer.elementClass,
        mappingName,
        volumeSegmentIndexClient,
        newVersion,
        remoteDatastoreClient,
        fallbackLayer,
        volumeLayer.additionalAxes,
        temporaryTracingService,
        tc
      )
      _ <- Fox.serialCombined(bucketStreamBeforeRevert) {
        case (bucketPosition, dataBeforeRevert, version) =>
          if (version > sourceVersion) {
            loadBucket(volumeLayer, bucketPosition, Some(sourceVersion)).shiftBox.map {
              case Full(dataAfterRevert) =>
                for {
                  _ <- saveBucket(volumeLayer, bucketPosition, dataAfterRevert, newVersion)
                  _ <- Fox.runIfOptionTrue(tracingBeforeRevert.hasSegmentIndex)(
                    updateSegmentIndex(
                      volumeLayer,
                      segmentIndexBuffer,
                      bucketPosition,
                      dataAfterRevert,
                      Full(dataBeforeRevert),
                      editableMappingTracingId(sourceTracing, tracingId)
                    ))
                } yield ()
              case Empty =>
                for {
                  dataAfterRevert <- Fox.successful(revertedValue)
                  _ <- saveBucket(volumeLayer, bucketPosition, dataAfterRevert, newVersion)
                  _ <- Fox.runIfOptionTrue(tracingBeforeRevert.hasSegmentIndex)(
                    updateSegmentIndex(
                      volumeLayer,
                      segmentIndexBuffer,
                      bucketPosition,
                      dataAfterRevert,
                      Full(dataBeforeRevert),
                      editableMappingTracingId(sourceTracing, tracingId)
                    ))
                } yield ()
              case Failure(msg, _, chain) => Fox.failure(msg, Empty, chain)
            }
          } else Fox.successful(())
      }
      _ <- segmentIndexBuffer.flush()
      _ = Instant.logSince(
        before,
        s"Reverting volume data of $tracingId from v${tracingBeforeRevert.version} to v$sourceVersion, creating v$newVersion")
    } yield ()
  }

  def initializeWithDataMultiple(annotationId: String, tracingId: String, tracing: VolumeTracing, initialData: File)(
      implicit mp: MessagesProvider,
      tc: TokenContext): Fox[Set[Vec3Int]] =
    if (tracing.version != 0L)
      Fox.failure("Tracing has already been edited.")
    else {
      val magSets = new mutable.HashSet[Set[Vec3Int]]()
      for {
        _ <- withZipsFromMultiZipAsync(initialData) { (_, dataZip) =>
          for {
            _ <- Fox.successful(())
            magSet = magSetFromZipfile(dataZip)
            _ = if (magSet.nonEmpty) magSets.add(magSet)
          } yield ()
        }
        mappingName <- getMappingNameUnlessEditable(tracing)
        mags <-
        // if none of the tracings contained any volume data do not save buckets, use full mag list, as already initialized on wk-side
        if (magSets.isEmpty)
          Fox.successful(tracing.mags.map(vec3IntFromProto).toSet)
        else {
          val magsDoMatch = magSets.headOption.forall { head =>
            magSets.forall(_ == head)
          }
          if (!magsDoMatch)
            Fox.failure("annotation.volume.magsDoNotMatch")
          else {
            val mergedVolume = new MergedVolume(tracing.elementClass)
            for {
              _ <- withZipsFromMultiZipAsync(initialData)((_, dataZip) => mergedVolume.addLabelSetFromDataZip(dataZip))
              _ <- withZipsFromMultiZipAsync(initialData)((index, dataZip) =>
                mergedVolume.addFromDataZip(index, dataZip))
              _ <- Fox.fromBool(
                ElementClass
                  .largestSegmentIdIsInRange(mergedVolume.largestSegmentId.toLong, tracing.elementClass)) ?~> Messages(
                "annotation.volume.largestSegmentIdExceedsRange",
                mergedVolume.largestSegmentId.toLong,
                tracing.elementClass)
              destinationVolumeLayer = volumeTracingLayer(annotationId, tracingId, tracing)
              fallbackLayer <- getFallbackLayer(annotationId, tracing)
              segmentIndexBuffer = new VolumeSegmentIndexBuffer(
                tracingId,
                tracing.elementClass,
                mappingName,
                volumeSegmentIndexClient,
                tracing.version,
                remoteDatastoreClient,
                fallbackLayer,
                AdditionalAxis.fromProtosAsOpt(tracing.additionalAxes),
                temporaryTracingService,
                tc
              )
              _ <- mergedVolume.withMergedBuckets { (bucketPosition, bytes) =>
                for {
                  _ <- saveBucket(destinationVolumeLayer, bucketPosition, bytes, tracing.version)
                  _ <- Fox.runIfOptionTrue(tracing.hasSegmentIndex)(
                    updateSegmentIndex(destinationVolumeLayer,
                                       segmentIndexBuffer,
                                       bucketPosition,
                                       bytes,
                                       Empty,
                                       editableMappingTracingId(tracing, tracingId)))
                } yield ()
              }
              _ <- segmentIndexBuffer.flush()
            } yield mergedVolume.presentMags
          }
        }
      } yield mags
    }

  def initializeWithData(annotationId: String,
                         tracingId: String,
                         tracing: VolumeTracing,
                         initialData: File,
                         magRestrictions: MagRestrictions)(implicit tc: TokenContext): Fox[Set[Vec3Int]] =
    if (tracing.version != 0L) {
      Fox.failure("Tracing has already been edited.")
    } else {
      val volumeLayer = volumeTracingLayer(annotationId, tracingId, tracing)
      val savedMags = new mutable.HashSet[Vec3Int]()
      for {
        fallbackLayer <- getFallbackLayer(annotationId, tracing)
        mappingName <- getMappingNameUnlessEditable(tracing)
        segmentIndexBuffer = new VolumeSegmentIndexBuffer(
          tracingId,
          tracing.elementClass,
          mappingName,
          volumeSegmentIndexClient,
          tracing.version,
          remoteDatastoreClient,
          fallbackLayer,
          AdditionalAxis.fromProtosAsOpt(tracing.additionalAxes),
          temporaryTracingService,
          tc
        )
        _ <- withBucketsFromZip(initialData) { (bucketPosition, bytes) =>
          if (magRestrictions.isForbidden(bucketPosition.mag)) {
            Fox.successful(())
          } else {
            savedMags.add(bucketPosition.mag)
            for {
              _ <- saveBucket(volumeLayer, bucketPosition, bytes, tracing.version)
              _ <- Fox.runIfOptionTrue(tracing.hasSegmentIndex)(
                updateSegmentIndex(volumeLayer,
                                   segmentIndexBuffer,
                                   bucketPosition,
                                   bytes,
                                   Empty,
                                   editableMappingTracingId(tracing, tracingId)))
            } yield ()
          }
        } ?~> "failed to import volume data from zipfile"
        _ <- segmentIndexBuffer.flush()
      } yield {
        if (savedMags.isEmpty) {
          magSetFromZipfile(initialData)
        } else {
          savedMags.toSet
        }
      }
    }

  def allDataZip(annotationId: String,
                 tracingId: String,
                 tracing: VolumeTracing,
                 volumeDataZipFormat: VolumeDataZipFormat,
                 voxelSize: Option[VoxelSize])(implicit ec: ExecutionContext, tc: TokenContext): Fox[Path] = {
    val zipped = tempFileService.create(tracingId)
    val os = new BufferedOutputStream(new FileOutputStream(new File(zipped.toString)))
    allDataToOutputStream(annotationId, tracingId, tracing, volumeDataZipFormat, voxelSize, os).map(_ => zipped)
  }

  private def allDataToOutputStream(annotationId: String,
                                    tracingId: String,
                                    tracing: VolumeTracing,
                                    volumeDataZipFormmat: VolumeDataZipFormat,
                                    voxelSize: Option[VoxelSize],
                                    os: OutputStream)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Unit] = {
    val volumeLayer = volumeTracingLayer(annotationId, tracingId, tracing)
    val buckets: Iterator[NamedStream] = volumeDataZipFormmat match {
      case VolumeDataZipFormat.wkw =>
        new WKWBucketStreamSink(volumeLayer, tracing.fallbackLayer.nonEmpty)(
          volumeLayer.bucketProvider.bucketStream(Some(tracing.version)),
          tracing.mags.map(mag => vec3IntFromProto(mag)))
      case VolumeDataZipFormat.zarr3 =>
        new Zarr3BucketStreamSink(volumeLayer, tracing.fallbackLayer.nonEmpty)(
          volumeLayer.bucketProvider.bucketStream(Some(tracing.version)),
          tracing.mags.map(mag => vec3IntFromProto(mag)),
          voxelSize)
    }

    val before = Instant.now
    val zipResult = ZipIO.zip(buckets, os, level = Deflater.BEST_SPEED)

    zipResult.onComplete { resultBox =>
      logger.info(
        s"Zipping volume data for $tracingId took ${formatDuration(Instant.since(before))}. Result: $resultBox")
    }

    zipResult
  }

  def data(annotationId: String,
           tracingId: String,
           tracing: VolumeTracing,
           dataRequests: DataRequestCollection,
           includeFallbackDataIfAvailable: Boolean = false)(implicit tc: TokenContext): Fox[(Array[Byte], List[Int])] =
    for {
      isTemporaryTracing <- temporaryTracingService.isTemporaryTracing(tracingId)
      volumeLayer = volumeTracingLayer(annotationId,
                                       tracingId,
                                       tracing,
                                       isTemporaryTracing,
                                       includeFallbackDataIfAvailable)
      requests = dataRequests.map(r =>
        DataServiceDataRequest(None, volumeLayer, r.cuboid(volumeLayer), r.settings.copy(appliedAgglomerate = None)))
      data <- binaryDataService.handleDataRequests(requests)
    } yield data

  def dataBucketBoxes(
      annotationId: String,
      tracingId: String,
      tracing: VolumeTracing,
      dataRequests: DataRequestCollection,
      includeFallbackDataIfAvailable: Boolean = false)(implicit tc: TokenContext): Fox[Seq[Box[Array[Byte]]]] =
    for {
      isTemporaryTracing <- temporaryTracingService.isTemporaryTracing(tracingId)
      volumeLayer = volumeTracingLayer(annotationId,
                                       tracingId,
                                       tracing,
                                       isTemporaryTracing,
                                       includeFallbackDataIfAvailable)
      requests = dataRequests.map(r =>
        DataServiceDataRequest(None, volumeLayer, r.cuboid(volumeLayer), r.settings.copy(appliedAgglomerate = None)))
      data <- binaryDataService.handleMultipleBucketRequests(requests)
    } yield data

  def adaptVolumeForDuplicate(
      sourceAnnotationId: String,
      newTracingId: String,
      sourceTracing: VolumeTracing,
      isFromTask: Boolean,
      boundingBox: Option[BoundingBox],
      datasetBoundingBox: Option[BoundingBox],
      magRestrictions: MagRestrictions,
      editPosition: Option[Vec3Int],
      editRotation: Option[Vec3Double],
      newVersion: Long,
      ownerId: Option[String],
      requestingUserId: Option[String])(implicit ec: ExecutionContext, tc: TokenContext): Fox[VolumeTracing] = {
    val tracingWithBB = addBoundingBoxFromTaskIfRequired(sourceTracing, isFromTask, datasetBoundingBox)
    val tracingWithMagRestrictions = VolumeTracingMags.restrictMagList(tracingWithBB, magRestrictions)
    for {
      fallbackLayer <- getFallbackLayer(sourceAnnotationId, tracingWithMagRestrictions)
      hasSegmentIndex <- VolumeSegmentIndexService.canHaveSegmentIndex(remoteDatastoreClient, fallbackLayer)
      userStates = Seq(
        renderUserStateForVolumeTracingIntoUserState(tracingWithMagRestrictions,
                                                     ownerId.getOrElse(""), // TODO get rid of getOrElse("")
                                                     requestingUserId.getOrElse("")))
      newTracing = tracingWithMagRestrictions.copy(
        createdTimestamp = System.currentTimeMillis(),
        editPosition = editPosition.map(vec3IntToProto).getOrElse(tracingWithMagRestrictions.editPosition),
        editRotation = editRotation.map(vec3DoubleToProto).getOrElse(tracingWithMagRestrictions.editRotation),
        boundingBox = boundingBoxOptToProto(boundingBox).getOrElse(tracingWithMagRestrictions.boundingBox),
        mappingName =
          if (tracingWithMagRestrictions.getHasEditableMapping) Some(newTracingId)
          else tracingWithMagRestrictions.mappingName,
        version = newVersion,
        // Adding segment index on duplication if the volume tracing allows it. This will be used in duplicateData
        hasSegmentIndex = Some(hasSegmentIndex),
        userStates = userStates
      )
      _ <- Fox.fromBool(newTracing.mags.nonEmpty) ?~> "magRestrictions.tooTight"
    } yield newTracing
  }

  // Since the owner may change in duplicate, we need to render what they would see into a single user state for them
  def renderUserStateForVolumeTracingIntoUserState(s: VolumeTracing,
                                                   requestingUserId: String,
                                                   ownerId: String): VolumeUserStateProto = {
    val ownerUserState = s.userStates.find(_.userId == ownerId).map(_.copy(userId = requestingUserId))

    if (requestingUserId == ownerId)
      ownerUserState.getOrElse(VolumeTracingDefaults.emptyUserState(requestingUserId))
    else {
      val requestingUserState = s.userStates.find(_.userId == requestingUserId)
      val requestingUserSegmentVisibilityMap: Map[Long, Boolean] = requestingUserState
        .map(userState => userState.segmentIds.zip(userState.segmentVisibilities).toMap)
        .getOrElse(Map.empty[Long, Boolean])
      val ownerSegmentVisibilityMap: Map[Long, Boolean] =
        ownerUserState
          .map(userState => userState.segmentIds.zip(userState.segmentVisibilities).toMap)
          .getOrElse(Map.empty[Long, Boolean])
      val mergedSegmentVisibilityMap = (requestingUserSegmentVisibilityMap ++ ownerSegmentVisibilityMap).toSeq
      val requestingUserBoundingBoxVisibilityMap: Map[Int, Boolean] = requestingUserState
        .map(userState => userState.boundingBoxIds.zip(userState.boundingBoxVisibilities).toMap)
        .getOrElse(Map.empty[Int, Boolean])
      val ownerBoundingBoxVisibilityMap: Map[Int, Boolean] = ownerUserState
        .map(userState => userState.boundingBoxIds.zip(userState.boundingBoxVisibilities).toMap)
        .getOrElse(Map.empty[Int, Boolean])
      val mergedBoundingBoxVisibilityMap =
        (requestingUserBoundingBoxVisibilityMap ++ ownerBoundingBoxVisibilityMap).toSeq
      val requestingUserSegmentGroupExpandedMap: Map[Int, Boolean] = requestingUserState
        .map(userState => userState.segmentGroupIds.zip(userState.segmentGroupExpandedStates).toMap)
        .getOrElse(Map.empty[Int, Boolean])
      val ownerSegmentGroupExpandedMap: Map[Int, Boolean] = ownerUserState
        .map(userState => userState.segmentGroupIds.zip(userState.segmentGroupExpandedStates).toMap)
        .getOrElse(Map.empty[Int, Boolean])
      val mergedSegmentGroupExpandedMap = (requestingUserSegmentGroupExpandedMap ++ ownerSegmentGroupExpandedMap).toSeq
      VolumeUserStateProto(
        userId = requestingUserId,
        activeSegmentId =
          requestingUserState.flatMap(_.activeSegmentId).orElse(ownerUserState.flatMap(_.activeSegmentId)),
        segmentGroupIds = mergedSegmentGroupExpandedMap.map(_._1),
        segmentGroupExpandedStates = mergedSegmentGroupExpandedMap.map(_._2),
        boundingBoxIds = mergedBoundingBoxVisibilityMap.map(_._1),
        boundingBoxVisibilities = mergedBoundingBoxVisibilityMap.map(_._2),
        segmentIds = mergedSegmentVisibilityMap.map(_._1),
        segmentVisibilities = mergedSegmentVisibilityMap.map(_._2)
      )
    }
  }

  private def addBoundingBoxFromTaskIfRequired(tracing: VolumeTracing,
                                               isFromTask: Boolean,
                                               datasetBoundingBoxOpt: Option[BoundingBox]): VolumeTracing =
    datasetBoundingBoxOpt match {
      case Some(datasetBoundingBox) if isFromTask =>
        val newId = if (tracing.userBoundingBoxes.isEmpty) 1 else tracing.userBoundingBoxes.map(_.id).max + 1
        tracing
          .addUserBoundingBoxes(
            NamedBoundingBoxProto(newId,
                                  Some("task bounding box"),
                                  Some(true),
                                  Some(getRandomColor),
                                  tracing.boundingBox))
          .withBoundingBox(datasetBoundingBox)
      case _ => tracing
    }

  def duplicateVolumeData(sourceAnnotationId: String,
                          sourceTracingId: String,
                          sourceTracing: VolumeTracing,
                          newAnnotationId: String,
                          newTracingId: String,
                          newTracing: VolumeTracing)(implicit tc: TokenContext): Fox[Unit] = {
    var bucketCount = 0
    val before = Instant.now
    for {
      isTemporaryTracing <- temporaryTracingService.isTemporaryTracing(sourceTracingId)
      sourceVolumeLayer = volumeTracingLayer(sourceAnnotationId, sourceTracingId, sourceTracing, isTemporaryTracing)
      buckets: Iterator[(BucketPosition, Array[Byte])] = sourceVolumeLayer.bucketProvider.bucketStream(
        Some(sourceTracing.version))
      destinationVolumeLayer = volumeTracingLayer(newAnnotationId, newTracingId, newTracing)
      fallbackLayer <- getFallbackLayer(sourceAnnotationId, sourceTracing)
      mappingName <- getMappingNameUnlessEditable(sourceTracing)
      segmentIndexBuffer = new VolumeSegmentIndexBuffer(
        newTracingId,
        sourceTracing.elementClass,
        mappingName,
        volumeSegmentIndexClient,
        newTracing.version,
        remoteDatastoreClient,
        fallbackLayer,
        AdditionalAxis.fromProtosAsOpt(sourceTracing.additionalAxes),
        temporaryTracingService,
        tc
      )
      bucketPutBuffer = new FossilDBPutBuffer(volumeDataStore)
      _ <- Fox.serialCombined(buckets) {
        case (bucketPosition, bucketData) =>
          if (newTracing.mags.contains(vec3IntToProto(bucketPosition.mag))) {
            for {
              _ <- saveBucket(destinationVolumeLayer,
                              bucketPosition,
                              bucketData,
                              newTracing.version,
                              toTemporaryStore = false,
                              Some(bucketPutBuffer))
              _ = bucketCount += 1
              _ <- Fox.runIfOptionTrue(newTracing.hasSegmentIndex)(
                updateSegmentIndex(
                  sourceVolumeLayer,
                  segmentIndexBuffer,
                  bucketPosition,
                  bucketData,
                  Empty,
                  editableMappingTracingId(sourceTracing, sourceTracingId)
                ))
            } yield ()
          } else Fox.successful(())
      }
      _ <- bucketPutBuffer.flush()
      _ = Instant.logSince(
        before,
        s"Duplicating $bucketCount volume buckets from $sourceTracingId v${sourceTracing.version} to $newTracingId v${newTracing.version}.")
      _ <- segmentIndexBuffer.flush()
    } yield ()
  }

  private def volumeTracingLayer(
      annotationId: String,
      tracingId: String,
      tracing: VolumeTracing,
      isTemporaryTracing: Boolean = false,
      includeFallbackDataIfAvailable: Boolean = false)(implicit tc: TokenContext): VolumeTracingLayer =
    VolumeTracingLayer(
      name = tracingId,
      annotationId = annotationId,
      isTemporaryTracing = isTemporaryTracing,
      volumeTracingService = this,
      temporaryTracingService = this.temporaryTracingService,
      volumeDataStore = volumeDataStore,
      includeFallbackDataIfAvailable = includeFallbackDataIfAvailable,
      tracing = tracing,
      tokenContext = tc,
      additionalAxes = AdditionalAxis.fromProtosAsOpt(tracing.additionalAxes)
    )

  def updateMagList(tracingId: String, tracing: VolumeTracing, mags: Set[Vec3Int]): Fox[Unit] =
    for {
      _ <- Fox.fromBool(tracing.version == 0L) ?~> "Tracing has already been edited."
      _ <- Fox.fromBool(mags.nonEmpty) ?~> "Initializing without any mags. No data or mag restrictions too tight?"
      _ <- saveVolume(tracingId, tracing.version, tracing.copy(mags = mags.toList.sortBy(_.maxDim).map(vec3IntToProto)))
    } yield ()

  def volumeBucketsAreEmpty(tracingId: String): Boolean =
    volumeDataStore.getMultipleKeys(None, Some(tracingId), limit = Some(1))(toBox).isEmpty

  def createAdHocMesh(annotationId: String,
                      tracingId: String,
                      tracing: VolumeTracing,
                      request: WebknossosAdHocMeshRequest)(implicit tc: TokenContext): Fox[(Array[Float], List[Int])] =
    for {
      isTemporaryTracing <- temporaryTracingService.isTemporaryTracing(tracingId)
      volumeLayer = volumeTracingLayer(annotationId,
                                       tracingId,
                                       tracing,
                                       includeFallbackDataIfAvailable = true,
                                       isTemporaryTracing = isTemporaryTracing)
      adHocMeshRequest = AdHocMeshRequest(
        None,
        volumeLayer,
        request.cuboid(volumeLayer),
        request.segmentId,
        request.voxelSizeFactorInUnit,
        tc,
        None,
        None,
        request.additionalCoordinates,
        request.findNeighbors
      )
      result <- adHocMeshService.requestAdHocMeshViaActor(adHocMeshRequest)
    } yield result

  def findData(annotationId: String, tracingId: String, tracing: VolumeTracing)(
      implicit tc: TokenContext): Fox[Option[Vec3Int]] =
    for {
      _ <- Fox.successful(())
      isTemporaryTracing <- temporaryTracingService.isTemporaryTracing(tracingId)
      volumeLayer = volumeTracingLayer(annotationId, tracingId, tracing, isTemporaryTracing = isTemporaryTracing)
      bucketStream = volumeLayer.bucketStream
      bucketPosOpt = if (bucketStream.hasNext) {
        val bucket = bucketStream.next()
        val bucketPos = bucket._1
        getPositionOfNonZeroData(bucket._2,
                                 Vec3Int(bucketPos.voxelMag1X, bucketPos.voxelMag1Y, bucketPos.voxelMag1Z),
                                 volumeLayer.bytesPerElement)
      } else None
    } yield bucketPosOpt

  def merge(tracings: Seq[VolumeTracing],
            mergedVolumeStats: MergedVolumeStats,
            newEditableMappingIdOpt: Option[String],
            newVersion: Long): Box[VolumeTracing] = {
    def mergeTwoWithStats(tracingAWithIndex: Box[(VolumeTracing, Int)],
                          tracingBWithIndex: Box[(VolumeTracing, Int)]): Box[(VolumeTracing, Int)] =
      for {
        tracingAWithIndex <- tracingAWithIndex
        tracingBWithIndex <- tracingBWithIndex
        merged <- mergeTwo(tracingAWithIndex._1, tracingBWithIndex._1, tracingBWithIndex._2, mergedVolumeStats)
      } yield (merged, tracingAWithIndex._2)

    for {
      tracingsWithIndex <- Full(tracings.zipWithIndex.map(Full(_)))
      tracingAndIndex <- tracingsWithIndex.reduceLeft(mergeTwoWithStats)
      tracing <- tracingAndIndex._1
    } yield
      tracing.copy(
        createdTimestamp = System.currentTimeMillis(),
        version = newVersion,
        mappingName = newEditableMappingIdOpt,
        hasSegmentIndex = Some(mergedVolumeStats.createdSegmentIndex)
      )
  }

  private def mergeTwo(tracingA: VolumeTracing,
                       tracingB: VolumeTracing,
                       indexB: Int, // Index of tracingB in the labelMaps of the mergedVolumeStats.
                       // TODO test with proofreading, what happens to segment ids? also, volume annotations did not apply
                       mergedVolumeStats: MergedVolumeStats): Box[VolumeTracing] = {
    val largestSegmentId = combineLargestSegmentIdsByMaxDefined(tracingA.largestSegmentId, tracingB.largestSegmentId)
    val groupMappingA = GroupUtils.calculateSegmentGroupMapping(tracingA.segmentGroups, tracingB.segmentGroups)
    val mergedGroups = GroupUtils.mergeSegmentGroups(tracingA.segmentGroups, tracingB.segmentGroups, groupMappingA)
    val mergedBoundingBox = combineBoundingBoxes(Some(tracingA.boundingBox), Some(tracingB.boundingBox))
    val segmentIdMapB =
      if (indexB >= mergedVolumeStats.labelMaps.length) Map.empty[Long, Long] else mergedVolumeStats.labelMaps(indexB)
    val (mergedUserBoundingBoxes, bboxIdMapA, bboxIdMapB) = combineUserBoundingBoxes(tracingA.userBoundingBox,
                                                                                     tracingB.userBoundingBox,
                                                                                     tracingA.userBoundingBoxes,
                                                                                     tracingB.userBoundingBoxes)
    val userStates =
      mergeUserStates(tracingA.userStates, tracingB.userStates, groupMappingA, segmentIdMapB, bboxIdMapA, bboxIdMapB)
    for {
      mergedAdditionalAxes <- AdditionalAxis.mergeAndAssertSameAdditionalAxes(
        Seq(tracingA, tracingB).map(t => AdditionalAxis.fromProtosAsOpt(t.additionalAxes)))
      tracingBSegments = if (segmentIdMapB.isEmpty) tracingB.segments
      else {
        tracingB.segments.map { segment =>
          segment.copy(
            segmentId = segmentIdMapB.getOrElse(segment.segmentId, segment.segmentId)
          )
        }
      }
    } yield
      tracingA.copy(
        largestSegmentId = largestSegmentId,
        boundingBox = mergedBoundingBox.getOrElse(
          com.scalableminds.webknossos.datastore.geometry.BoundingBoxProto(
            com.scalableminds.webknossos.datastore.geometry.Vec3IntProto(0, 0, 0),
            0,
            0,
            0)), // should never be empty for volumes
        userBoundingBoxes = mergedUserBoundingBoxes,
        segments = (tracingA.segments ++ tracingBSegments).distinctBy(_.segmentId),
        segmentGroups = mergedGroups,
        additionalAxes = AdditionalAxis.toProto(mergedAdditionalAxes),
        userStates = userStates
      )
  }

  private def mergeUserStates(tracingAUserStates: Seq[VolumeUserStateProto],
                              tracingBUserStates: Seq[VolumeUserStateProto],
                              groupMapping: FunctionalGroupMapping,
                              segmentIdMapB: Map[Long, Long],
                              bboxIdMapA: UserBboxIdMap,
                              bboxIdMapB: UserBboxIdMap): Seq[VolumeUserStateProto] = {
    val tracingAUserStatesMapped =
      tracingAUserStates.map(appylIdMappingsOnUserState(_, groupMapping, bboxIdMapA))
    val tracingBUserStatesMapped =
      tracingBUserStates
        .map(userState => userState.copy(segmentIds = userState.segmentIds.map(segmentIdMapB))) // TODO what if segments are not in id mappings?
        .map(applyBboxIdMapOnUserState(_, bboxIdMapB))

    val byUserId = scala.collection.mutable.Map[String, VolumeUserStateProto]()
    tracingAUserStatesMapped.foreach { userState =>
      byUserId.put(userState.userId, userState)
    }
    tracingBUserStatesMapped.foreach { userState =>
      byUserId.get(userState.userId) match {
        case Some(existingUserState) => byUserId.put(userState.userId, mergeTwoUserStates(existingUserState, userState))
        case None                    => byUserId.put(userState.userId, userState)
      }
    }

    byUserId.values.toSeq
  }

  private def mergeTwoUserStates(tracingAUserState: VolumeUserStateProto,
                                 tracingBUserState: VolumeUserStateProto): VolumeUserStateProto =
    VolumeUserStateProto(
      userId = tracingAUserState.userId,
      activeSegmentId = tracingAUserState.activeSegmentId,
      segmentGroupIds = tracingAUserState.segmentGroupIds ++ tracingBUserState.segmentGroupIds,
      segmentGroupExpandedStates = tracingAUserState.segmentGroupExpandedStates ++ tracingBUserState.segmentGroupExpandedStates,
      boundingBoxIds = tracingAUserState.boundingBoxIds ++ tracingBUserState.boundingBoxIds,
      boundingBoxVisibilities = tracingAUserState.boundingBoxVisibilities ++ tracingBUserState.boundingBoxVisibilities,
      segmentIds = tracingAUserState.segmentIds ++ tracingBUserState.segmentIds,
      segmentVisibilities = tracingAUserState.segmentVisibilities ++ tracingBUserState.segmentVisibilities
    )

  private def appylIdMappingsOnUserState(userState: VolumeUserStateProto,
                                         groupMapping: FunctionalGroupMapping,
                                         bboxIdMapA: Map[Int, Int]): VolumeUserStateProto =
    applyBboxIdMapOnUserState(userState, bboxIdMapA).copy(
      segmentGroupIds = userState.segmentGroupIds.map(groupMapping)
    )

  private def applyBboxIdMapOnUserState(userState: VolumeUserStateProto,
                                        bboxIdMap: Map[Int, Int]): VolumeUserStateProto = {
    val newIdsAndVisibilities = userState.boundingBoxIds.zip(userState.boundingBoxVisibilities).flatMap {
      case (boundingBoxId, boundingBoxVisibility) =>
        bboxIdMap.get(boundingBoxId) match {
          case Some(newId) => Some((newId, boundingBoxVisibility))
          case None        => None
        }
    }
    userState.copy(
      boundingBoxIds = newIdsAndVisibilities.map(_._1),
      boundingBoxVisibilities = newIdsAndVisibilities.map(_._2)
    )
  }

  private def combineLargestSegmentIdsByMaxDefined(aOpt: Option[Long], bOpt: Option[Long]): Option[Long] =
    (aOpt, bOpt) match {
      case (Some(a), Some(b)) => Some(Math.max(a, b))
      case (Some(a), None)    => Some(a)
      case (None, Some(b))    => Some(b)
      case (None, None)       => None
    }

  def mergeVolumeData(
      firstVolumeAnnotationIdOpt: Option[String],
      volumeTracingIds: Seq[String],
      volumeTracings: Seq[VolumeTracing],
      newVolumeTracingId: String,
      newVersion: Long,
      toTemporaryStore: Boolean)(implicit mp: MessagesProvider, tc: TokenContext): Fox[MergedVolumeStats] = {
    val before = Instant.now
    val volumeLayers = volumeTracingIds.zip(volumeTracings).map {
      case (tracingId, tracing) => volumeTracingLayer("annotationIdUnusedInThisContext", tracingId, tracing)
    }
    val elementClassProto =
      volumeLayers.headOption.map(_.tracing.elementClass).getOrElse(ElementClassProto.uint8)

    val magSets = new mutable.HashSet[Set[Vec3Int]]()
    volumeLayers.foreach { volumeLayer =>
      val magSet = new mutable.HashSet[Vec3Int]()
      volumeLayer.bucketStream.foreach {
        case (bucketPosition, _) =>
          magSet.add(bucketPosition.mag)
      }
      if (magSet.nonEmpty) { // empty tracings should have no impact in this check
        magSets.add(magSet.toSet)
      }
    }

    val shouldCreateSegmentIndex =
      volumeSegmentIndexService.shouldCreateSegmentIndexForMerged(volumeLayers.map(_.tracing))

    // If none of the tracings contained any volume data. Do not save buckets, do not touch mag list
    if (magSets.isEmpty)
      Fox.successful(MergedVolumeStats.empty(shouldCreateSegmentIndex))
    else {
      val magsIntersection: Set[Vec3Int] = magSets.headOption.map { head =>
        magSets.foldLeft(head) { (acc, element) =>
          acc.intersect(element)
        }
      }.getOrElse(Set.empty)

      val mergedVolume = new MergedVolume(elementClassProto)

      volumeLayers.foreach { volumeLayer =>
        mergedVolume.addLabelSetFromBucketStream(volumeLayer.bucketStream, magsIntersection)
      }

      volumeLayers.zipWithIndex.foreach {
        case (volumeLayer, sourceVolumeIndex) =>
          mergedVolume.addFromBucketStream(sourceVolumeIndex, volumeLayer.bucketStream, Some(magsIntersection))
      }
      for {
        _ <- Fox.fromBool(
          ElementClass.largestSegmentIdIsInRange(mergedVolume.largestSegmentId.toLong, elementClassProto)) ?~> Messages(
          "annotation.volume.largestSegmentIdExceedsRange",
          mergedVolume.largestSegmentId.toLong,
          elementClassProto)
        mergedAdditionalAxes <- AdditionalAxis
          .mergeAndAssertSameAdditionalAxes(
            volumeLayers.map(l => AdditionalAxis.fromProtosAsOpt(l.tracing.additionalAxes)))
          .toFox
        firstVolumeLayer <- volumeLayers.headOption.toFox ?~> "merge.noTracings"
        firstVolumeAnnotationId <- firstVolumeAnnotationIdOpt.toFox
        fallbackLayer <- getFallbackLayer(firstVolumeAnnotationId, firstVolumeLayer.tracing)
        segmentIndexBuffer = new VolumeSegmentIndexBuffer(
          newVolumeTracingId,
          elementClassProto,
          volumeLayers.headOption.flatMap(_.tracing.mappingName),
          volumeSegmentIndexClient,
          newVersion,
          remoteDatastoreClient,
          fallbackLayer,
          mergedAdditionalAxes,
          temporaryTracingService,
          tc,
          toTemporaryStore
        )
        volumeBucketPutBuffer = new FossilDBPutBuffer(volumeDataStore, Some(newVersion))
        _ <- mergedVolume.withMergedBuckets { (bucketPosition, bucketBytes) =>
          for {
            _ <- saveBucket(
              newVolumeTracingId,
              firstVolumeLayer.expectedUncompressedBucketSize,
              bucketPosition,
              bucketBytes,
              newVersion,
              toTemporaryStore,
              mergedAdditionalAxes,
              Some(volumeBucketPutBuffer)
            )
            _ <- Fox.runIf(shouldCreateSegmentIndex)(
              updateSegmentIndex(firstVolumeLayer, segmentIndexBuffer, bucketPosition, bucketBytes, Empty, None))
          } yield ()
        }
        _ <- volumeBucketPutBuffer.flush()
        _ <- segmentIndexBuffer.flush()
        _ = Instant.logSince(
          before,
          s"Merging buckets from ${volumeLayers.length} volume tracings into new $newVolumeTracingId, with createSegmentIndex = $shouldCreateSegmentIndex"
        )
      } yield mergedVolume.stats(shouldCreateSegmentIndex)
    }
  }

  def importVolumeData(annotationId: String,
                       tracingId: String,
                       tracing: VolumeTracing,
                       zipFile: File,
                       currentVersion: Int)(implicit mp: MessagesProvider, tc: TokenContext): Fox[Long] =
    if (currentVersion != tracing.version)
      Fox.failure("version.mismatch")
    else {
      val magSet = magSetFromZipfile(zipFile)
      val magsDoMatch =
        magSet.isEmpty || magSet == VolumeTracingMags.resolveLegacyMagList(tracing.mags).map(vec3IntFromProto).toSet

      if (!magsDoMatch)
        Fox.failure("annotation.volume.magssDoNotMatch")
      else {
        val volumeLayer = volumeTracingLayer(annotationId, tracingId, tracing)
        for {
          largestSegmentId <- tracing.largestSegmentId.toFox ?~> "annotation.volume.merge.largestSegmentId.unset"
          mergedVolume = new MergedVolume(tracing.elementClass, largestSegmentId)
          _ <- mergedVolume.addLabelSetFromDataZip(zipFile)
          _ = mergedVolume.addFromBucketStream(sourceVolumeIndex = 0, volumeLayer.bucketProvider.bucketStream())
          _ <- mergedVolume.addFromDataZip(sourceVolumeIndex = 1, zipFile)
          _ <- Fox.fromBool(
            ElementClass
              .largestSegmentIdIsInRange(mergedVolume.largestSegmentId.toLong, tracing.elementClass)) ?~> Messages(
            "annotation.volume.largestSegmentIdExceedsRange",
            mergedVolume.largestSegmentId.toLong,
            tracing.elementClass)
          fallbackLayer <- getFallbackLayer(annotationId, tracing)
          mappingName <- getMappingNameUnlessEditable(tracing)
          segmentIndexBuffer <- Fox.successful(
            new VolumeSegmentIndexBuffer(
              tracingId,
              tracing.elementClass,
              mappingName,
              volumeSegmentIndexClient,
              tracing.version + 1,
              remoteDatastoreClient,
              fallbackLayer,
              volumeLayer.additionalAxes,
              temporaryTracingService,
              tc
            ))
          _ <- mergedVolume.withMergedBuckets { (bucketPosition, bucketBytes) =>
            for {
              _ <- saveBucket(volumeLayer, bucketPosition, bucketBytes, tracing.version + 1)
              _ <- Fox.runIfOptionTrue(tracing.hasSegmentIndex) {
                for {
                  previousBucketBytesBox <- loadBucket(volumeLayer, bucketPosition, Some(tracing.version)).shiftBox
                  _ <- updateSegmentIndex(
                    volumeLayer,
                    segmentIndexBuffer,
                    bucketPosition,
                    bucketBytes,
                    previousBucketBytesBox,
                    editableMappingTracingId(tracing, tracingId)
                  ) ?~> "failed to update segment index"
                } yield ()
              }
            } yield ()
          }
          _ <- segmentIndexBuffer.flush()
        } yield mergedVolume.largestSegmentId.toLong
      }
    }

  def getFallbackLayer(annotationId: String, tracing: VolumeTracing)(
      implicit tc: TokenContext): Fox[Option[RemoteFallbackLayer]] =
    fallbackLayerCache.getOrLoad((annotationId, tracing.fallbackLayer, tc.userTokenOpt),
                                 t => getFallbackLayerFromWebknossos(t._1, t._2))

  private def getFallbackLayerFromWebknossos(annotationId: String, fallbackLayerName: Option[String])(
      implicit tc: TokenContext): Fox[Option[RemoteFallbackLayer]] =
    for {
      dataSource <- remoteWebknossosClient.getDataSourceForAnnotation(annotationId)
      dataSourceId = dataSource.id
      layerWithFallbackOpt = dataSource.dataLayers.find(_.name == fallbackLayerName.getOrElse(""))
      fallbackLayer <- Fox.runOptional(layerWithFallbackOpt) { layerWithFallback =>
        RemoteFallbackLayer.fromDataLayerAndDataSource(layerWithFallback, dataSourceId).toFox
      }
    } yield fallbackLayer

}
