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

  def saveVolume(tracing: VolumeTracing,
                 tracingId: Option[String],
                 version: Long,
                 toTemporaryStore: Boolean = false): Fox[String] = {
    val id = tracingId.getOrElse(TracingId.generate)
    if (toTemporaryStore) {
      temporaryTracingService.saveVolume(id, tracing).map(_ => id)
    } else {
      tracingDataStore.volumes.put(id, version, tracing).map(_ => id)
    }
  }

  private def updateSegmentIndex(
      segmentIndexBuffer: VolumeSegmentIndexBuffer,
      bucketPosition: BucketPosition,
      bucketBytes: Array[Byte],
      previousBucketBytesBox: Box[Array[Byte]],
      elementClass: ElementClassProto,
      mappingName: Option[String], // should be the base mapping name in case of editable mapping
      editableMappingTracingId: Option[String]): Fox[Unit] =
    volumeSegmentIndexService.updateFromBucket(segmentIndexBuffer,
                                               bucketPosition,
                                               bucketBytes,
                                               previousBucketBytesBox,
                                               elementClass,
                                               mappingName,
                                               editableMappingTracingId) ?~> "volumeSegmentIndex.update.failed"

  def applyBucketMutatingActions(tracingId: String,
                                 tracing: VolumeTracing,
                                 updateActions: List[BucketMutatingVolumeUpdateAction],
                                 newVersion: Long)(implicit tc: TokenContext): Fox[Unit] =
    for {
      // warning, may be called multiple times with the same version number (due to transaction management).
      // frontend ensures that each bucket is only updated once per transaction
      fallbackLayerOpt <- getFallbackLayer(tracingId, tracing)
      segmentIndexBuffer = new VolumeSegmentIndexBuffer(
        tracingId,
        volumeSegmentIndexClient,
        newVersion,
        remoteDatastoreClient,
        fallbackLayerOpt,
        AdditionalAxis.fromProtosAsOpt(tracing.additionalAxes),
        temporaryTracingService,
        tc
      )
      _ <- Fox.serialCombined(updateActions) {
        case a: UpdateBucketVolumeAction =>
          if (tracing.getHasEditableMapping) {
            Fox.failure("Cannot mutate volume data in annotation with editable mapping.")
          } else
            updateBucket(tracingId, tracing, a, segmentIndexBuffer, newVersion) ?~> "Failed to save volume data."
        case a: DeleteSegmentDataVolumeAction =>
          if (!tracing.getHasSegmentIndex) {
            Fox.failure("Cannot delete segment data for annotations without segment index.")
          } else
            deleteSegmentData(tracingId, tracing, a, segmentIndexBuffer, newVersion) ?~> "Failed to delete segment data."
        case _ => Fox.failure("Unknown bucket-mutating action.")
      }
      _ <- segmentIndexBuffer.flush()
    } yield ()

  private def updateBucket(tracingId: String,
                           volumeTracing: VolumeTracing,
                           action: UpdateBucketVolumeAction,
                           segmentIndexBuffer: VolumeSegmentIndexBuffer,
                           updateGroupVersion: Long)(implicit tc: TokenContext): Fox[VolumeTracing] =
    for {
      _ <- assertMagIsValid(volumeTracing, action.mag) ?~> s"Received a mag-${action.mag.toMagLiteral(allowScalar = true)} bucket, which is invalid for this annotation."
      bucketPosition = BucketPosition(action.position.x,
                                      action.position.y,
                                      action.position.z,
                                      action.mag,
                                      action.additionalCoordinates)
      _ <- bool2Fox(!bucketPosition.hasNegativeComponent) ?~> s"Received a bucket at negative position ($bucketPosition), must be positive"
      dataLayer = volumeTracingLayer(tracingId, volumeTracing)
      actionBucketData <- action.base64Data.map(Base64.getDecoder.decode).toFox
      _ <- saveBucket(dataLayer, bucketPosition, actionBucketData, updateGroupVersion) ?~> "failed to save bucket"
      mappingName <- getMappingNameUnlessEditable(volumeTracing)
      _ <- Fox.runIfOptionTrue(volumeTracing.hasSegmentIndex) {
        for {
          previousBucketBytes <- loadBucket(dataLayer, bucketPosition, Some(updateGroupVersion - 1L)).futureBox
          _ <- updateSegmentIndex(
            segmentIndexBuffer,
            bucketPosition,
            actionBucketData,
            previousBucketBytes,
            volumeTracing.elementClass,
            mappingName,
            editableMappingTracingId(volumeTracing, tracingId)
          ) ?~> "failed to update segment index"
        } yield ()
      }
    } yield volumeTracing.copy(volumeBucketDataHasChanged = Some(true))

  def editableMappingTracingId(tracing: VolumeTracing, tracingId: String): Option[String] =
    if (tracing.getHasEditableMapping) Some(tracingId) else None

  private def getMappingNameUnlessEditable(tracing: VolumeTracing): Fox[Option[String]] =
    if (tracing.getHasEditableMapping)
      Fox.failure("getMappingNameUnlessEditable called on volumeTracing with editableMapping!")
    else Fox.successful(tracing.mappingName)

  private def deleteSegmentData(tracingId: String,
                                volumeTracing: VolumeTracing,
                                a: DeleteSegmentDataVolumeAction,
                                segmentIndexBuffer: VolumeSegmentIndexBuffer,
                                version: Long)(implicit tc: TokenContext): Fox[VolumeTracing] =
    for {
      _ <- Fox.successful(())
      dataLayer = volumeTracingLayer(tracingId, volumeTracing)
      fallbackLayer <- getFallbackLayer(tracingId, volumeTracing)
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
              fallbackLayer,
              tracingId,
              a.id,
              mag,
              None,
              mappingName,
              editableMappingTracingId(volumeTracing, tracingId),
              additionalCoordinates,
              dataLayer.additionalAxes
            )
            bucketPositions = bucketPositionsRaw.values
              .map(vec3IntFromProto)
              .map(_ * mag * DataLayer.bucketLength)
              .map(bp => BucketPosition(bp.x, bp.y, bp.z, mag, additionalCoordinates))
              .toList
            _ <- Fox.serialCombined(bucketPositions) {
              bucketPosition =>
                for {
                  data <- loadBucket(dataLayer, bucketPosition)
                  typedData = UnsignedIntegerArray.fromByteArray(data, volumeTracing.elementClass)
                  filteredData = typedData.map(elem =>
                    if (elem.toLong == a.id) UnsignedInteger.zeroFromElementClass(volumeTracing.elementClass) else elem)
                  filteredBytes = UnsignedIntegerArray.toByteArray(filteredData, volumeTracing.elementClass)
                  _ <- saveBucket(dataLayer, bucketPosition, filteredBytes, version)
                  _ <- updateSegmentIndex(
                    segmentIndexBuffer,
                    bucketPosition,
                    filteredBytes,
                    Some(data),
                    volumeTracing.elementClass,
                    mappingName,
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
                       sourceVersion: Long,
                       sourceTracing: VolumeTracing,
                       newVersion: Long,
                       tracingBeforeRevert: VolumeTracing)(implicit tc: TokenContext): Fox[Unit] = {
    val before = Instant.now

    val dataLayer = volumeTracingLayer(tracingId, tracingBeforeRevert)
    val bucketStreamBeforeRevert =
      dataLayer.volumeBucketProvider.bucketStreamWithVersion(version = Some(tracingBeforeRevert.version))

    for {
      fallbackLayer <- getFallbackLayer(tracingId, tracingBeforeRevert)
      segmentIndexBuffer = new VolumeSegmentIndexBuffer(
        tracingId,
        volumeSegmentIndexClient,
        newVersion,
        remoteDatastoreClient,
        fallbackLayer,
        dataLayer.additionalAxes,
        temporaryTracingService,
        tc
      )
      mappingName <- getMappingNameUnlessEditable(sourceTracing)
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
                      mappingName,
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
                      mappingName,
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

  def initializeWithDataMultiple(tracingId: String, tracing: VolumeTracing, initialData: File)(
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
              destinationDataLayer = volumeTracingLayer(tracingId, tracing)
              fallbackLayer <- getFallbackLayer(tracingId, tracing)
              segmentIndexBuffer = new VolumeSegmentIndexBuffer(
                tracingId,
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
                                       mappingName,
                                       editableMappingTracingId(tracing, tracingId)))
                } yield ()
              }
              _ <- segmentIndexBuffer.flush()
            } yield mergedVolume.presentMags
          }
        }
      } yield mags
    }

  def initializeWithData(tracingId: String,
                         tracing: VolumeTracing,
                         initialData: File,
                         magRestrictions: MagRestrictions)(implicit tc: TokenContext): Fox[Set[Vec3Int]] =
    if (tracing.version != 0L) {
      Failure("Tracing has already been edited.")
    } else {
      val dataLayer = volumeTracingLayer(tracingId, tracing)
      val savedMags = new mutable.HashSet[Vec3Int]()
      for {
        fallbackLayer <- getFallbackLayer(tracingId, tracing)
        mappingName <- getMappingNameUnlessEditable(tracing)
        segmentIndexBuffer = new VolumeSegmentIndexBuffer(
          tracingId,
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
                                   mappingName,
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
      tracingId: String,
      tracing: VolumeTracing,
      volumeDataZipFormat: VolumeDataZipFormat,
      voxelSize: Option[VoxelSize])(implicit ec: ExecutionContext, tc: TokenContext): Fox[Files.TemporaryFile] = {
    val zipped = temporaryFileCreator.create(tracingId, ".zip")
    val os = new BufferedOutputStream(new FileOutputStream(new File(zipped.path.toString)))
    allDataToOutputStream(tracingId, tracing, volumeDataZipFormat, voxelSize, os).map(_ => zipped)
  }

  private def allDataToOutputStream(tracingId: String,
                                    tracing: VolumeTracing,
                                    volumeDataZipFormmat: VolumeDataZipFormat,
                                    voxelSize: Option[VoxelSize],
                                    os: OutputStream)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Unit] = {
    val dataLayer = volumeTracingLayer(tracingId, tracing)
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

  def data(tracingId: String,
           tracing: VolumeTracing,
           dataRequests: DataRequestCollection,
           includeFallbackDataIfAvailable: Boolean = false)(implicit tc: TokenContext): Fox[(Array[Byte], List[Int])] =
    for {
      isTemporaryTracing <- temporaryTracingService.isTemporaryTracing(tracingId)
      dataLayer = volumeTracingLayer(tracingId, tracing, isTemporaryTracing, includeFallbackDataIfAvailable)
      requests = dataRequests.map(r =>
        DataServiceDataRequest(null, dataLayer, r.cuboid(dataLayer), r.settings.copy(appliedAgglomerate = None)))
      data <- binaryDataService.handleDataRequests(requests)
    } yield data

  def adaptVolumeForDuplicate(sourceTracingId: String,
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
      fallbackLayer <- getFallbackLayer(sourceTracingId, tracingWithMagRestrictions)
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

  def duplicateVolumeData(sourceTracingId: String,
                          sourceTracing: VolumeTracing,
                          newTracingId: String,
                          newTracing: VolumeTracing)(implicit tc: TokenContext): Fox[Unit] = {
    var bucketCount = 0
    val before = Instant.now
    for {
      isTemporaryTracing <- temporaryTracingService.isTemporaryTracing(sourceTracingId)
      sourceDataLayer = volumeTracingLayer(sourceTracingId, sourceTracing, isTemporaryTracing)
      buckets: Iterator[(BucketPosition, Array[Byte])] = sourceDataLayer.bucketProvider.bucketStream(
        Some(sourceTracing.version))
      destinationDataLayer = volumeTracingLayer(newTracingId, newTracing)
      fallbackLayer <- getFallbackLayer(sourceTracingId, sourceTracing)
      segmentIndexBuffer = new VolumeSegmentIndexBuffer(
        newTracingId,
        volumeSegmentIndexClient,
        newTracing.version,
        remoteDatastoreClient,
        fallbackLayer,
        AdditionalAxis.fromProtosAsOpt(sourceTracing.additionalAxes),
        temporaryTracingService,
        tc
      )
      mappingName <- getMappingNameUnlessEditable(sourceTracing)
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
                  mappingName,
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
      tracingId: String,
      tracing: VolumeTracing,
      isTemporaryTracing: Boolean = false,
      includeFallbackDataIfAvailable: Boolean = false)(implicit tc: TokenContext): VolumeTracingLayer =
    VolumeTracingLayer(
      name = tracingId,
      isTemporaryTracing = isTemporaryTracing,
      volumeTracingService = this,
      temporaryTracingService = this.temporaryTracingService,
      volumeDataStore = volumeDataStore,
      includeFallbackDataIfAvailable = includeFallbackDataIfAvailable,
      tracing = tracing,
      tokenContext = tc,
      additionalAxes = AdditionalAxis.fromProtosAsOpt(tracing.additionalAxes)
    )

  def updateMagList(tracingId: String, tracing: VolumeTracing, mags: Set[Vec3Int]): Fox[String] =
    for {
      _ <- bool2Fox(tracing.version == 0L) ?~> "Tracing has already been edited."
      _ <- bool2Fox(mags.nonEmpty) ?~> "Initializing without any mags. No data or mag restrictions too tight?"
      id <- saveVolume(tracing.copy(mags = mags.toList.sortBy(_.maxDim).map(vec3IntToProto)),
                       Some(tracingId),
                       tracing.version)
    } yield id

  def volumeBucketsAreEmpty(tracingId: String): Boolean =
    volumeDataStore.getMultipleKeys(None, Some(tracingId), limit = Some(1))(toBox).isEmpty

  def createAdHocMesh(tracingId: String, tracing: VolumeTracing, request: WebknossosAdHocMeshRequest)(
      implicit tc: TokenContext): Fox[(Array[Float], List[Int])] =
    for {
      isTemporaryTracing <- temporaryTracingService.isTemporaryTracing(tracingId)
      volumeLayer = volumeTracingLayer(tracingId,
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

  def findData(tracingId: String, tracing: VolumeTracing)(implicit tc: TokenContext): Fox[Option[Vec3Int]] =
    for {
      _ <- Fox.successful(())
      isTemporaryTracing <- temporaryTracingService.isTemporaryTracing(tracingId)
      volumeLayer = volumeTracingLayer(tracingId, tracing, isTemporaryTracing = isTemporaryTracing)
      bucketStream = volumeLayer.bucketProvider.bucketStream(Some(tracing.version))
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

  private def bucketStreamFor(tracingId: String, tracing: VolumeTracing)(
      implicit tc: TokenContext): Iterator[(BucketPosition, Array[Byte])] = {
    val dataLayer = volumeTracingLayer(tracingId, tracing)
    dataLayer.bucketProvider.bucketStream(Some(tracing.version))
  }

  def mergeVolumeData(
      tracingIds: Seq[String],
      tracings: Seq[VolumeTracing],
      newId: String,
      newVersion: Long,
      toTemporaryStore: Boolean)(implicit mp: MessagesProvider, tc: TokenContext): Fox[MergedVolumeStats] = {
    val before = Instant.now
    val elementClass = tracings.headOption.map(_.elementClass).getOrElse(elementClassToProto(ElementClass.uint8))

    val magSets = new mutable.HashSet[Set[Vec3Int]]()
    tracingIds.zip(tracings).foreach {
      case (tracingId, tracing) =>
        val magSet = new mutable.HashSet[Vec3Int]()
        bucketStreamFor(tracingId, tracing).foreach {
          case (bucketPosition, _) =>
            magSet.add(bucketPosition.mag)
        }
        if (magSet.nonEmpty) { // empty tracings should have no impact in this check
          magSets.add(magSet.toSet)
        }
    }

    val shouldCreateSegmentIndex = volumeSegmentIndexService.shouldCreateSegmentIndexForMerged(tracings)

    // If none of the tracings contained any volume data. Do not save buckets, do not touch mag list
    if (magSets.isEmpty)
      Fox.successful(MergedVolumeStats.empty(shouldCreateSegmentIndex))
    else {
      val magsIntersection: Set[Vec3Int] = magSets.headOption.map { head =>
        magSets.foldLeft(head) { (acc, element) =>
          acc.intersect(element)
        }
      }.getOrElse(Set.empty)

      val mergedVolume = new MergedVolume(elementClass)

      tracingIds.zip(tracings).foreach {
        case (tracingId, tracing) =>
          val bucketStream = bucketStreamFor(tracingId, tracing)
          mergedVolume.addLabelSetFromBucketStream(bucketStream, magsIntersection)
      }

      tracingIds.zip(tracings).zipWithIndex.foreach {
        case ((tracingIds, tracing), sourceVolumeIndex) =>
          val bucketStream = bucketStreamFor(tracingIds, tracing)
          mergedVolume.addFromBucketStream(sourceVolumeIndex, bucketStream, Some(magsIntersection))
      }
      for {
        _ <- bool2Fox(ElementClass.largestSegmentIdIsInRange(mergedVolume.largestSegmentId.toLong, elementClass)) ?~> Messages(
          "annotation.volume.largestSegmentIdExceedsRange",
          mergedVolume.largestSegmentId.toLong,
          elementClass)
        mergedAdditionalAxes <- Fox.box2Fox(AdditionalAxis.mergeAndAssertSameAdditionalAxes(tracings.map(t =>
          AdditionalAxis.fromProtosAsOpt(t.additionalAxes))))
        firstTracingId <- tracingIds.headOption ?~> "merge.noTracings"
        firstTracing <- tracings.headOption ?~> "merge.noTracings"
        fallbackLayer <- getFallbackLayer(firstTracingId, firstTracing)
        segmentIndexBuffer = new VolumeSegmentIndexBuffer(newId,
                                                          volumeSegmentIndexClient,
                                                          newVersion,
                                                          remoteDatastoreClient,
                                                          fallbackLayer,
                                                          mergedAdditionalAxes,
                                                          temporaryTracingService,
                                                          tc,
                                                          toTemporaryStore)
        _ <- mergedVolume.withMergedBuckets { (bucketPosition, bucketBytes) =>
          for {
            _ <- saveBucket(newId,
                            elementClass,
                            bucketPosition,
                            bucketBytes,
                            newVersion,
                            toTemporaryStore,
                            mergedAdditionalAxes)
            _ <- Fox.runIf(shouldCreateSegmentIndex)(
              updateSegmentIndex(segmentIndexBuffer,
                                 bucketPosition,
                                 bucketBytes,
                                 Empty,
                                 elementClass,
                                 tracings.headOption.flatMap(_.mappingName),
                                 None))
          } yield ()
        }
        _ <- segmentIndexBuffer.flush()
        _ = Instant.logSince(
          before,
          s"Merging buckets from ${tracings.length} volume tracings into new $newId, with createSegmentIndex = $shouldCreateSegmentIndex")
      } yield mergedVolume.stats(shouldCreateSegmentIndex)
    }
  }

  def importVolumeData(tracingId: String, tracing: VolumeTracing, zipFile: File, currentVersion: Int)(
      implicit mp: MessagesProvider,
      tc: TokenContext): Fox[Long] =
    if (currentVersion != tracing.version)
      Fox.failure("version.mismatch")
    else {
      val magSet = magSetFromZipfile(zipFile)
      val magsDoMatch =
        magSet.isEmpty || magSet == VolumeTracingMags.resolveLegacyMagList(tracing.mags).map(vec3IntFromProto).toSet

      if (!magsDoMatch)
        Fox.failure("annotation.volume.magssDoNotMatch")
      else {
        val volumeLayer = volumeTracingLayer(tracingId, tracing)
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
          dataLayer = volumeTracingLayer(tracingId, tracing)
          fallbackLayer <- getFallbackLayer(tracingId, tracing)
          mappingName <- getMappingNameUnlessEditable(tracing)
          segmentIndexBuffer <- Fox.successful(
            new VolumeSegmentIndexBuffer(
              tracingId,
              volumeSegmentIndexClient,
              tracing.version + 1,
              remoteDatastoreClient,
              fallbackLayer,
              dataLayer.additionalAxes,
              temporaryTracingService,
              tc
            ))
          _ <- mergedVolume.withMergedBuckets { (bucketPosition, bucketBytes) =>
            for {
              _ <- saveBucket(volumeLayer, bucketPosition, bucketBytes, tracing.version + 1)
              _ <- Fox.runIfOptionTrue(tracing.hasSegmentIndex) {
                for {
                  previousBucketBytes <- loadBucket(dataLayer, bucketPosition, Some(tracing.version)).futureBox
                  _ <- updateSegmentIndex(
                    segmentIndexBuffer,
                    bucketPosition,
                    bucketBytes,
                    previousBucketBytes,
                    tracing.elementClass,
                    mappingName,
                    editableMappingTracingId(tracing, tracingId)
                  ) ?~> "failed to update segment index"
                } yield ()
              }
            } yield ()
          }
          _ <- segmentIndexBuffer.flush()
        } yield mergedVolume.largestSegmentId.toPositiveLong
      }
    }

  def getFallbackLayer(tracingId: String, tracing: VolumeTracing)(
      implicit tc: TokenContext): Fox[Option[RemoteFallbackLayer]] =
    fallbackLayerCache.getOrLoad((tracingId, tracing.fallbackLayer, tc.userTokenOpt),
                                 t => getFallbackLayerFromWebknossos(t._1, t._2))

  private def getFallbackLayerFromWebknossos(tracingId: String, fallbackLayerName: Option[String])(
      implicit tc: TokenContext) =
    Fox[Option[RemoteFallbackLayer]] {
      for {
        dataSource <- remoteWebknossosClient.getDataSourceForTracing(tracingId)
        dataSourceId = dataSource.id
        fallbackLayer = dataSource.dataLayers
          .find(_.name == fallbackLayerName.getOrElse(""))
          .map(RemoteFallbackLayer.fromDataLayerAndDataSource(_, dataSourceId))
      } yield fallbackLayer
    }

}
