package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.google.inject.Inject
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.io.{NamedStream, ZipIO}
import com.scalableminds.util.time.{DurationFormatting, Instant}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.dataformats.wkw.WKWDataFormatHelper
import com.scalableminds.webknossos.datastore.geometry.NamedBoundingBoxProto
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.DataRequestCollection.DataRequestCollection
import com.scalableminds.webknossos.datastore.models.datasource.{AdditionalAxis, DataLayer, ElementClass}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.ElementClassProto
import com.scalableminds.webknossos.datastore.models.requests.DataServiceDataRequest
import com.scalableminds.webknossos.datastore.models.{
  AdditionalCoordinate,
  BucketPosition,
  UnsignedInteger,
  UnsignedIntegerArray,
  VoxelSize,
  WebknossosAdHocMeshRequest
}
import com.scalableminds.webknossos.datastore.services._
import com.scalableminds.webknossos.tracingstore.tracings.TracingType.TracingType
import com.scalableminds.webknossos.tracingstore.tracings._
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.EditableMappingService
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeDataZipFormat.VolumeDataZipFormat
import com.scalableminds.webknossos.tracingstore.{
  TSRemoteDatastoreClient,
  TSRemoteWebknossosClient,
  TracingStoreRedisStore
}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.Files
import play.api.libs.Files.TemporaryFileCreator
import play.api.libs.json.{JsObject, JsValue, Json}

import java.io._
import java.nio.file.Paths
import java.util.zip.Deflater
import scala.collection.mutable
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

class VolumeTracingService @Inject()(
    val tracingDataStore: TracingDataStore,
    val tracingStoreWkRpcClient: TSRemoteWebknossosClient,
    val adHocMeshServiceHolder: AdHocMeshServiceHolder,
    implicit val temporaryTracingStore: TemporaryTracingStore[VolumeTracing],
    implicit val temporaryVolumeDataStore: TemporaryVolumeDataStore,
    implicit val ec: ExecutionContext,
    val handledGroupIdStore: TracingStoreRedisStore,
    val uncommittedUpdatesStore: TracingStoreRedisStore,
    editableMappingService: EditableMappingService,
    val temporaryTracingIdStore: TracingStoreRedisStore,
    val remoteDatastoreClient: TSRemoteDatastoreClient,
    val remoteWebknossosClient: TSRemoteWebknossosClient,
    val temporaryFileCreator: TemporaryFileCreator,
    val tracingMigrationService: VolumeTracingMigrationService,
    volumeSegmentIndexService: VolumeSegmentIndexService
) extends TracingService[VolumeTracing]
    with VolumeTracingBucketHelper
    with VolumeTracingDownsampling
    with WKWDataFormatHelper
    with FallbackDataHelper
    with DataFinder
    with VolumeDataZipHelper
    with ProtoGeometryImplicits
    with FoxImplicits
    with DurationFormatting
    with LazyLogging {

  implicit val volumeDataStore: FossilDBClient = tracingDataStore.volumeData

  implicit val tracingCompanion: VolumeTracing.type = VolumeTracing

  implicit val updateActionJsonFormat: VolumeUpdateAction.volumeUpdateActionFormat.type =
    VolumeUpdateAction.volumeUpdateActionFormat

  val tracingType: TracingType = TracingType.volume

  val tracingStore: FossilDBClient = tracingDataStore.volumes

  protected val volumeSegmentIndexClient: FossilDBClient = tracingDataStore.volumeSegmentIndex

  /* We want to reuse the bucket loading methods from binaryDataService for the volume tracings, however, it does not
     actually load anything from disk, unlike its “normal” instance in the datastore (only from the volume tracing store) */
  private val binaryDataService = new BinaryDataService(Paths.get(""), None, None, None, None)

  adHocMeshServiceHolder.tracingStoreAdHocMeshConfig = (binaryDataService, 30 seconds, 1)
  val adHocMeshService: AdHocMeshService = adHocMeshServiceHolder.tracingStoreAdHocMeshService

  private val fallbackLayerCache: AlfuCache[String, Option[RemoteFallbackLayer]] = AlfuCache(maxCapacity = 100)

  override def currentVersion(tracingId: String): Fox[Long] =
    tracingDataStore.volumes.getVersion(tracingId, mayBeEmpty = Some(true), emptyFallback = Some(0L))

  override def currentVersion(tracing: VolumeTracing): Long = tracing.version

  override protected def updateSegmentIndex(
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

  def handleUpdateGroup(tracingId: String,
                        updateGroup: UpdateActionGroup[VolumeTracing],
                        previousVersion: Long,
                        userToken: Option[String]): Fox[Unit] =
    for {
      // warning, may be called multiple times with the same version number (due to transaction management).
      // frontend ensures that each bucket is only updated once per transaction
      fallbackLayer <- getFallbackLayer(tracingId)
      tracing <- find(tracingId) ?~> "tracing.notFound"
      segmentIndexBuffer <- Fox.successful(
        new VolumeSegmentIndexBuffer(
          tracingId,
          volumeSegmentIndexClient,
          updateGroup.version,
          remoteDatastoreClient,
          fallbackLayer,
          AdditionalAxis.fromProtosAsOpt(tracing.additionalAxes),
          userToken
        ))
      updatedTracing: VolumeTracing <- updateGroup.actions.foldLeft(find(tracingId)) { (tracingFox, action) =>
        tracingFox.futureBox.flatMap {
          case Full(tracing) =>
            action match {
              case a: UpdateBucketVolumeAction =>
                if (tracing.getHasEditableMapping) {
                  Fox.failure("Cannot mutate volume data in annotation with editable mapping.")
                } else
                  updateBucket(tracingId, tracing, a, segmentIndexBuffer, updateGroup.version) ?~> "Failed to save volume data."
              case a: UpdateTracingVolumeAction =>
                Fox.successful(
                  tracing.copy(
                    activeSegmentId = Some(a.activeSegmentId),
                    editPosition = a.editPosition,
                    editRotation = a.editRotation,
                    largestSegmentId = a.largestSegmentId,
                    zoomLevel = a.zoomLevel,
                    editPositionAdditionalCoordinates =
                      AdditionalCoordinate.toProto(a.editPositionAdditionalCoordinates)
                  ))
              case a: RevertToVersionVolumeAction =>
                revertToVolumeVersion(tracingId, a.sourceVersion, updateGroup.version, tracing, userToken)
              case a: DeleteSegmentDataVolumeAction =>
                if (!tracing.getHasSegmentIndex) {
                  Fox.failure("Cannot delete segment data for annotations without segment index.")
                } else
                  deleteSegmentData(tracingId, tracing, a, segmentIndexBuffer, updateGroup.version, userToken) ?~> "Failed to delete segment data."
              case _: UpdateTdCamera        => Fox.successful(tracing)
              case a: ApplyableVolumeAction => Fox.successful(a.applyOn(tracing))
              case _                        => Fox.failure("Unknown action.")
            }
          case Empty =>
            Fox.empty
          case f: Failure =>
            f.toFox
        }
      }
      _ <- segmentIndexBuffer.flush()
      _ <- save(updatedTracing.copy(version = updateGroup.version), Some(tracingId), updateGroup.version)
      _ <- tracingDataStore.volumeUpdates.put(
        tracingId,
        updateGroup.version,
        updateGroup.actions.map(_.addTimestamp(updateGroup.timestamp)).map(_.transformToCompact))
    } yield Fox.successful(())

  private def updateBucket(tracingId: String,
                           volumeTracing: VolumeTracing,
                           action: UpdateBucketVolumeAction,
                           segmentIndexBuffer: VolumeSegmentIndexBuffer,
                           updateGroupVersion: Long): Fox[VolumeTracing] =
    for {
      _ <- assertMagIsValid(volumeTracing, action.mag) ?~> s"Received a mag-${action.mag.toMagLiteral(allowScalar = true)} bucket, which is invalid for this annotation."
      bucketPosition = BucketPosition(action.position.x,
                                      action.position.y,
                                      action.position.z,
                                      action.mag,
                                      action.additionalCoordinates)
      _ <- bool2Fox(!bucketPosition.hasNegativeComponent) ?~> s"Received a bucket at negative position ($bucketPosition), must be positive"
      dataLayer = volumeTracingLayer(tracingId, volumeTracing)
      _ <- saveBucket(dataLayer, bucketPosition, action.data, updateGroupVersion) ?~> "failed to save bucket"
      mappingName <- baseMappingName(volumeTracing)
      _ <- Fox.runIfOptionTrue(volumeTracing.hasSegmentIndex) {
        for {
          previousBucketBytes <- loadBucket(dataLayer, bucketPosition, Some(updateGroupVersion - 1L)).futureBox
          _ <- updateSegmentIndex(
            segmentIndexBuffer,
            bucketPosition,
            action.data,
            previousBucketBytes,
            volumeTracing.elementClass,
            mappingName,
            editableMappingTracingId(volumeTracing, tracingId)
          ) ?~> "failed to update segment index"
        } yield ()
      }
    } yield volumeTracing.copy(volumeBucketDataHasChanged = Some(true))

  override def editableMappingTracingId(tracing: VolumeTracing, tracingId: String): Option[String] =
    if (tracing.getHasEditableMapping) Some(tracingId) else None

  override def baseMappingName(tracing: VolumeTracing): Fox[Option[String]] =
    if (tracing.getHasEditableMapping)
      tracing.mappingName.map(editableMappingService.getBaseMappingName).getOrElse(Fox.successful(None))
    else Fox.successful(tracing.mappingName)

  private def deleteSegmentData(tracingId: String,
                                volumeTracing: VolumeTracing,
                                a: DeleteSegmentDataVolumeAction,
                                segmentIndexBuffer: VolumeSegmentIndexBuffer,
                                version: Long,
                                userToken: Option[String]): Fox[VolumeTracing] =
    for {
      _ <- Fox.successful(())
      dataLayer = volumeTracingLayer(tracingId, volumeTracing)
      possibleAdditionalCoordinates = AdditionalAxis.coordinateSpace(dataLayer.additionalAxes).map(Some(_))
      additionalCoordinateList = if (possibleAdditionalCoordinates.isEmpty) {
        List(None)
      } else {
        possibleAdditionalCoordinates.toList
      }
      mappingName <- baseMappingName(volumeTracing)
      _ <- Fox.serialCombined(volumeTracing.mags.toList)(magProto =>
        Fox.serialCombined(additionalCoordinateList)(additionalCoordinates => {
          val mag = vec3IntFromProto(magProto)
          for {
            fallbackLayer <- getFallbackLayer(tracingId)
            bucketPositionsRaw <- volumeSegmentIndexService.getSegmentToBucketIndexWithEmptyFallbackWithoutBuffer(
              fallbackLayer,
              tracingId,
              a.id,
              mag,
              None,
              mappingName,
              editableMappingTracingId(volumeTracing, tracingId),
              additionalCoordinates,
              dataLayer.additionalAxes,
              userToken
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

  private def revertToVolumeVersion(tracingId: String,
                                    sourceVersion: Long,
                                    newVersion: Long,
                                    tracing: VolumeTracing,
                                    userToken: Option[String]): Fox[VolumeTracing] = {

    val dataLayer = volumeTracingLayer(tracingId, tracing)
    val bucketStream = dataLayer.volumeBucketProvider.bucketStreamWithVersion()

    for {
      fallbackLayer <- getFallbackLayer(tracingId)
      segmentIndexBuffer = new VolumeSegmentIndexBuffer(tracingId,
                                                        volumeSegmentIndexClient,
                                                        newVersion,
                                                        remoteDatastoreClient,
                                                        fallbackLayer,
                                                        dataLayer.additionalAxes,
                                                        userToken)
      sourceTracing <- find(tracingId, Some(sourceVersion))
      mappingName <- baseMappingName(sourceTracing)
      _ <- Fox.serialCombined(bucketStream) {
        case (bucketPosition, dataBeforeRevert, version) =>
          if (version > sourceVersion) {
            loadBucket(dataLayer, bucketPosition, Some(sourceVersion)).futureBox.map {
              case Full(dataAfterRevert) =>
                for {
                  _ <- saveBucket(dataLayer, bucketPosition, dataAfterRevert, newVersion)
                  _ <- Fox.runIfOptionTrue(tracing.hasSegmentIndex)(
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
                  dataAfterRevert <- Fox.successful(Array[Byte](0))
                  _ <- saveBucket(dataLayer, bucketPosition, dataAfterRevert, newVersion)
                  _ <- Fox.runIfOptionTrue(tracing.hasSegmentIndex)(
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
    } yield sourceTracing
  }

  def initializeWithDataMultiple(tracingId: String,
                                 tracing: VolumeTracing,
                                 initialData: File,
                                 userToken: Option[String])(implicit mp: MessagesProvider): Fox[Set[Vec3Int]] =
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
        mappingName <- baseMappingName(tracing)
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
              fallbackLayer <- getFallbackLayer(tracingId)
              segmentIndexBuffer = new VolumeSegmentIndexBuffer(
                tracingId,
                volumeSegmentIndexClient,
                tracing.version,
                remoteDatastoreClient,
                fallbackLayer,
                AdditionalAxis.fromProtosAsOpt(tracing.additionalAxes),
                userToken
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
                         magRestrictions: MagRestrictions,
                         userToken: Option[String]): Fox[Set[Vec3Int]] =
    if (tracing.version != 0L) {
      Failure("Tracing has already been edited.")
    } else {
      val dataLayer = volumeTracingLayer(tracingId, tracing)
      val savedMags = new mutable.HashSet[Vec3Int]()
      for {
        fallbackLayer <- getFallbackLayer(tracingId)
        mappingName <- baseMappingName(tracing)
        segmentIndexBuffer = new VolumeSegmentIndexBuffer(
          tracingId,
          volumeSegmentIndexClient,
          tracing.version,
          remoteDatastoreClient,
          fallbackLayer,
          AdditionalAxis.fromProtosAsOpt(tracing.additionalAxes),
          userToken
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

  def allDataZip(tracingId: String,
                 tracing: VolumeTracing,
                 volumeDataZipFormat: VolumeDataZipFormat,
                 voxelSize: Option[VoxelSize])(implicit ec: ExecutionContext): Fox[Files.TemporaryFile] = {
    val zipped = temporaryFileCreator.create(tracingId, ".zip")
    val os = new BufferedOutputStream(new FileOutputStream(new File(zipped.path.toString)))
    allDataToOutputStream(tracingId, tracing, volumeDataZipFormat, voxelSize, os).map(_ => zipped)
  }

  private def allDataToOutputStream(tracingId: String,
                                    tracing: VolumeTracing,
                                    volumeDataZipFormmat: VolumeDataZipFormat,
                                    voxelSize: Option[VoxelSize],
                                    os: OutputStream)(implicit ec: ExecutionContext): Fox[Unit] = {
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

  def isTemporaryTracing(tracingId: String): Fox[Boolean] =
    temporaryTracingIdStore.contains(temporaryIdKey(tracingId))

  def data(tracingId: String,
           tracing: VolumeTracing,
           dataRequests: DataRequestCollection,
           includeFallbackDataIfAvailable: Boolean = false,
           userToken: Option[String] = None): Fox[(Array[Byte], List[Int])] =
    for {
      isTemporaryTracing <- isTemporaryTracing(tracingId)
      dataLayer = volumeTracingLayer(tracingId, tracing, isTemporaryTracing, includeFallbackDataIfAvailable, userToken)
      requests = dataRequests.map(r =>
        DataServiceDataRequest(null, dataLayer, r.cuboid(dataLayer), r.settings.copy(appliedAgglomerate = None)))
      data <- binaryDataService.handleDataRequests(requests)
    } yield data

  def duplicate(tracingId: String,
                sourceTracing: VolumeTracing,
                fromTask: Boolean,
                datasetBoundingBox: Option[BoundingBox],
                magRestrictions: MagRestrictions,
                editPosition: Option[Vec3Int],
                editRotation: Option[Vec3Double],
                boundingBox: Option[BoundingBox],
                mappingName: Option[String],
                userToken: Option[String]): Fox[(String, VolumeTracing)] = {
    val tracingWithBB = addBoundingBoxFromTaskIfRequired(sourceTracing, fromTask, datasetBoundingBox)
    val tracingWithMagRestrictions = restrictMagList(tracingWithBB, magRestrictions)
    for {
      fallbackLayer <- getFallbackLayer(tracingId)
      hasSegmentIndex <- VolumeSegmentIndexService.canHaveSegmentIndex(remoteDatastoreClient, fallbackLayer, userToken)
      newTracing = tracingWithMagRestrictions.copy(
        createdTimestamp = System.currentTimeMillis(),
        editPosition = editPosition.map(vec3IntToProto).getOrElse(tracingWithMagRestrictions.editPosition),
        editRotation = editRotation.map(vec3DoubleToProto).getOrElse(tracingWithMagRestrictions.editRotation),
        boundingBox = boundingBoxOptToProto(boundingBox).getOrElse(tracingWithMagRestrictions.boundingBox),
        mappingName = mappingName.orElse(tracingWithMagRestrictions.mappingName),
        version = 0,
        // Adding segment index on duplication if the volume tracing allows it. This will be used in duplicateData
        hasSegmentIndex = Some(hasSegmentIndex)
      )
      _ <- bool2Fox(newTracing.mags.nonEmpty) ?~> "magRestrictions.tooTight"
      newId <- save(newTracing, None, newTracing.version)
      _ <- duplicateData(tracingId, sourceTracing, newId, newTracing, userToken)
    } yield (newId, newTracing)
  }

  @SuppressWarnings(Array("OptionGet")) //We suppress this warning because we check the option beforehand
  private def addBoundingBoxFromTaskIfRequired(tracing: VolumeTracing,
                                               fromTask: Boolean,
                                               datasetBoundingBox: Option[BoundingBox]): VolumeTracing =
    if (fromTask && datasetBoundingBox.isDefined) {
      val newId = if (tracing.userBoundingBoxes.isEmpty) 1 else tracing.userBoundingBoxes.map(_.id).max + 1
      tracing
        .addUserBoundingBoxes(
          NamedBoundingBoxProto(newId,
                                Some("task bounding box"),
                                Some(true),
                                Some(getRandomColor),
                                tracing.boundingBox))
        .withBoundingBox(datasetBoundingBox.get)
    } else tracing

  private def duplicateData(sourceId: String,
                            sourceTracing: VolumeTracing,
                            destinationId: String,
                            destinationTracing: VolumeTracing,
                            userToken: Option[String]): Fox[Unit] =
    for {
      isTemporaryTracing <- isTemporaryTracing(sourceId)
      sourceDataLayer = volumeTracingLayer(sourceId, sourceTracing, isTemporaryTracing)
      buckets: Iterator[(BucketPosition, Array[Byte])] = sourceDataLayer.bucketProvider.bucketStream()
      destinationDataLayer = volumeTracingLayer(destinationId, destinationTracing)
      fallbackLayer <- getFallbackLayer(sourceId)
      segmentIndexBuffer = new VolumeSegmentIndexBuffer(
        destinationId,
        volumeSegmentIndexClient,
        destinationTracing.version,
        remoteDatastoreClient,
        fallbackLayer,
        AdditionalAxis.fromProtosAsOpt(sourceTracing.additionalAxes),
        userToken
      )
      mappingName <- baseMappingName(sourceTracing)
      _ <- Fox.serialCombined(buckets) {
        case (bucketPosition, bucketData) =>
          if (destinationTracing.mags.contains(vec3IntToProto(bucketPosition.mag))) {
            for {
              _ <- saveBucket(destinationDataLayer, bucketPosition, bucketData, destinationTracing.version)
              _ <- Fox.runIfOptionTrue(destinationTracing.hasSegmentIndex)(
                updateSegmentIndex(
                  segmentIndexBuffer,
                  bucketPosition,
                  bucketData,
                  Empty,
                  sourceTracing.elementClass,
                  mappingName,
                  editableMappingTracingId(sourceTracing, sourceId)
                ))
            } yield ()
          } else Fox.successful(())
      }
      _ <- segmentIndexBuffer.flush()
    } yield ()

  private def volumeTracingLayer(tracingId: String,
                                 tracing: VolumeTracing,
                                 isTemporaryTracing: Boolean = false,
                                 includeFallbackDataIfAvailable: Boolean = false,
                                 userToken: Option[String] = None): VolumeTracingLayer =
    VolumeTracingLayer(
      name = tracingId,
      isTemporaryTracing = isTemporaryTracing,
      volumeTracingService = this,
      includeFallbackDataIfAvailable = includeFallbackDataIfAvailable,
      tracing = tracing,
      userToken = userToken,
      additionalAxes = AdditionalAxis.fromProtosAsOpt(tracing.additionalAxes)
    )

  def updateActionLog(tracingId: String,
                      newestVersion: Option[Long] = None,
                      oldestVersion: Option[Long] = None): Fox[JsValue] = {
    def versionedTupleToJson(tuple: (Long, List[CompactVolumeUpdateAction])): JsObject =
      Json.obj(
        "version" -> tuple._1,
        "value" -> Json.toJson(tuple._2)
      )

    for {
      volumeTracings <- tracingDataStore.volumeUpdates.getMultipleVersionsAsVersionValueTuple(
        tracingId,
        newestVersion,
        oldestVersion)(fromJsonBytes[List[CompactVolumeUpdateAction]])
      updateActionGroupsJs = volumeTracings.map(versionedTupleToJson)
    } yield Json.toJson(updateActionGroupsJs)
  }

  def updateMagList(tracingId: String,
                    tracing: VolumeTracing,
                    mags: Set[Vec3Int],
                    toCache: Boolean = false): Fox[String] =
    for {
      _ <- bool2Fox(tracing.version == 0L) ?~> "Tracing has already been edited."
      _ <- bool2Fox(mags.nonEmpty) ?~> "Mag restrictions result in zero mags"
      id <- save(tracing.copy(mags = mags.toList.sortBy(_.maxDim).map(vec3IntToProto)),
                 Some(tracingId),
                 tracing.version,
                 toCache)
    } yield id

  def downsample(tracingId: String,
                 oldTracingId: String,
                 tracing: VolumeTracing,
                 userToken: Option[String]): Fox[Unit] =
    for {
      resultingMags <- downsampleWithLayer(tracingId,
                                           oldTracingId,
                                           tracing,
                                           volumeTracingLayer(tracingId, tracing),
                                           this,
                                           userToken)
      _ <- updateMagList(tracingId, tracing, resultingMags.toSet)
    } yield ()

  def volumeBucketsAreEmpty(tracingId: String): Boolean =
    volumeDataStore.getMultipleKeys(None, Some(tracingId), limit = Some(1))(toBox).isEmpty

  def createAdHocMesh(tracingId: String,
                      request: WebknossosAdHocMeshRequest,
                      userToken: Option[String]): Fox[(Array[Float], List[Int])] =
    for {
      tracing <- find(tracingId) ?~> "tracing.notFound"
      segmentationLayer = volumeTracingLayer(tracingId,
                                             tracing,
                                             includeFallbackDataIfAvailable = true,
                                             userToken = userToken)
      adHocMeshRequest = AdHocMeshRequest(
        None,
        segmentationLayer,
        request.cuboid(segmentationLayer),
        request.segmentId,
        request.voxelSizeFactorInUnit,
        None,
        None,
        request.additionalCoordinates,
        request.findNeighbors
      )
      result <- adHocMeshService.requestAdHocMeshViaActor(adHocMeshRequest)
    } yield result

  def findData(tracingId: String): Fox[Option[Vec3Int]] =
    for {
      tracing <- find(tracingId) ?~> "tracing.notFound"
      volumeLayer = volumeTracingLayer(tracingId, tracing)
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
            newEditableMappingIdOpt: Option[String]): Box[VolumeTracing] = {
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
        version = 0L,
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

  private def bucketStreamFromSelector(selector: TracingSelector,
                                       tracing: VolumeTracing): Iterator[(BucketPosition, Array[Byte])] = {
    val dataLayer = volumeTracingLayer(selector.tracingId, tracing)
    dataLayer.bucketProvider.bucketStream(Some(tracing.version))
  }

  def mergeVolumeData(tracingSelectors: Seq[TracingSelector],
                      tracings: Seq[VolumeTracing],
                      newId: String,
                      newVersion: Long,
                      toCache: Boolean,
                      userToken: Option[String])(implicit mp: MessagesProvider): Fox[MergedVolumeStats] = {
    val elementClass = tracings.headOption.map(_.elementClass).getOrElse(elementClassToProto(ElementClass.uint8))

    val magSets = new mutable.HashSet[Set[Vec3Int]]()
    tracingSelectors.zip(tracings).foreach {
      case (selector, tracing) =>
        val magSet = new mutable.HashSet[Vec3Int]()
        bucketStreamFromSelector(selector, tracing).foreach {
          case (bucketPosition, _) =>
            magSet.add(bucketPosition.mag)
        }
        if (magSet.nonEmpty) { // empty tracings should have no impact in this check
          magSets.add(magSet.toSet)
        }
    }

    val shouldCreateSegmentIndex = volumeSegmentIndexService.shouldCreateSegmentIndexForMerged(tracings)

    logger.info(
      s"Merging ${tracings.length} volume tracings into new $newId. CreateSegmentIndex = $shouldCreateSegmentIndex")

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

      tracingSelectors.zip(tracings).foreach {
        case (selector, tracing) =>
          val bucketStream = bucketStreamFromSelector(selector, tracing)
          mergedVolume.addLabelSetFromBucketStream(bucketStream, magsIntersection)
      }

      tracingSelectors.zip(tracings).zipWithIndex.foreach {
        case ((selector, tracing), sourceVolumeIndex) =>
          val bucketStream = bucketStreamFromSelector(selector, tracing)
          mergedVolume.addFromBucketStream(sourceVolumeIndex, bucketStream, Some(magsIntersection))
      }
      for {
        _ <- bool2Fox(ElementClass.largestSegmentIdIsInRange(mergedVolume.largestSegmentId.toLong, elementClass)) ?~> Messages(
          "annotation.volume.largestSegmentIdExceedsRange",
          mergedVolume.largestSegmentId.toLong,
          elementClass)
        mergedAdditionalAxes <- Fox.box2Fox(AdditionalAxis.mergeAndAssertSameAdditionalAxes(tracings.map(t =>
          AdditionalAxis.fromProtosAsOpt(t.additionalAxes))))
        fallbackLayer <- getFallbackLayer(tracingSelectors.head.tracingId)
        segmentIndexBuffer = new VolumeSegmentIndexBuffer(newId,
                                                          volumeSegmentIndexClient,
                                                          newVersion,
                                                          remoteDatastoreClient,
                                                          fallbackLayer,
                                                          mergedAdditionalAxes,
                                                          userToken)
        _ <- mergedVolume.withMergedBuckets { (bucketPosition, bucketBytes) =>
          for {
            _ <- saveBucket(newId, elementClass, bucketPosition, bucketBytes, newVersion, toCache, mergedAdditionalAxes)
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
      } yield mergedVolume.stats(shouldCreateSegmentIndex)
    }
  }

  def addSegmentIndex(tracingId: String,
                      tracing: VolumeTracing,
                      currentVersion: Long,
                      userToken: Option[String],
                      dryRun: Boolean): Fox[Option[Int]] = {
    var processedBucketCount = 0
    for {
      isTemporaryTracing <- isTemporaryTracing(tracingId)
      sourceDataLayer = volumeTracingLayer(tracingId, tracing, isTemporaryTracing)
      buckets: Iterator[(BucketPosition, Array[Byte])] = sourceDataLayer.bucketProvider.bucketStream()
      fallbackLayer <- getFallbackLayer(tracingId)
      mappingName <- baseMappingName(tracing)
      segmentIndexBuffer = new VolumeSegmentIndexBuffer(tracingId,
                                                        volumeSegmentIndexClient,
                                                        currentVersion + 1L,
                                                        remoteDatastoreClient,
                                                        fallbackLayer,
                                                        sourceDataLayer.additionalAxes,
                                                        userToken)
      _ <- Fox.serialCombined(buckets) {
        case (bucketPosition, bucketData) =>
          processedBucketCount += 1
          updateSegmentIndex(segmentIndexBuffer,
                             bucketPosition,
                             bucketData,
                             Empty,
                             tracing.elementClass,
                             mappingName,
                             editableMappingTracingId(tracing, tracingId))
      }
      _ <- Fox.runIf(!dryRun)(segmentIndexBuffer.flush())
      updateGroup = UpdateActionGroup[VolumeTracing](
        tracing.version + 1L,
        System.currentTimeMillis(),
        None,
        List(AddSegmentIndex()),
        None,
        None,
        "dummyTransactionId",
        1,
        0
      )
      _ <- Fox.runIf(!dryRun)(handleUpdateGroup(tracingId, updateGroup, tracing.version, userToken))
    } yield Some(processedBucketCount)
  }

  def checkIfSegmentIndexMayBeAdded(tracingId: String, tracing: VolumeTracing, userToken: Option[String])(
      implicit ec: ExecutionContext): Fox[Boolean] =
    for {
      fallbackLayerOpt <- Fox.runIf(tracing.fallbackLayer.isDefined)(
        remoteFallbackLayerFromVolumeTracing(tracing, tracingId))
      canHaveSegmentIndex <- VolumeSegmentIndexService.canHaveSegmentIndex(remoteDatastoreClient,
                                                                           fallbackLayerOpt,
                                                                           userToken)
      alreadyHasSegmentIndex = tracing.hasSegmentIndex.getOrElse(false)
    } yield canHaveSegmentIndex && !alreadyHasSegmentIndex

  def importVolumeData(tracingId: String,
                       tracing: VolumeTracing,
                       zipFile: File,
                       currentVersion: Int,
                       userToken: Option[String])(implicit mp: MessagesProvider): Fox[Long] =
    if (currentVersion != tracing.version)
      Fox.failure("version.mismatch")
    else {
      val magSet = magSetFromZipfile(zipFile)
      val magsDoMatch =
        magSet.isEmpty || magSet == resolveLegacyMagList(tracing.mags).map(vec3IntFromProto).toSet

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
          fallbackLayer <- getFallbackLayer(tracingId)
          mappingName <- baseMappingName(tracing)
          segmentIndexBuffer <- Fox.successful(
            new VolumeSegmentIndexBuffer(tracingId,
                                         volumeSegmentIndexClient,
                                         tracing.version + 1,
                                         remoteDatastoreClient,
                                         fallbackLayer,
                                         dataLayer.additionalAxes,
                                         userToken))
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
          updateGroup = UpdateActionGroup[VolumeTracing](
            tracing.version + 1,
            System.currentTimeMillis(),
            None,
            List(ImportVolumeData(Some(mergedVolume.largestSegmentId.toPositiveLong))),
            None,
            None,
            "dummyTransactionId",
            1,
            0
          )
          _ <- handleUpdateGroup(tracingId, updateGroup, tracing.version, userToken)
        } yield mergedVolume.largestSegmentId.toPositiveLong
      }
    }

  def dummyTracing: VolumeTracing = ???

  def mergeEditableMappings(tracingsWithIds: List[(VolumeTracing, String)], userToken: Option[String]): Fox[String] =
    if (tracingsWithIds.forall(tracingWithId => tracingWithId._1.getHasEditableMapping)) {
      for {
        remoteFallbackLayers <- Fox.serialCombined(tracingsWithIds)(tracingWithId =>
          remoteFallbackLayerFromVolumeTracing(tracingWithId._1, tracingWithId._2))
        remoteFallbackLayer <- remoteFallbackLayers.headOption.toFox
        _ <- bool2Fox(remoteFallbackLayers.forall(_ == remoteFallbackLayer)) ?~> "Cannot merge editable mappings based on different dataset layers"
        editableMappingIds <- Fox.serialCombined(tracingsWithIds)(tracingWithId => tracingWithId._1.mappingName)
        _ <- bool2Fox(editableMappingIds.length == tracingsWithIds.length) ?~> "Not all volume tracings have editable mappings"
        newEditableMappingId <- editableMappingService.merge(editableMappingIds, remoteFallbackLayer, userToken)
      } yield newEditableMappingId
    } else if (tracingsWithIds.forall(tracingWithId => !tracingWithId._1.getHasEditableMapping)) {
      Fox.empty
    } else {
      Fox.failure("Cannot merge tracings with and without editable mappings")
    }

  def getFallbackLayer(tracingId: String): Fox[Option[RemoteFallbackLayer]] =
    fallbackLayerCache.getOrLoad(tracingId, t => getFallbackLayerFromWebknossos(t))

  private def getFallbackLayerFromWebknossos(tracingId: String) = Fox[Option[RemoteFallbackLayer]] {
    for {
      tracing <- find(tracingId)
      dataSource <- remoteWebknossosClient.getDataSourceForTracing(tracingId)
      dataSourceId = dataSource.id
      fallbackLayerName = tracing.fallbackLayer
      fallbackLayer = dataSource.dataLayers
        .find(_.name == fallbackLayerName.getOrElse(""))
        .map(RemoteFallbackLayer.fromDataLayerAndDataSource(_, dataSourceId))
    } yield fallbackLayer
  }

}
