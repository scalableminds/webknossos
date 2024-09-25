package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.io.{NamedStream, ZipIO}
import com.scalableminds.util.time.Instant
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
  BucketPosition,
  UnsignedInteger,
  UnsignedIntegerArray,
  VoxelSize,
  WebknossosAdHocMeshRequest
}
import com.scalableminds.webknossos.datastore.services._
import com.scalableminds.webknossos.tracingstore.annotation.{TSAnnotationService, UpdateActionGroup}
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
import java.util.Base64
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
    val annotationService: TSAnnotationService,
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
    with LazyLogging {

  implicit val volumeDataStore: FossilDBClient = tracingDataStore.volumeData

  implicit val tracingCompanion: VolumeTracing.type = VolumeTracing

  val tracingType: TracingType = TracingType.volume

  val tracingStore: FossilDBClient = tracingDataStore.volumes

  protected val volumeSegmentIndexClient: FossilDBClient = tracingDataStore.volumeSegmentIndex

  /* We want to reuse the bucket loading methods from binaryDataService for the volume tracings, however, it does not
     actually load anything from disk, unlike its “normal” instance in the datastore (only from the volume tracing store) */
  private val binaryDataService = new BinaryDataService(Paths.get(""), None, None, None, None, None)

  adHocMeshServiceHolder.tracingStoreAdHocMeshConfig = (binaryDataService, 30 seconds, 1)
  val adHocMeshService: AdHocMeshService = adHocMeshServiceHolder.tracingStoreAdHocMeshService

  private val fallbackLayerCache: AlfuCache[(String, String, Option[String]), Option[RemoteFallbackLayer]] = AlfuCache(
    maxCapacity = 100)

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

  def applyBucketMutatingActions(annotationId: String,
                                 updateActions: List[BucketMutatingVolumeUpdateAction],
                                 newVersion: Long)(implicit tc: TokenContext): Fox[Unit] =
    for {
      // warning, may be called multiple times with the same version number (due to transaction management).
      // frontend ensures that each bucket is only updated once per transaction
      tracingId <- updateActions.headOption.map(_.actionTracingId).toFox
      fallbackLayerOpt <- getFallbackLayer(annotationId, tracingId)
      tracing <- find(annotationId, tracingId) ?~> "tracing.notFound"
      segmentIndexBuffer = new VolumeSegmentIndexBuffer(
        tracingId,
        volumeSegmentIndexClient,
        newVersion,
        remoteDatastoreClient,
        fallbackLayerOpt,
        AdditionalAxis.fromProtosAsOpt(tracing.additionalAxes),
        tc
      )
      _ <- Fox.serialCombined(updateActions) {
        case a: UpdateBucketVolumeAction =>
          if (tracing.getHasEditableMapping) {
            Fox.failure("Cannot mutate volume data in annotation with editable mapping.")
          } else
            updateBucket(tracingId, tracing, a, segmentIndexBuffer, newVersion) ?~> "Failed to save volume data."
        //case a: RevertToVersionVolumeAction => revertToVolumeVersion(tracingId, a.sourceVersion, updateGroup.version, tracing, userToken)
        case a: DeleteSegmentDataVolumeAction =>
          if (!tracing.getHasSegmentIndex) {
            Fox.failure("Cannot delete segment data for annotations without segment index.")
          } else
            deleteSegmentData(annotationId, tracingId, tracing, a, segmentIndexBuffer, newVersion) ?~> "Failed to delete segment data."
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
      mappingName <- baseMappingName(volumeTracing)
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
    } yield volumeTracing

  def find(annotationId: String,
           tracingId: String,
           version: Option[Long] = None,
           useCache: Boolean = true,
           applyUpdates: Boolean = false)(implicit tc: TokenContext): Fox[VolumeTracing] =
    if (tracingId == TracingIds.dummyTracingId)
      Fox.successful(dummyTracing)
    else {
      for {
        annotation <- annotationService.getWithTracings(annotationId, version, List.empty, List(tracingId)) // TODO is applyUpdates still needed?
        tracing <- annotation.getVolume(tracingId)
      } yield tracing
    }

  override def editableMappingTracingId(tracing: VolumeTracing, tracingId: String): Option[String] =
    if (tracing.getHasEditableMapping) Some(tracingId) else None

  override def baseMappingName(tracing: VolumeTracing): Fox[Option[String]] =
    if (tracing.getHasEditableMapping)
      tracing.mappingName.map(editableMappingService.getBaseMappingName).getOrElse(Fox.successful(None))
    else Fox.successful(tracing.mappingName)

  private def deleteSegmentData(annotationId: String,
                                tracingId: String,
                                volumeTracing: VolumeTracing,
                                a: DeleteSegmentDataVolumeAction,
                                segmentIndexBuffer: VolumeSegmentIndexBuffer,
                                version: Long)(implicit tc: TokenContext): Fox[VolumeTracing] =
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
      _ <- Fox.serialCombined(volumeTracing.resolutions.toList)(resolution =>
        Fox.serialCombined(additionalCoordinateList)(additionalCoordinates => {
          val mag = vec3IntFromProto(resolution)
          for {
            fallbackLayer <- getFallbackLayer(annotationId, tracingId)
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
    } yield volumeTracing

  private def assertMagIsValid(tracing: VolumeTracing, mag: Vec3Int): Fox[Unit] =
    if (tracing.resolutions.nonEmpty) {
      bool2Fox(tracing.resolutions.exists(r => vec3IntFromProto(r) == mag))
    } else { // old volume tracings do not have a mag list, no assert possible. Check compatibility by asserting isotropic mag
      bool2Fox(mag.isIsotropic)
    }

  /*
  // TODO
  private def revertToVolumeVersion(annotationId: String,
                                    tracingId: String,
                                    sourceVersion: Long,
                                    newVersion: Long,
                                    tracing: VolumeTracing)(implicit tc: TokenContext): Fox[VolumeTracing] = {

    val dataLayer = volumeTracingLayer(tracingId, tracing)
    val bucketStream = dataLayer.volumeBucketProvider.bucketStreamWithVersion()

    for {
      fallbackLayer <- getFallbackLayer(annotationId, tracingId)
      segmentIndexBuffer = new VolumeSegmentIndexBuffer(tracingId,
                                                        volumeSegmentIndexClient,
                                                        newVersion,
                                                        remoteDatastoreClient,
                                                        fallbackLayer,
                                                        dataLayer.additionalAxes,
                                                        tc)
      sourceTracing <- find(annotationId, tracingId, Some(sourceVersion))
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
                  dataAfterRevert <- Fox.successful(revertedValue)
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
   */

  def initializeWithDataMultiple(annotationId: String, tracingId: String, tracing: VolumeTracing, initialData: File)(
      implicit mp: MessagesProvider,
      tc: TokenContext): Fox[Set[Vec3Int]] =
    if (tracing.version != 0L)
      Failure("Tracing has already been edited.")
    else {
      val resolutionSets = new mutable.HashSet[Set[Vec3Int]]()
      for {
        _ <- withZipsFromMultiZipAsync(initialData) { (_, dataZip) =>
          for {
            _ <- Fox.successful(())
            resolutionSet = resolutionSetFromZipfile(dataZip)
            _ = if (resolutionSet.nonEmpty) resolutionSets.add(resolutionSet)
          } yield ()
        }
        mappingName <- baseMappingName(tracing)
        resolutions <-
        // if none of the tracings contained any volume data do not save buckets, use full resolution list, as already initialized on wk-side
        if (resolutionSets.isEmpty)
          Fox.successful(tracing.resolutions.map(vec3IntFromProto).toSet)
        else {
          val resolutionsDoMatch = resolutionSets.headOption.forall { head =>
            resolutionSets.forall(_ == head)
          }
          if (!resolutionsDoMatch)
            Fox.failure("annotation.volume.resolutionsDoNotMatch")
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
              fallbackLayer <- getFallbackLayer(annotationId, tracingId)
              segmentIndexBuffer = new VolumeSegmentIndexBuffer(
                tracingId,
                volumeSegmentIndexClient,
                tracing.version,
                remoteDatastoreClient,
                fallbackLayer,
                AdditionalAxis.fromProtosAsOpt(tracing.additionalAxes),
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
            } yield mergedVolume.presentResolutions
          }
        }
      } yield resolutions
    }

  def initializeWithData(annotationId: String,
                         tracingId: String,
                         tracing: VolumeTracing,
                         initialData: File,
                         resolutionRestrictions: ResolutionRestrictions)(implicit tc: TokenContext): Fox[Set[Vec3Int]] =
    if (tracing.version != 0L) {
      Failure("Tracing has already been edited.")
    } else {
      val dataLayer = volumeTracingLayer(tracingId, tracing)
      val savedResolutions = new mutable.HashSet[Vec3Int]()
      for {
        fallbackLayer <- getFallbackLayer(annotationId, tracingId)
        mappingName <- baseMappingName(tracing)
        segmentIndexBuffer = new VolumeSegmentIndexBuffer(
          tracingId,
          volumeSegmentIndexClient,
          tracing.version,
          remoteDatastoreClient,
          fallbackLayer,
          AdditionalAxis.fromProtosAsOpt(tracing.additionalAxes),
          tc
        )
        _ <- withBucketsFromZip(initialData) { (bucketPosition, bytes) =>
          if (resolutionRestrictions.isForbidden(bucketPosition.mag)) {
            Fox.successful(())
          } else {
            savedResolutions.add(bucketPosition.mag)
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
        if (savedResolutions.isEmpty) {
          resolutionSetFromZipfile(initialData)
        } else {
          savedResolutions.toSet
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
          tracing.resolutions.map(mag => vec3IntFromProto(mag)))
      case VolumeDataZipFormat.zarr3 =>
        new Zarr3BucketStreamSink(dataLayer, tracing.fallbackLayer.nonEmpty)(
          dataLayer.bucketProvider.bucketStream(Some(tracing.version)),
          tracing.resolutions.map(mag => vec3IntFromProto(mag)),
          voxelSize)
    }

    val before = Instant.now
    val zipResult = ZipIO.zip(buckets, os, level = Deflater.BEST_SPEED)

    zipResult.onComplete {
      case b: scala.util.Success[Box[Unit]] =>
        logger.info(s"Zipping volume data for $tracingId took ${Instant.since(before)} ms. Result: ${b.get}")
      case _ => ()
    }
    zipResult
  }

  def isTemporaryTracing(tracingId: String): Fox[Boolean] =
    temporaryTracingIdStore.contains(temporaryIdKey(tracingId))

  def data(tracingId: String,
           tracing: VolumeTracing,
           dataRequests: DataRequestCollection,
           includeFallbackDataIfAvailable: Boolean = false)(implicit tc: TokenContext): Fox[(Array[Byte], List[Int])] =
    for {
      isTemporaryTracing <- isTemporaryTracing(tracingId)
      dataLayer = volumeTracingLayer(tracingId, tracing, isTemporaryTracing, includeFallbackDataIfAvailable)
      requests = dataRequests.map(r =>
        DataServiceDataRequest(null, dataLayer, r.cuboid(dataLayer), r.settings.copy(appliedAgglomerate = None)))
      data <- binaryDataService.handleDataRequests(requests)
    } yield data

  def duplicate(annotationId: String,
                tracingId: String,
                newTracingId: String,
                sourceTracing: VolumeTracing,
                fromTask: Boolean,
                datasetBoundingBox: Option[BoundingBox],
                resolutionRestrictions: ResolutionRestrictions,
                editPosition: Option[Vec3Int],
                editRotation: Option[Vec3Double],
                boundingBox: Option[BoundingBox],
                mappingName: Option[String])(implicit tc: TokenContext): Fox[(String, VolumeTracing)] = {
    val tracingWithBB = addBoundingBoxFromTaskIfRequired(sourceTracing, fromTask, datasetBoundingBox)
    val tracingWithResolutionRestrictions = restrictMagList(tracingWithBB, resolutionRestrictions)
    for {
      fallbackLayer <- getFallbackLayer(annotationId, tracingId)
      hasSegmentIndex <- VolumeSegmentIndexService.canHaveSegmentIndex(remoteDatastoreClient, fallbackLayer)
      newTracing = tracingWithResolutionRestrictions.copy(
        createdTimestamp = System.currentTimeMillis(),
        editPosition = editPosition.map(vec3IntToProto).getOrElse(tracingWithResolutionRestrictions.editPosition),
        editRotation = editRotation.map(vec3DoubleToProto).getOrElse(tracingWithResolutionRestrictions.editRotation),
        boundingBox = boundingBoxOptToProto(boundingBox).getOrElse(tracingWithResolutionRestrictions.boundingBox),
        mappingName = mappingName.orElse(
          if (sourceTracing.getHasEditableMapping) Some(newTracingId)
          else tracingWithResolutionRestrictions.mappingName),
        version = 0,
        // Adding segment index on duplication if the volume tracing allows it. This will be used in duplicateData
        hasSegmentIndex = Some(hasSegmentIndex)
      )
      _ <- bool2Fox(newTracing.resolutions.nonEmpty) ?~> "resolutionRestrictions.tooTight"
      newId <- save(newTracing, Some(newTracingId), newTracing.version)
      _ <- duplicateData(annotationId, tracingId, sourceTracing, newId, newTracing)
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

  private def duplicateData(annotationId: String,
                            sourceId: String,
                            sourceTracing: VolumeTracing,
                            destinationId: String,
                            destinationTracing: VolumeTracing)(implicit tc: TokenContext): Fox[Unit] =
    for {
      isTemporaryTracing <- isTemporaryTracing(sourceId)
      sourceDataLayer = volumeTracingLayer(sourceId, sourceTracing, isTemporaryTracing)
      buckets: Iterator[(BucketPosition, Array[Byte])] = sourceDataLayer.bucketProvider.bucketStream()
      destinationDataLayer = volumeTracingLayer(destinationId, destinationTracing)
      fallbackLayer <- getFallbackLayer(annotationId, sourceId)
      segmentIndexBuffer = new VolumeSegmentIndexBuffer(
        destinationId,
        volumeSegmentIndexClient,
        destinationTracing.version,
        remoteDatastoreClient,
        fallbackLayer,
        AdditionalAxis.fromProtosAsOpt(sourceTracing.additionalAxes),
        tc
      )
      mappingName <- baseMappingName(sourceTracing)
      _ <- Fox.serialCombined(buckets) {
        case (bucketPosition, bucketData) =>
          if (destinationTracing.resolutions.contains(vec3IntToProto(bucketPosition.mag))) {
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

  private def volumeTracingLayer(
      tracingId: String,
      tracing: VolumeTracing,
      isTemporaryTracing: Boolean = false,
      includeFallbackDataIfAvailable: Boolean = false)(implicit tc: TokenContext): VolumeTracingLayer =
    VolumeTracingLayer(
      name = tracingId,
      isTemporaryTracing = isTemporaryTracing,
      volumeTracingService = this,
      includeFallbackDataIfAvailable = includeFallbackDataIfAvailable,
      tracing = tracing,
      tokenContext = tc,
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

  def updateResolutionList(tracingId: String,
                           tracing: VolumeTracing,
                           resolutions: Set[Vec3Int],
                           toCache: Boolean = false): Fox[String] =
    for {
      _ <- bool2Fox(tracing.version == 0L) ?~> "Tracing has already been edited."
      _ <- bool2Fox(resolutions.nonEmpty) ?~> "Resolution restrictions result in zero resolutions"
      id <- save(tracing.copy(resolutions = resolutions.toList.sortBy(_.maxDim).map(vec3IntToProto)),
                 Some(tracingId),
                 tracing.version,
                 toCache)
    } yield id

  def downsample(annotationId: String, tracingId: String, oldTracingId: String, tracing: VolumeTracing)(
      implicit tc: TokenContext): Fox[Unit] =
    for {
      resultingResolutions <- downsampleWithLayer(annotationId,
                                                  tracingId,
                                                  oldTracingId,
                                                  tracing,
                                                  volumeTracingLayer(tracingId, tracing),
                                                  this)
      _ <- updateResolutionList(tracingId, tracing, resultingResolutions.toSet)
    } yield ()

  def volumeBucketsAreEmpty(tracingId: String): Boolean =
    volumeDataStore.getMultipleKeys(None, Some(tracingId), limit = Some(1))(toBox).isEmpty

  def createAdHocMesh(tracingId: String, tracing: VolumeTracing, request: WebknossosAdHocMeshRequest)(
      implicit tc: TokenContext): Fox[(Array[Float], List[Int])] = {
    val volumeLayer = volumeTracingLayer(tracingId, tracing, includeFallbackDataIfAvailable = true)
    val adHocMeshRequest = AdHocMeshRequest(
      None,
      volumeLayer,
      request.cuboid(volumeLayer),
      request.segmentId,
      request.voxelSizeFactorInUnit,
      None,
      None,
      request.additionalCoordinates,
      request.findNeighbors
    )
    adHocMeshService.requestAdHocMeshViaActor(adHocMeshRequest)
  }

  def findData(annotationId: String, tracingId: String)(implicit tc: TokenContext): Fox[Option[Vec3Int]] =
    for {
      tracing <- find(annotationId: String, tracingId) ?~> "tracing.notFound"
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

  private def bucketStreamFromSelector(selector: TracingSelector, tracing: VolumeTracing)(
      implicit tc: TokenContext): Iterator[(BucketPosition, Array[Byte])] = {
    val dataLayer = volumeTracingLayer(selector.tracingId, tracing)
    dataLayer.bucketProvider.bucketStream(Some(tracing.version))
  }

  def mergeVolumeData(tracingSelectors: Seq[TracingSelector],
                      tracings: Seq[VolumeTracing],
                      newId: String,
                      newVersion: Long,
                      toCache: Boolean)(implicit mp: MessagesProvider, tc: TokenContext): Fox[MergedVolumeStats] = {
    val elementClass = tracings.headOption.map(_.elementClass).getOrElse(elementClassToProto(ElementClass.uint8))

    val resolutionSets = new mutable.HashSet[Set[Vec3Int]]()
    tracingSelectors.zip(tracings).foreach {
      case (selector, tracing) =>
        val resolutionSet = new mutable.HashSet[Vec3Int]()
        bucketStreamFromSelector(selector, tracing).foreach {
          case (bucketPosition, _) =>
            resolutionSet.add(bucketPosition.mag)
        }
        if (resolutionSet.nonEmpty) { // empty tracings should have no impact in this check
          resolutionSets.add(resolutionSet.toSet)
        }
    }

    val shouldCreateSegmentIndex = volumeSegmentIndexService.shouldCreateSegmentIndexForMerged(tracings)

    logger.info(
      s"Merging ${tracings.length} volume tracings into new $newId. CreateSegmentIndex = $shouldCreateSegmentIndex")

    // If none of the tracings contained any volume data. Do not save buckets, do not touch resolution list
    if (resolutionSets.isEmpty)
      Fox.successful(MergedVolumeStats.empty(shouldCreateSegmentIndex))
    else {
      val resolutionsIntersection: Set[Vec3Int] = resolutionSets.headOption.map { head =>
        resolutionSets.foldLeft(head) { (acc, element) =>
          acc.intersect(element)
        }
      }.getOrElse(Set.empty)

      val mergedVolume = new MergedVolume(elementClass)

      tracingSelectors.zip(tracings).foreach {
        case (selector, tracing) =>
          val bucketStream = bucketStreamFromSelector(selector, tracing)
          mergedVolume.addLabelSetFromBucketStream(bucketStream, resolutionsIntersection)
      }

      tracingSelectors.zip(tracings).zipWithIndex.foreach {
        case ((selector, tracing), sourceVolumeIndex) =>
          val bucketStream = bucketStreamFromSelector(selector, tracing)
          mergedVolume.addFromBucketStream(sourceVolumeIndex, bucketStream, Some(resolutionsIntersection))
      }
      for {
        _ <- bool2Fox(ElementClass.largestSegmentIdIsInRange(mergedVolume.largestSegmentId.toLong, elementClass)) ?~> Messages(
          "annotation.volume.largestSegmentIdExceedsRange",
          mergedVolume.largestSegmentId.toLong,
          elementClass)
        mergedAdditionalAxes <- Fox.box2Fox(AdditionalAxis.mergeAndAssertSameAdditionalAxes(tracings.map(t =>
          AdditionalAxis.fromProtosAsOpt(t.additionalAxes))))
        fallbackLayer <- getFallbackLayer("dummyAnnotationId", tracingSelectors.head.tracingId) // TODO annotation id from selectors
        segmentIndexBuffer = new VolumeSegmentIndexBuffer(newId,
                                                          volumeSegmentIndexClient,
                                                          newVersion,
                                                          remoteDatastoreClient,
                                                          fallbackLayer,
                                                          mergedAdditionalAxes,
                                                          tc)
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

  def addSegmentIndex(annotationId: String,
                      tracingId: String,
                      tracing: VolumeTracing,
                      currentVersion: Long,
                      dryRun: Boolean)(implicit tc: TokenContext): Fox[Option[Int]] = {
    var processedBucketCount = 0
    for {
      isTemporaryTracing <- isTemporaryTracing(tracingId)
      sourceDataLayer = volumeTracingLayer(tracingId, tracing, isTemporaryTracing)
      buckets: Iterator[(BucketPosition, Array[Byte])] = sourceDataLayer.bucketProvider.bucketStream()
      fallbackLayer <- getFallbackLayer(annotationId, tracingId)
      mappingName <- baseMappingName(tracing)
      segmentIndexBuffer = new VolumeSegmentIndexBuffer(tracingId,
                                                        volumeSegmentIndexClient,
                                                        currentVersion + 1L,
                                                        remoteDatastoreClient,
                                                        fallbackLayer,
                                                        sourceDataLayer.additionalAxes,
                                                        tc)
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
      updateGroup = UpdateActionGroup(
        tracing.version + 1L,
        System.currentTimeMillis(),
        None,
        List(AddSegmentIndexVolumeAction(tracingId)),
        None,
        None,
        "dummyTransactionId",
        1,
        0
      )
      // TODO _ <- Fox.runIf(!dryRun)(handleUpdateGroup(tracingId, updateGroup, tracing.version, userToken))
    } yield Some(processedBucketCount)
  }

  def checkIfSegmentIndexMayBeAdded(tracingId: String, tracing: VolumeTracing)(implicit ec: ExecutionContext,
                                                                               tc: TokenContext): Fox[Boolean] =
    for {
      fallbackLayerOpt <- Fox.runIf(tracing.fallbackLayer.isDefined)(
        remoteFallbackLayerFromVolumeTracing(tracing, tracingId))
      canHaveSegmentIndex <- VolumeSegmentIndexService.canHaveSegmentIndex(remoteDatastoreClient, fallbackLayerOpt)
      alreadyHasSegmentIndex = tracing.hasSegmentIndex.getOrElse(false)
    } yield canHaveSegmentIndex && !alreadyHasSegmentIndex

  def importVolumeData(annotationId: String,
                       tracingId: String,
                       tracing: VolumeTracing,
                       zipFile: File,
                       currentVersion: Int)(implicit mp: MessagesProvider, tc: TokenContext): Fox[Long] =
    if (currentVersion != tracing.version)
      Fox.failure("version.mismatch")
    else {
      val resolutionSet = resolutionSetFromZipfile(zipFile)
      val resolutionsDoMatch =
        resolutionSet.isEmpty || resolutionSet == resolveLegacyResolutionList(tracing.resolutions)
          .map(vec3IntFromProto)
          .toSet

      if (!resolutionsDoMatch)
        Fox.failure("annotation.volume.resolutionsDoNotMatch")
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
          fallbackLayer <- getFallbackLayer(annotationId, tracingId)
          mappingName <- baseMappingName(tracing)
          segmentIndexBuffer <- Fox.successful(
            new VolumeSegmentIndexBuffer(tracingId,
                                         volumeSegmentIndexClient,
                                         tracing.version + 1,
                                         remoteDatastoreClient,
                                         fallbackLayer,
                                         dataLayer.additionalAxes,
                                         tc))
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
          updateGroup = UpdateActionGroup(
            tracing.version + 1,
            System.currentTimeMillis(),
            None,
            List(ImportVolumeDataVolumeAction(tracingId, Some(mergedVolume.largestSegmentId.toPositiveLong))),
            None,
            None,
            "dummyTransactionId",
            1,
            0
          )
          // TODO: _ <- handleUpdateGroup(tracingId, updateGroup, tracing.version, userToken)
        } yield mergedVolume.largestSegmentId.toPositiveLong
      }
    }

  def dummyTracing: VolumeTracing = ???

  def mergeEditableMappings(newTracingId: String, tracingsWithIds: List[(VolumeTracing, String)])(
      implicit tc: TokenContext): Fox[Unit] =
    if (tracingsWithIds.forall(tracingWithId => tracingWithId._1.getHasEditableMapping)) {
      for {
        remoteFallbackLayers <- Fox.serialCombined(tracingsWithIds)(tracingWithId =>
          remoteFallbackLayerFromVolumeTracing(tracingWithId._1, tracingWithId._2))
        remoteFallbackLayer <- remoteFallbackLayers.headOption.toFox
        _ <- bool2Fox(remoteFallbackLayers.forall(_ == remoteFallbackLayer)) ?~> "Cannot merge editable mappings based on different dataset layers"
        // TODO_ <- editableMappingService.merge(newTracingId, tracingsWithIds.map(_._2), remoteFallbackLayer)
      } yield ()
    } else if (tracingsWithIds.forall(tracingWithId => !tracingWithId._1.getHasEditableMapping)) {
      Fox.empty
    } else {
      Fox.failure("Cannot merge tracings with and without editable mappings")
    }

  def getFallbackLayer(annotationId: String, tracingId: String)(
      implicit tc: TokenContext): Fox[Option[RemoteFallbackLayer]] =
    fallbackLayerCache.getOrLoad((annotationId, tracingId, tc.userTokenOpt),
                                 t => getFallbackLayerFromWebknossos(t._1, t._2))

  private def getFallbackLayerFromWebknossos(annotationId: String, tracingId: String)(implicit tc: TokenContext) =
    Fox[Option[RemoteFallbackLayer]] {
      for {
        tracing <- find(annotationId, tracingId)
        dataSource <- remoteWebknossosClient.getDataSourceForTracing(tracingId)
        dataSourceId = dataSource.id
        fallbackLayerName = tracing.fallbackLayer
        fallbackLayer = dataSource.dataLayers
          .find(_.name == fallbackLayerName.getOrElse(""))
          .map(RemoteFallbackLayer.fromDataLayerAndDataSource(_, dataSourceId))
      } yield fallbackLayer
    }

}
