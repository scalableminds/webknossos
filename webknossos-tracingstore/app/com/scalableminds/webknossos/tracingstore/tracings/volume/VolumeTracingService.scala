package com.scalableminds.webknossos.tracingstore.tracings.volume

import java.io._
import java.nio.file.Paths
import java.util.zip.Deflater

import com.google.inject.Inject
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.io.{NamedStream, ZipIO}
import com.scalableminds.util.tools.{Fox, FoxImplicits, TextUtils}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.dataformats.wkw.{WKWBucketStreamSink, WKWDataFormatHelper}
import com.scalableminds.webknossos.datastore.geometry.NamedBoundingBoxProto
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.DataRequestCollection.DataRequestCollection
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import com.scalableminds.webknossos.datastore.models.requests.DataServiceDataRequest
import com.scalableminds.webknossos.datastore.models.{BucketPosition, WebKnossosIsosurfaceRequest}
import com.scalableminds.webknossos.datastore.services._
import com.scalableminds.webknossos.tracingstore.tracings.TracingType.TracingType
import com.scalableminds.webknossos.tracingstore.tracings._
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.FallbackDataHelper
import com.scalableminds.webknossos.tracingstore.{
  TSRemoteDatastoreClient,
  TSRemoteWebKnossosClient,
  TracingStoreRedisStore
}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Empty, Failure, Full}
import play.api.libs.Files
import play.api.libs.Files.TemporaryFileCreator
import play.api.libs.iteratee.Enumerator
import play.api.libs.json.{JsObject, JsValue, Json}

import scala.collection.mutable
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future
import scala.concurrent.duration._

class VolumeTracingService @Inject()(
    val tracingDataStore: TracingDataStore,
    val tracingStoreWkRpcClient: TSRemoteWebKnossosClient,
    val isosurfaceServiceHolder: IsosurfaceServiceHolder,
    implicit val temporaryTracingStore: TemporaryTracingStore[VolumeTracing],
    implicit val volumeDataCache: TemporaryVolumeDataStore,
    val handledGroupIdStore: TracingStoreRedisStore,
    val uncommittedUpdatesStore: TracingStoreRedisStore,
    val temporaryTracingIdStore: TracingStoreRedisStore,
    val remoteDatastoreClient: TSRemoteDatastoreClient,
    val temporaryFileCreator: TemporaryFileCreator
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

  implicit val updateActionJsonFormat: VolumeUpdateAction.volumeUpdateActionFormat.type =
    VolumeUpdateAction.volumeUpdateActionFormat

  val tracingType: TracingType = TracingType.volume

  val tracingStore: FossilDBClient = tracingDataStore.volumes

  val tracingMigrationService: VolumeTracingMigrationService.type = VolumeTracingMigrationService

  /* We want to reuse the bucket loading methods from binaryDataService for the volume tracings, however, it does not
     actually load anything from disk, unlike its “normal” instance in the datastore (only from the volume tracing store) */
  val binaryDataService = new BinaryDataService(Paths.get(""), 100, None)

  isosurfaceServiceHolder.tracingStoreIsosurfaceConfig = (binaryDataService, 30 seconds, 1)
  val isosurfaceService: IsosurfaceService = isosurfaceServiceHolder.tracingStoreIsosurfaceService

  override def currentVersion(tracingId: String): Fox[Long] =
    tracingDataStore.volumes.getVersion(tracingId, mayBeEmpty = Some(true), emptyFallback = Some(0L))

  override def currentVersion(tracing: VolumeTracing): Long = tracing.version

  def handleUpdateGroup(tracingId: String,
                        updateGroup: UpdateActionGroup[VolumeTracing],
                        previousVersion: Long): Fox[Unit] =
    for {
      updatedTracing: VolumeTracing <- updateGroup.actions.foldLeft(find(tracingId)) { (tracingFox, action) =>
        tracingFox.futureBox.flatMap {
          case Full(tracing) =>
            action match {
              case a: UpdateBucketVolumeAction =>
                if (tracing.getMappingIsEditable) {
                  Fox.failure("Cannot mutate buckets in annotation with editable mapping.")
                } else updateBucket(tracingId, tracing, a, updateGroup.version)
              case a: UpdateTracingVolumeAction =>
                Fox.successful(
                  tracing.copy(
                    activeSegmentId = Some(a.activeSegmentId),
                    editPosition = a.editPosition,
                    editRotation = a.editRotation,
                    largestSegmentId = a.largestSegmentId,
                    zoomLevel = a.zoomLevel
                  ))
              case a: RevertToVersionVolumeAction =>
                revertToVolumeVersion(tracingId, a.sourceVersion, updateGroup.version, tracing)
              case _: UpdateTdCamera        => Fox.successful(tracing)
              case a: ApplyableVolumeAction => Fox.successful(a.applyOn(tracing))
              case _                        => Fox.failure("Unknown action.")
            }
          case Empty =>
            Fox.empty
          case f: Failure =>
            Fox.failure(f.msg)
        }
      }
      _ <- save(updatedTracing.copy(version = updateGroup.version), Some(tracingId), updateGroup.version)
      _ <- tracingDataStore.volumeUpdates.put(
        tracingId,
        updateGroup.version,
        updateGroup.actions.map(_.addTimestamp(updateGroup.timestamp)).map(_.transformToCompact))
    } yield Fox.successful(())

  private def updateBucket(tracingId: String,
                           volumeTracing: VolumeTracing,
                           action: UpdateBucketVolumeAction,
                           updateGroupVersion: Long): Fox[VolumeTracing] =
    for {
      _ <- assertMagIsValid(volumeTracing, action.mag)
      bucket = BucketPosition(action.position.x, action.position.y, action.position.z, action.mag)
      _ <- saveBucket(volumeTracingLayer(tracingId, volumeTracing), bucket, action.data, updateGroupVersion)
    } yield volumeTracing

  private def assertMagIsValid(tracing: VolumeTracing, mag: Vec3Int): Fox[Unit] =
    if (tracing.resolutions.nonEmpty) {
      bool2Fox(tracing.resolutions.exists(r => vec3IntFromProto(r) == mag))
    } else { // old volume tracings do not have a mag list, no assert possible. Check compatibility by asserting isotropic mag
      bool2Fox(mag.isIsotropic)
    }

  private def revertToVolumeVersion(tracingId: String,
                                    sourceVersion: Long,
                                    newVersion: Long,
                                    tracing: VolumeTracing): Fox[VolumeTracing] = {
    val sourceTracing = find(tracingId, Some(sourceVersion))
    val dataLayer = volumeTracingLayer(tracingId, tracing)
    val bucketStream = dataLayer.volumeBucketProvider.bucketStreamWithVersion()

    bucketStream.foreach {
      case (bucketPosition, _, version) =>
        if (version > sourceVersion)
          loadBucket(dataLayer, bucketPosition, Some(sourceVersion)).futureBox.map {
            case Full(bucket)           => saveBucket(dataLayer, bucketPosition, bucket, newVersion)
            case Empty                  => saveBucket(dataLayer, bucketPosition, Array[Byte](0), newVersion)
            case Failure(msg, _, chain) => Fox.failure(msg, Empty, chain)
          }
    }
    sourceTracing
  }

  def initializeWithDataMultiple(tracingId: String, tracing: VolumeTracing, initialData: File): Fox[Set[Vec3Int]] =
    if (tracing.version != 0L)
      Failure("Tracing has already been edited.")
    else {
      val resolutionSets = new mutable.HashSet[Set[Vec3Int]]()
      withZipsFromMultiZip(initialData) { (_, dataZip) =>
        val resolutionSet = resolutionSetFromZipfile(dataZip)
        if (resolutionSet.nonEmpty) resolutionSets.add(resolutionSet)
      }
      // if none of the tracings contained any volume data do not save buckets, use full resolution list
      if (resolutionSets.isEmpty)
        getRequiredMags(tracing).map(_.toSet)
      else {
        val resolutionsDoMatch = resolutionSets.headOption.forall { head =>
          resolutionSets.forall(_ == head)
        }
        if (!resolutionsDoMatch)
          Fox.failure("annotation.volume.resolutionsDoNotMatch")
        else {
          val mergedVolume = new MergedVolume(tracing.elementClass)
          for {
            _ <- withZipsFromMultiZip(initialData)((_, dataZip) => mergedVolume.addLabelSetFromDataZip(dataZip)).toFox
            _ <- withZipsFromMultiZip(initialData)((index, dataZip) => mergedVolume.addFromDataZip(index, dataZip)).toFox
            _ <- bool2Fox(ElementClass.largestSegmentIdIsInRange(
              mergedVolume.largestSegmentId.toLong,
              tracing.elementClass)) ?~> "annotation.volume.largestSegmentIdExceedsRange"
            destinationDataLayer = volumeTracingLayer(tracingId, tracing)
            _ <- mergedVolume.withMergedBuckets { (bucketPosition, bytes) =>
              saveBucket(destinationDataLayer, bucketPosition, bytes, tracing.version)
            }
          } yield mergedVolume.presentResolutions
        }
      }
    }

  def initializeWithData(tracingId: String,
                         tracing: VolumeTracing,
                         initialData: File,
                         resolutionRestrictions: ResolutionRestrictions): Fox[Set[Vec3Int]] =
    if (tracing.version != 0L) {
      Failure("Tracing has already been edited.")
    } else {

      val dataLayer = volumeTracingLayer(tracingId, tracing)
      val savedResolutions = new mutable.HashSet[Vec3Int]()

      val unzipResult = withBucketsFromZip(initialData) { (bucketPosition, bytes) =>
        if (resolutionRestrictions.isForbidden(bucketPosition.mag)) {
          Fox.successful(())
        } else {
          savedResolutions.add(bucketPosition.mag)
          saveBucket(dataLayer, bucketPosition, bytes, tracing.version)
        }
      }
      if (savedResolutions.isEmpty) {
        val resolutionSet = resolutionSetFromZipfile(initialData)
        Fox.successful(resolutionSet)
      } else
        unzipResult.map(_ => savedResolutions.toSet)
    }

  def allDataEnumerator(tracingId: String, tracing: VolumeTracing): Enumerator[Array[Byte]] =
    Enumerator.outputStream { os =>
      allDataToOutputStream(tracingId, tracing, os)
    }

  def allDataFile(tracingId: String, tracing: VolumeTracing): Future[Files.TemporaryFile] = {
    val zipped = temporaryFileCreator.create(tracingId, ".zip")
    val os = new BufferedOutputStream(new FileOutputStream(new File(zipped.path.toString)))
    allDataToOutputStream(tracingId, tracing, os).map(_ => zipped)
  }

  private def allDataToOutputStream(tracingId: String, tracing: VolumeTracing, os: OutputStream): Future[Unit] = {
    val dataLayer = volumeTracingLayer(tracingId, tracing)
    val buckets: Iterator[NamedStream] =
      new WKWBucketStreamSink(dataLayer)(dataLayer.bucketProvider.bucketStream(Some(tracing.version)),
                                         tracing.resolutions.map(mag => vec3IntFromProto(mag)))

    val before = System.currentTimeMillis()
    val zipResult = ZipIO.zip(buckets, os, level = Deflater.BEST_SPEED)

    zipResult.onComplete {
      case failure: scala.util.Failure[Unit] =>
        logger.debug(
          s"Failed to send zipped volume data for $tracingId: ${TextUtils.stackTraceAsString(failure.exception)}")
      case _: scala.util.Success[Unit] =>
        val after = System.currentTimeMillis()
        logger.info(s"Zipping volume data for $tracingId took ${after - before} ms")
    }
    zipResult
  }

  def isTemporaryTracing(tracingId: String): Fox[Boolean] =
    temporaryTracingIdStore.contains(temporaryIdKey(tracingId))

  def data(tracingId: String,
           tracing: VolumeTracing,
           dataRequests: DataRequestCollection): Fox[(Array[Byte], List[Int])] =
    for {
      isTemporaryTracing <- isTemporaryTracing(tracingId)
      dataLayer = volumeTracingLayer(tracingId, tracing, isTemporaryTracing)
      requests = dataRequests.map(r =>
        DataServiceDataRequest(null, dataLayer, None, r.cuboid(dataLayer), r.settings.copy(appliedAgglomerate = None)))
      data <- binaryDataService.handleDataRequests(requests)
    } yield data

  def duplicate(tracingId: String,
                sourceTracing: VolumeTracing,
                fromTask: Boolean,
                dataSetBoundingBox: Option[BoundingBox],
                resolutionRestrictions: ResolutionRestrictions,
                editPosition: Option[Vec3Int],
                editRotation: Option[Vec3Double],
                boundingBox: Option[BoundingBox],
                mappingName: Option[String]): Fox[(String, VolumeTracing)] = {
    val tracingWithBB = addBoundingBoxFromTaskIfRequired(sourceTracing, fromTask, dataSetBoundingBox)
    val tracingWithResolutionRestrictions = restrictMagList(tracingWithBB, resolutionRestrictions)
    val newTracing = tracingWithResolutionRestrictions.copy(
      createdTimestamp = System.currentTimeMillis(),
      editPosition = editPosition.map(vec3IntToProto).getOrElse(tracingWithResolutionRestrictions.editPosition),
      editRotation = editRotation.map(vec3DoubleToProto).getOrElse(tracingWithResolutionRestrictions.editRotation),
      boundingBox = boundingBoxOptToProto(boundingBox).getOrElse(tracingWithResolutionRestrictions.boundingBox),
      mappingName = mappingName.orElse(tracingWithResolutionRestrictions.mappingName),
      version = 0
    )
    for {
      _ <- bool2Fox(newTracing.resolutions.nonEmpty) ?~> "resolutionRestrictions.tooTight"
      newId <- save(newTracing, None, newTracing.version)
      _ <- duplicateData(tracingId, sourceTracing, newId, newTracing)
    } yield (newId, newTracing)
  }

  @SuppressWarnings(Array("OptionGet")) //We suppress this warning because we check the option beforehand
  private def addBoundingBoxFromTaskIfRequired(tracing: VolumeTracing,
                                               fromTask: Boolean,
                                               dataSetBoundingBox: Option[BoundingBox]): VolumeTracing =
    if (fromTask && dataSetBoundingBox.isDefined) {
      val newId = if (tracing.userBoundingBoxes.isEmpty) 1 else tracing.userBoundingBoxes.map(_.id).max + 1
      tracing
        .addUserBoundingBoxes(
          NamedBoundingBoxProto(newId,
                                Some("task bounding box"),
                                Some(true),
                                Some(getRandomColor),
                                tracing.boundingBox))
        .withBoundingBox(dataSetBoundingBox.get)
    } else tracing

  def duplicateData(sourceId: String,
                    sourceTracing: VolumeTracing,
                    destinationId: String,
                    destinationTracing: VolumeTracing): Fox[Unit] =
    for {
      isTemporaryTracing <- isTemporaryTracing(sourceId)
      sourceDataLayer = volumeTracingLayer(sourceId, sourceTracing, isTemporaryTracing)
      buckets: Iterator[(BucketPosition, Array[Byte])] = sourceDataLayer.bucketProvider.bucketStream()
      destinationDataLayer = volumeTracingLayer(destinationId, destinationTracing)
      _ <- Fox.combined(buckets.map {
        case (bucketPosition, bucketData) =>
          if (destinationTracing.resolutions.contains(vec3IntToProto(bucketPosition.mag))) {
            saveBucket(destinationDataLayer, bucketPosition, bucketData, destinationTracing.version)
          } else Fox.successful(())
      }.toList)
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
      userToken = userToken
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

  def downsample(tracingId: String, tracing: VolumeTracing): Fox[Unit] =
    for {
      resultingResolutions <- downsampleWithLayer(tracingId, tracing, volumeTracingLayer(tracingId, tracing))
      _ <- updateResolutionList(tracingId, tracing, resultingResolutions.toSet)
    } yield ()

  def volumeBucketsAreEmpty(tracingId: String): Boolean =
    volumeDataStore.getMultipleKeys(tracingId, Some(tracingId), limit = Some(1))(toBox).isEmpty

  def createIsosurface(tracingId: String,
                       request: WebKnossosIsosurfaceRequest,
                       userToken: Option[String]): Fox[(Array[Float], List[Int])] =
    for {
      tracing <- find(tracingId) ?~> "tracing.notFound"
      segmentationLayer = volumeTracingLayer(tracingId,
                                             tracing,
                                             includeFallbackDataIfAvailable = true,
                                             userToken = userToken)
      isosurfaceRequest = IsosurfaceRequest(
        None,
        segmentationLayer,
        request.cuboid(segmentationLayer),
        request.segmentId,
        request.subsamplingStrides,
        request.scale,
        None,
        None
      )
      result <- isosurfaceService.requestIsosurfaceViaActor(isosurfaceRequest)
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

  def merge(tracings: Seq[VolumeTracing]): VolumeTracing =
    tracings
      .reduceLeft(mergeTwo)
      .copy(
        createdTimestamp = System.currentTimeMillis(),
        version = 0L,
      )

  private def mergeTwo(tracingA: VolumeTracing, tracingB: VolumeTracing): VolumeTracing = {
    val largestSegmentId = Math.max(tracingA.largestSegmentId, tracingB.largestSegmentId)
    val mergedBoundingBox = combineBoundingBoxes(Some(tracingA.boundingBox), Some(tracingB.boundingBox))
    val userBoundingBoxes = combineUserBoundingBoxes(tracingA.userBoundingBox,
                                                     tracingB.userBoundingBox,
                                                     tracingA.userBoundingBoxes,
                                                     tracingB.userBoundingBoxes)

    tracingA.copy(
      largestSegmentId = largestSegmentId,
      boundingBox = mergedBoundingBox.getOrElse(
        com.scalableminds.webknossos.datastore.geometry.BoundingBoxProto(
          com.scalableminds.webknossos.datastore.geometry.Vec3IntProto(0, 0, 0),
          0,
          0,
          0)), // should never be empty for volumes
      userBoundingBoxes = userBoundingBoxes
    )
  }

  private def bucketStreamFromSelector(selector: TracingSelector,
                                       tracing: VolumeTracing): Iterator[(BucketPosition, Array[Byte])] = {
    val dataLayer = volumeTracingLayer(selector.tracingId, tracing)
    dataLayer.bucketProvider.bucketStream(Some(tracing.version))
  }

  def mergeVolumeData(tracingSelectors: Seq[TracingSelector],
                      tracings: Seq[VolumeTracing],
                      newId: String,
                      newTracing: VolumeTracing,
                      toCache: Boolean): Fox[Unit] = {
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

    // If none of the tracings contained any volume data. Do not save buckets, do not touch resolution list
    if (resolutionSets.isEmpty)
      Fox.successful(())
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
      val destinationDataLayer = volumeTracingLayer(newId, newTracing)
      for {

        _ <- bool2Fox(ElementClass.largestSegmentIdIsInRange(mergedVolume.largestSegmentId.toLong, elementClass)) ?~> "annotation.volume.largestSegmentIdExceedsRange"
        _ <- mergedVolume.withMergedBuckets { (bucketPosition, bucketBytes) =>
          saveBucket(destinationDataLayer, bucketPosition, bucketBytes, newTracing.version, toCache)
        }
        _ <- updateResolutionList(newId, newTracing, mergedVolume.presentResolutions)
      } yield ()
    }
  }

  def importVolumeData(tracingId: String, tracing: VolumeTracing, zipFile: File, currentVersion: Int): Fox[Long] =
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
        val mergedVolume = new MergedVolume(tracing.elementClass, tracing.largestSegmentId)
        for {
          _ <- mergedVolume.addLabelSetFromDataZip(zipFile).toFox
          _ = mergedVolume.addFromBucketStream(sourceVolumeIndex = 0, volumeLayer.bucketProvider.bucketStream())
          _ <- mergedVolume.addFromDataZip(sourceVolumeIndex = 1, zipFile).toFox
          _ <- bool2Fox(ElementClass.largestSegmentIdIsInRange(
            mergedVolume.largestSegmentId.toLong,
            tracing.elementClass)) ?~> "annotation.volume.largestSegmentIdExceedsRange"
          _ <- mergedVolume.withMergedBuckets { (bucketPosition, bucketBytes) =>
            saveBucket(volumeLayer, bucketPosition, bucketBytes, tracing.version + 1)
          }
          updateGroup = UpdateActionGroup[VolumeTracing](
            tracing.version + 1,
            System.currentTimeMillis(),
            None,
            List(ImportVolumeData(mergedVolume.largestSegmentId.toPositiveLong)),
            None,
            None,
            None,
            None,
            None)
          _ <- handleUpdateGroup(tracingId, updateGroup, tracing.version)
        } yield mergedVolume.largestSegmentId.toPositiveLong
      }
    }

  def dummyTracing: VolumeTracing = ???

}
