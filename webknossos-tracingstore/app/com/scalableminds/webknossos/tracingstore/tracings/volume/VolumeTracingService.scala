package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.io.{NamedStream, ZipIO}
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.ElementClassProto
import com.scalableminds.webknossos.datastore.dataformats.wkw.WKWDataFormatHelper
import com.scalableminds.webknossos.datastore.geometry.NamedBoundingBoxProto
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.DataRequestCollection.DataRequestCollection
import com.scalableminds.webknossos.datastore.models._
import com.scalableminds.webknossos.datastore.models.datasource.{AdditionalAxis, DataLayer, ElementClass}
import com.scalableminds.webknossos.datastore.models.requests.DataServiceDataRequest
import com.scalableminds.webknossos.datastore.services._
import com.scalableminds.webknossos.tracingstore.tracings.TracingType.TracingType
import com.scalableminds.webknossos.tracingstore.tracings._
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeDataZipFormat.VolumeDataZipFormat
import com.scalableminds.webknossos.tracingstore.{TSRemoteDatastoreClient, TSRemoteWebknossosClient}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.Files
import play.api.libs.Files.TemporaryFileCreator

import java.io._
import java.nio.file.Paths
import java.util.Base64
import java.util.zip.Deflater
import scala.collection.mutable
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

class VolumeTracingService @Inject()(
    tracingDataStore: TracingDataStore,
    adHocMeshServiceHolder: AdHocMeshServiceHolder,
    temporaryFileCreator: TemporaryFileCreator,
    volumeSegmentIndexService: VolumeSegmentIndexService,
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
  private val binaryDataService = new BinaryDataService(Paths.get(""), None, None, None, None)

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

  private def updateSegmentIndex(segmentIndexBuffer: VolumeSegmentIndexBuffer,
                                 bucketPosition: BucketPosition,
                                 bucketBytes: Array[Byte],
                                 previousBucketBytesBox: Box[Array[Byte]],
                                 elementClass: ElementClassProto,
                                 editableMappingTracingId: Option[String]): Fox[Unit] =
    volumeSegmentIndexService.updateFromBucket(segmentIndexBuffer,
                                               bucketPosition,
                                               bucketBytes,
                                               previousBucketBytesBox,
                                               elementClass,
                                               editableMappingTracingId) ?~> "volumeSegmentIndex.update.failed"

  def applyBucketMutatingActions(tracingId: String,
                                 annotationId: String,
                                 tracing: VolumeTracing,
                                 updateActions: List[BucketMutatingVolumeUpdateAction],
                                 newVersion: Long)(implicit tc: TokenContext): Fox[Unit] =
    for {
      // warning, may be called multiple times with the same version number (due to transaction management).
      // frontend ensures that each bucket is only updated once per transaction
      before <- Instant.nowFox
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
      beforePrefill <- Instant.nowFox
      _ <- Fox.runIf(volumeLayer.tracing.getHasSegmentIndex)(volumeBucketBuffer.prefill(updateActions.flatMap {
        case a: UpdateBucketVolumeAction => Some(a.bucketPosition)
        case _                           => None
      }) ?~> "annotation.update.failed.prefillBucketBuffer")
      _ = Instant.logSince(beforePrefill, "prefill")
      beforeUpdateBuckt = Instant.now
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
      _ = Instant.logSince(beforeUpdateBuckt, s"updateBucket ${updateActions.length}x")
      _ <- volumeBucketBuffer.flush()
      _ <- segmentIndexBuffer.flush()
      _ = Instant.logSince(before, "applyBucketMutatingActions total")
    } yield ()

  private def updateBucket(tracingId: String,
                           volumeLayer: VolumeTracingLayer,
                           action: UpdateBucketVolumeAction,
                           segmentIndexBuffer: VolumeSegmentIndexBuffer,
                           volumeBucketBuffer: VolumeBucketBuffer): Fox[Unit] =
    for {
      _ <- bool2Fox(!action.bucketPosition.hasNegativeComponent) ?~> s"Received a bucket at negative position (${action.bucketPosition}), must be positive"
      _ <- assertMagIsValid(volumeLayer.tracing, action.mag) ?~> s"Received a mag-${action.mag.toMagLiteral(allowScalar = true)} bucket, which is invalid for this annotation."

      actionBucketData <- action.base64Data.map(Base64.getDecoder.decode).toFox
      _ <- Fox.runIf(volumeLayer.tracing.getHasSegmentIndex) {
        for {
          previousBucketBytes <- volumeBucketBuffer.getWithFallback(action.bucketPosition).futureBox
          _ <- updateSegmentIndex(
            segmentIndexBuffer,
            action.bucketPosition,
            actionBucketData,
            previousBucketBytes,
            volumeLayer.tracing.elementClass,
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
      dataLayer = volumeTracingLayer(annotationId, tracingId, volumeTracing)
      fallbackLayer <- getFallbackLayer(annotationId, volumeTracing)
      possibleAdditionalCoordinates = AdditionalAxis.coordinateSpace(dataLayer.additionalAxes).map(Some(_))
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
            bucketPositionsRaw <- volumeSegmentIndexService.getSegmentToBucketIndexWithEmptyFallbackWithoutBuffer(
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
                  data <- loadBucket(dataLayer, bucketPosition)
                  typedData = SegmentIntegerArray.fromByteArray(data, volumeTracing.elementClass)
                  filteredData = typedData.map(elem =>
                    if (elem.toLong == a.id) SegmentInteger.zeroFromElementClass(volumeTracing.elementClass) else elem)
                  filteredBytes = SegmentIntegerArray.toByteArray(filteredData, volumeTracing.elementClass)
                  _ <- saveBucket(dataLayer, bucketPosition, filteredBytes, version)
                  _ <- updateSegmentIndex(
                    segmentIndexBuffer,
                    bucketPosition,
                    filteredBytes,
                    Some(data),
                    volumeTracing.elementClass,
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
      bool2Fox(tracing.mags.exists(r => vec3IntFromProto(r) == mag))
    } else { // old volume tracings do not have a mag list, no assert possible. Check compatibility by asserting isotropic mag
      bool2Fox(mag.isIsotropic)
    }

  def revertVolumeData(tracingId: String,
                       annotationId: String,
                       sourceVersion: Long,
                       sourceTracing: VolumeTracing,
                       newVersion: Long,
                       tracingBeforeRevert: VolumeTracing)(implicit tc: TokenContext): Fox[Unit] = {
    val before = Instant.now

    val dataLayer = volumeTracingLayer(annotationId, tracingId, tracingBeforeRevert)
    val bucketStreamBeforeRevert =
      dataLayer.volumeBucketProvider.bucketStreamWithVersion(version = Some(tracingBeforeRevert.version))

    for {
      fallbackLayer <- getFallbackLayer(annotationId, tracingBeforeRevert)
      mappingName <- getMappingNameUnlessEditable(sourceTracing)
      segmentIndexBuffer = new VolumeSegmentIndexBuffer(
        tracingId,
        dataLayer.elementClass,
        mappingName,
        volumeSegmentIndexClient,
        newVersion,
        remoteDatastoreClient,
        fallbackLayer,
        dataLayer.additionalAxes,
        temporaryTracingService,
        tc
      )
      _ <- Fox.serialCombined(bucketStreamBeforeRevert) {
        case (bucketPosition, dataBeforeRevert, version) =>
          if (version > sourceVersion) {
            loadBucket(dataLayer, bucketPosition, Some(sourceVersion)).futureBox.map {
              case Full(dataAfterRevert) =>
                for {
                  _ <- saveBucket(dataLayer, bucketPosition, dataAfterRevert, newVersion)
                  _ <- Fox.runIfOptionTrue(tracingBeforeRevert.hasSegmentIndex)(
                    updateSegmentIndex(
                      segmentIndexBuffer,
                      bucketPosition,
                      dataAfterRevert,
                      Full(dataBeforeRevert),
                      sourceTracing.elementClass,
                      editableMappingTracingId(sourceTracing, tracingId)
                    ))
                } yield ()
              case Empty =>
                for {
                  dataAfterRevert <- Fox.successful(revertedValue)
                  _ <- saveBucket(dataLayer, bucketPosition, dataAfterRevert, newVersion)
                  _ <- Fox.runIfOptionTrue(tracingBeforeRevert.hasSegmentIndex)(
                    updateSegmentIndex(
                      segmentIndexBuffer,
                      bucketPosition,
                      dataAfterRevert,
                      Full(dataBeforeRevert),
                      sourceTracing.elementClass,
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
      Failure("Tracing has already been edited.")
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
              _ <- bool2Fox(
                ElementClass
                  .largestSegmentIdIsInRange(mergedVolume.largestSegmentId.toLong, tracing.elementClass)) ?~> Messages(
                "annotation.volume.largestSegmentIdExceedsRange",
                mergedVolume.largestSegmentId.toLong,
                tracing.elementClass)
              destinationDataLayer = volumeTracingLayer(annotationId, tracingId, tracing)
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
                  _ <- saveBucket(destinationDataLayer, bucketPosition, bytes, tracing.version)
                  _ <- Fox.runIfOptionTrue(tracing.hasSegmentIndex)(
                    updateSegmentIndex(segmentIndexBuffer,
                                       bucketPosition,
                                       bytes,
                                       Empty,
                                       tracing.elementClass,
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
      Failure("Tracing has already been edited.")
    } else {
      val dataLayer = volumeTracingLayer(annotationId, tracingId, tracing)
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
              _ <- saveBucket(dataLayer, bucketPosition, bytes, tracing.version)
              _ <- Fox.runIfOptionTrue(tracing.hasSegmentIndex)(
                updateSegmentIndex(segmentIndexBuffer,
                                   bucketPosition,
                                   bytes,
                                   Empty,
                                   tracing.elementClass,
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

  def allDataZip(
      annotationId: String,
      tracingId: String,
      tracing: VolumeTracing,
      volumeDataZipFormat: VolumeDataZipFormat,
      voxelSize: Option[VoxelSize])(implicit ec: ExecutionContext, tc: TokenContext): Fox[Files.TemporaryFile] = {
    val zipped = temporaryFileCreator.create(tracingId, ".zip")
    val os = new BufferedOutputStream(new FileOutputStream(new File(zipped.path.toString)))
    allDataToOutputStream(annotationId, tracingId, tracing, volumeDataZipFormat, voxelSize, os).map(_ => zipped)
  }

  private def allDataToOutputStream(annotationId: String,
                                    tracingId: String,
                                    tracing: VolumeTracing,
                                    volumeDataZipFormmat: VolumeDataZipFormat,
                                    voxelSize: Option[VoxelSize],
                                    os: OutputStream)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Unit] = {
    val dataLayer = volumeTracingLayer(annotationId, tracingId, tracing)
    val buckets: Iterator[NamedStream] = volumeDataZipFormmat match {
      case VolumeDataZipFormat.wkw =>
        new WKWBucketStreamSink(dataLayer, tracing.fallbackLayer.nonEmpty)(
          dataLayer.bucketProvider.bucketStream(Some(tracing.version)),
          tracing.mags.map(mag => vec3IntFromProto(mag)))
      case VolumeDataZipFormat.zarr3 =>
        new Zarr3BucketStreamSink(dataLayer, tracing.fallbackLayer.nonEmpty)(
          dataLayer.bucketProvider.bucketStream(Some(tracing.version)),
          tracing.mags.map(mag => vec3IntFromProto(mag)),
          voxelSize)
    }

    val before = Instant.now
    val zipResult = ZipIO.zip(buckets, os, level = Deflater.BEST_SPEED)

    zipResult.onComplete {
      case b: scala.util.Success[Box[Unit]] =>
        logger.info(
          s"Zipping volume data for $tracingId took ${formatDuration(Instant.since(before))}. Result: ${b.get}")
      case _ => ()
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
      dataLayer = volumeTracingLayer(annotationId,
                                     tracingId,
                                     tracing,
                                     isTemporaryTracing,
                                     includeFallbackDataIfAvailable)
      requests = dataRequests.map(r =>
        DataServiceDataRequest(null, dataLayer, r.cuboid(dataLayer), r.settings.copy(appliedAgglomerate = None)))
      data <- binaryDataService.handleDataRequests(requests)
    } yield data

  def adaptVolumeForDuplicate(sourceAnnotationId: String,
                              newTracingId: String,
                              sourceTracing: VolumeTracing,
                              isFromTask: Boolean,
                              boundingBox: Option[BoundingBox],
                              datasetBoundingBox: Option[BoundingBox],
                              magRestrictions: MagRestrictions,
                              editPosition: Option[Vec3Int],
                              editRotation: Option[Vec3Double],
                              newVersion: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[VolumeTracing] = {
    val tracingWithBB = addBoundingBoxFromTaskIfRequired(sourceTracing, isFromTask, datasetBoundingBox)
    val tracingWithMagRestrictions = VolumeTracingMags.restrictMagList(tracingWithBB, magRestrictions)
    for {
      fallbackLayer <- getFallbackLayer(sourceAnnotationId, tracingWithMagRestrictions)
      hasSegmentIndex <- VolumeSegmentIndexService.canHaveSegmentIndex(remoteDatastoreClient, fallbackLayer)
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
        hasSegmentIndex = Some(hasSegmentIndex)
      )
      _ <- bool2Fox(newTracing.mags.nonEmpty) ?~> "magRestrictions.tooTight"
    } yield newTracing
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
      sourceDataLayer = volumeTracingLayer(sourceAnnotationId, sourceTracingId, sourceTracing, isTemporaryTracing)
      buckets: Iterator[(BucketPosition, Array[Byte])] = sourceDataLayer.bucketProvider.bucketStream(
        Some(sourceTracing.version))
      destinationDataLayer = volumeTracingLayer(newAnnotationId, newTracingId, newTracing)
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
      _ <- Fox.serialCombined(buckets) {
        case (bucketPosition, bucketData) =>
          if (newTracing.mags.contains(vec3IntToProto(bucketPosition.mag))) {
            for {
              _ <- saveBucket(destinationDataLayer, bucketPosition, bucketData, newTracing.version)
              _ = bucketCount += 1
              _ <- Fox.runIfOptionTrue(newTracing.hasSegmentIndex)(
                updateSegmentIndex(
                  segmentIndexBuffer,
                  bucketPosition,
                  bucketData,
                  Empty,
                  sourceTracing.elementClass,
                  editableMappingTracingId(sourceTracing, sourceTracingId)
                ))
            } yield ()
          } else Fox.successful(())
      }
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
      _ <- bool2Fox(tracing.version == 0L) ?~> "Tracing has already been edited."
      _ <- bool2Fox(mags.nonEmpty) ?~> "Initializing without any mags. No data or mag restrictions too tight?"
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
                       indexB: Int,
                       mergedVolumeStats: MergedVolumeStats): Box[VolumeTracing] = {
    val largestSegmentId = combineLargestSegmentIdsByMaxDefined(tracingA.largestSegmentId, tracingB.largestSegmentId)
    val groupMapping = GroupUtils.calculateSegmentGroupMapping(tracingA.segmentGroups, tracingB.segmentGroups)
    val mergedGroups = GroupUtils.mergeSegmentGroups(tracingA.segmentGroups, tracingB.segmentGroups, groupMapping)
    val mergedBoundingBox = combineBoundingBoxes(Some(tracingA.boundingBox), Some(tracingB.boundingBox))
    val userBoundingBoxes = combineUserBoundingBoxes(tracingA.userBoundingBox,
                                                     tracingB.userBoundingBox,
                                                     tracingA.userBoundingBoxes,
                                                     tracingB.userBoundingBoxes)
    for {
      mergedAdditionalAxes <- AdditionalAxis.mergeAndAssertSameAdditionalAxes(
        Seq(tracingA, tracingB).map(t => AdditionalAxis.fromProtosAsOpt(t.additionalAxes)))
      tracingBSegments = if (indexB >= mergedVolumeStats.labelMaps.length) tracingB.segments
      else {
        val labelMap = mergedVolumeStats.labelMaps(indexB)
        tracingB.segments.map { segment =>
          segment.copy(
            segmentId = labelMap.getOrElse(segment.segmentId, segment.segmentId)
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
        userBoundingBoxes = userBoundingBoxes,
        segments = tracingA.segments.toList ::: tracingBSegments.toList,
        segmentGroups = mergedGroups,
        additionalAxes = AdditionalAxis.toProto(mergedAdditionalAxes)
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
      volumeTracings: List[VolumeTracing],
      newVolumeTracingId: String,
      newVersion: Long,
      toTemporaryStore: Boolean)(implicit mp: MessagesProvider, tc: TokenContext): Fox[MergedVolumeStats] = {
    val before = Instant.now
    val volumeTracingLayers = volumeTracingIds.zip(volumeTracings).map {
      case (tracingId, tracing) => volumeTracingLayer("annotationIdUnusedInThisContext", tracingId, tracing)
    }
    val elementClassProto =
      volumeTracingLayers.headOption.map(_.tracing.elementClass).getOrElse(ElementClassProto.uint8)

    val magSets = new mutable.HashSet[Set[Vec3Int]]()
    volumeTracingLayers.foreach { volumeTracingLayer =>
      val magSet = new mutable.HashSet[Vec3Int]()
      volumeTracingLayer.bucketStream.foreach {
        case (bucketPosition, _) =>
          magSet.add(bucketPosition.mag)
      }
      if (magSet.nonEmpty) { // empty tracings should have no impact in this check
        magSets.add(magSet.toSet)
      }
    }

    val shouldCreateSegmentIndex =
      volumeSegmentIndexService.shouldCreateSegmentIndexForMerged(volumeTracingLayers.map(_.tracing))

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

      volumeTracingLayers.foreach { volumeTracingLayer =>
        mergedVolume.addLabelSetFromBucketStream(volumeTracingLayer.bucketStream, magsIntersection)
      }

      volumeTracingLayers.zipWithIndex.foreach {
        case (volumeTracingLayer, sourceVolumeIndex) =>
          mergedVolume.addFromBucketStream(sourceVolumeIndex, volumeTracingLayer.bucketStream, Some(magsIntersection))
      }
      for {
        _ <- bool2Fox(ElementClass.largestSegmentIdIsInRange(mergedVolume.largestSegmentId.toLong, elementClassProto)) ?~> Messages(
          "annotation.volume.largestSegmentIdExceedsRange",
          mergedVolume.largestSegmentId.toLong,
          elementClassProto)
        mergedAdditionalAxes <- Fox.box2Fox(AdditionalAxis.mergeAndAssertSameAdditionalAxes(volumeTracingLayers.map(l =>
          AdditionalAxis.fromProtosAsOpt(l.tracing.additionalAxes))))
        firstTracing <- volumeTracingLayers.headOption.map(_.tracing) ?~> "merge.noTracings"
        firstVolumeAnnotationId <- firstVolumeAnnotationIdOpt.toFox
        fallbackLayer <- getFallbackLayer(firstVolumeAnnotationId, firstTracing)
        segmentIndexBuffer = new VolumeSegmentIndexBuffer(
          newVolumeTracingId,
          elementClassProto,
          volumeTracingLayers.headOption.flatMap(_.tracing.mappingName),
          volumeSegmentIndexClient,
          newVersion,
          remoteDatastoreClient,
          fallbackLayer,
          mergedAdditionalAxes,
          temporaryTracingService,
          tc,
          toTemporaryStore
        )
        _ <- mergedVolume.withMergedBuckets { (bucketPosition, bucketBytes) =>
          for {
            _ <- saveBucket(newVolumeTracingId,
                            elementClassProto,
                            bucketPosition,
                            bucketBytes,
                            newVersion,
                            toTemporaryStore,
                            mergedAdditionalAxes)
            _ <- Fox.runIf(shouldCreateSegmentIndex)(
              updateSegmentIndex(segmentIndexBuffer, bucketPosition, bucketBytes, Empty, elementClassProto, None))
          } yield ()
        }
        _ <- segmentIndexBuffer.flush()
        _ = Instant.logSince(
          before,
          s"Merging buckets from ${volumeTracingLayers.length} volume tracings into new $newVolumeTracingId, with createSegmentIndex = $shouldCreateSegmentIndex"
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
          _ <- mergedVolume.addLabelSetFromDataZip(zipFile).toFox
          _ = mergedVolume.addFromBucketStream(sourceVolumeIndex = 0, volumeLayer.bucketProvider.bucketStream())
          _ <- mergedVolume.addFromDataZip(sourceVolumeIndex = 1, zipFile).toFox
          _ <- bool2Fox(
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
                  previousBucketBytes <- loadBucket(volumeLayer, bucketPosition, Some(tracing.version)).futureBox
                  _ <- updateSegmentIndex(
                    segmentIndexBuffer,
                    bucketPosition,
                    bucketBytes,
                    previousBucketBytes,
                    tracing.elementClass,
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
      implicit tc: TokenContext) =
    Fox[Option[RemoteFallbackLayer]] {
      for {
        dataSource <- remoteWebknossosClient.getDataSourceForAnnotation(annotationId)
        dataSourceId = dataSource.id
        layerWithFallbackOpt = dataSource.dataLayers.find(_.name == fallbackLayerName.getOrElse(""))
        fallbackLayer <- Fox.runOptional(layerWithFallbackOpt) { layerWithFallback =>
          RemoteFallbackLayer.fromDataLayerAndDataSource(layerWithFallback, dataSourceId).toFox
        }
      } yield fallbackLayer
    }

}
