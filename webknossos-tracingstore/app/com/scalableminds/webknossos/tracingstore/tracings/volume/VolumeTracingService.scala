package com.scalableminds.webknossos.tracingstore.tracings.volume

import java.io._
import java.nio.file.Paths

import com.google.inject.Inject
import com.scalableminds.util.geometry.{BoundingBox, Point3D}
import com.scalableminds.util.io.{NamedStream, ZipIO}
import com.scalableminds.util.tools.{Fox, FoxImplicits, TextUtils}
import com.scalableminds.webknossos.datastore.dataformats.wkw.{WKWBucketStreamSink, WKWDataFormatHelper}
import com.scalableminds.webknossos.datastore.models.DataRequestCollection.DataRequestCollection
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceLike
import com.scalableminds.webknossos.datastore.models.requests.DataServiceDataRequest
import com.scalableminds.webknossos.datastore.models.{
  BucketPosition,
  UnsignedInteger,
  UnsignedIntegerArray,
  WebKnossosIsosurfaceRequest
}
import com.scalableminds.webknossos.datastore.services.{
  BinaryDataService,
  DataFinder,
  IsosurfaceRequest,
  IsosurfaceService,
  IsosurfaceServiceHolder
}
import com.scalableminds.webknossos.tracingstore.{RedisTemporaryStore, TracingStoreWkRpcClient}
import com.scalableminds.webknossos.tracingstore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.tracingstore.VolumeTracing.VolumeTracing.ElementClass
import com.scalableminds.webknossos.tracingstore.geometry.NamedBoundingBox
import com.scalableminds.webknossos.tracingstore.tracings.{TracingType, _}
import com.scalableminds.webknossos.wrap.WKWFile
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}
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
    val tracingStoreWkRpcClient: TracingStoreWkRpcClient,
    val isosurfaceServiceHolder: IsosurfaceServiceHolder,
    implicit val temporaryTracingStore: TemporaryTracingStore[VolumeTracing],
    implicit val volumeDataCache: TemporaryVolumeDataStore,
    val handledGroupIdStore: RedisTemporaryStore,
    val uncommittedUpdatesStore: RedisTemporaryStore,
    val temporaryTracingIdStore: RedisTemporaryStore,
    val temporaryFileCreator: TemporaryFileCreator
) extends TracingService[VolumeTracing]
    with VolumeTracingBucketHelper
    with VolumeTracingDownsampling
    with WKWDataFormatHelper
    with DataFinder
    with ProtoGeometryImplicits
    with FoxImplicits
    with LazyLogging {

  implicit val volumeDataStore: FossilDBClient = tracingDataStore.volumeData

  implicit val tracingCompanion: VolumeTracing.type = VolumeTracing

  implicit val updateActionJsonFormat: VolumeUpdateAction.volumeUpdateActionFormat.type =
    VolumeUpdateAction.volumeUpdateActionFormat

  val tracingType: TracingType.Value = TracingType.volume

  val tracingStore: FossilDBClient = tracingDataStore.volumes

  val tracingMigrationService: VolumeTracingMigrationService.type = VolumeTracingMigrationService

  /* We want to reuse the bucket loading methods from binaryDataService for the volume tracings, however, it does not
     actually load anything from disk, unlike its “normal” instance in the datastore (only from the volume tracing store) */
  val binaryDataService = new BinaryDataService(Paths.get(""), 10 seconds, 100, null)

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
          case Full(t) =>
            action match {
              case a: UpdateBucketVolumeAction =>
                updateBucket(tracingId, t, a, updateGroup.version)
              case a: UpdateTracingVolumeAction =>
                Fox.successful(
                  t.copy(
                    activeSegmentId = Some(a.activeSegmentId),
                    editPosition = a.editPosition,
                    editRotation = a.editRotation,
                    largestSegmentId = a.largestSegmentId,
                    zoomLevel = a.zoomLevel
                  ))
              case a: RevertToVersionVolumeAction =>
                revertToVolumeVersion(tracingId, a.sourceVersion, updateGroup.version, t)
              case a: UpdateUserBoundingBoxes         => Fox.successful(t.withUserBoundingBoxes(a.boundingBoxes.map(_.toProto)))
              case a: UpdateUserBoundingBoxVisibility => updateBoundingBoxVisibility(t, a.boundingBoxId, a.isVisible)
              case _: RemoveFallbackLayer             => Fox.successful(t.clearFallbackLayer)
              case a: ImportVolumeData                => Fox.successful(t.withLargestSegmentId(a.largestSegmentId))
              case _: UpdateTdCamera                  => Fox.successful(t)
              case _                                  => Fox.failure("Unknown action.")
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
      resolution <- lookUpVolumeResolution(volumeTracing, action.zoomStep)
      bucket = BucketPosition(action.position.x, action.position.y, action.position.z, resolution)
      _ <- saveBucket(volumeTracingLayer(tracingId, volumeTracing), bucket, action.data, updateGroupVersion)
    } yield volumeTracing

  private def lookUpVolumeResolution(tracing: VolumeTracing, zoomStep: Int): Fox[Point3D] =
    if (tracing.resolutions.nonEmpty) {
      tracing.resolutions
        .find(r => r.maxDim == math.pow(2, zoomStep))
        .map(point3DFromProto)
        .toFox ?~> s"Received bucket with zoomStep ($zoomStep), no matching resolution found in tracing (has ${tracing.resolutions})"
    } else {
      val isotropicResolution = math.pow(2, zoomStep).toInt
      Fox.successful(Point3D(isotropicResolution, isotropicResolution, isotropicResolution))
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

  private def updateBoundingBoxVisibility(tracing: VolumeTracing, boundingBoxId: Option[Int], isVisible: Boolean) = {
    def updateUserBoundingBoxes() =
      tracing.userBoundingBoxes.map { boundingBox =>
        if (boundingBoxId.forall(_ == boundingBox.id))
          boundingBox.copy(isVisible = Some(isVisible))
        else
          boundingBox
      }

    Fox.successful(tracing.withUserBoundingBoxes(updateUserBoundingBoxes()))
  }

  def initializeWithDataMultiple(tracingId: String, tracing: VolumeTracing, initialData: File): Fox[Set[Point3D]] = {
    if (tracing.version != 0L) {
      return Failure("Tracing has already been edited.")
    }

    val resolutionSets = new mutable.HashSet[Set[Point3D]]()
    ZipIO.withUnziped(initialData) {
      case (_, is) =>
        val resolutionSet = new mutable.HashSet[Point3D]()
        ZipIO.withUnziped(is) {
          case (fileName, _) =>
            parseWKWFilePath(fileName.toString).map { bucketPosition: BucketPosition =>
              resolutionSet.add(bucketPosition.resolution)
            }
        }
        if (resolutionSet.nonEmpty) {
          resolutionSets.add(resolutionSet.toSet)
        }
    }

    // if none of the tracings contained any volume data. do not save buckets, use full resolution list
    if (resolutionSets.isEmpty) return getRequiredMags(tracing).map(_.toSet)

    val resolutionsDoMatch = resolutionSets.headOption.forall { head =>
      resolutionSets.forall(_ == head)
    }

    if (!resolutionsDoMatch) return Fox.failure("annotation.volume.resolutionsDoNotMatch")

    val mergedVolume = new MergedVolume(tracing.elementClass)

    ZipIO.withUnziped(initialData) {
      case (_, is) =>
        val labelSet: mutable.Set[UnsignedInteger] = scala.collection.mutable.Set()
        ZipIO.withUnziped(is) {
          case (fileName, is) =>
            WKWFile.read(is) {
              case (header, buckets) =>
                if (header.numBlocksPerCube == 1) {
                  parseWKWFilePath(fileName.toString).map { _ =>
                    if (buckets.hasNext) {
                      val dataTyped =
                        UnsignedIntegerArray.fromByteArray(buckets.next(), elementClassFromProto(tracing.elementClass))
                      val nonZeroData = UnsignedIntegerArray.filterNonZero(dataTyped)
                      labelSet ++= nonZeroData
                    }
                  }
                }
            }
        }
        mergedVolume.addLabelSet(labelSet)
    }

    var sourceVolumeIndex = 0 //order must be deterministic, same as label set order
    ZipIO.withUnziped(initialData) {
      case (_, is) =>
        ZipIO.withUnziped(is) {
          case (fileName, is) =>
            WKWFile.read(is) {
              case (header, buckets) =>
                if (header.numBlocksPerCube == 1) {
                  parseWKWFilePath(fileName.toString).map { bucketPosition: BucketPosition =>
                    if (buckets.hasNext) {
                      val data = buckets.next()
                      if (!isAllZero(data)) {
                        mergedVolume.add(sourceVolumeIndex, bucketPosition, data)
                      }
                    }
                  }
                }
            }
        }
        sourceVolumeIndex += 1
    }

    val destinationDataLayer = volumeTracingLayer(tracingId, tracing)
    for {
      _ <- mergedVolume.withAllBuckets { (bucketPosition, bucketBytes) =>
        saveBucket(destinationDataLayer, bucketPosition, bucketBytes, tracing.version)
      }
    } yield mergedVolume.presentResolutions
  }

  def initializeWithData(tracingId: String,
                         tracing: VolumeTracing,
                         initialData: File,
                         resolutionRestrictions: ResolutionRestrictions): Box[Set[Point3D]] = {
    if (tracing.version != 0L) {
      return Failure("Tracing has already been edited.")
    }

    val dataLayer = volumeTracingLayer(tracingId, tracing)
    val savedResolutions = new mutable.HashSet[Point3D]()

    val unzipResult = ZipIO.withUnziped(initialData) {
      case (fileName, is) =>
        WKWFile.read(is) {
          case (header, buckets) =>
            if (header.numBlocksPerCube == 1) {
              parseWKWFilePath(fileName.toString).map { bucket =>
                if (buckets.hasNext) {
                  val data = buckets.next()
                  if (isAllZero(data) || resolutionRestrictions.isForbidden(bucket.resolution)) {
                    Fox.successful(())
                  } else {
                    savedResolutions.add(bucket.resolution)
                    saveBucket(dataLayer, bucket, data, tracing.version)
                  }
                }
              }
            }
        }
    }

    for {
      _ <- unzipResult
    } yield savedResolutions.toSet
  }

  private def isAllZero(data: Array[Byte]): Boolean =
    data.forall { byte: Byte =>
      byte == 0
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
      new WKWBucketStreamSink(dataLayer)(dataLayer.bucketProvider.bucketStream(Some(tracing.version)))

    val zipResult = ZipIO.zip(buckets, os)

    zipResult.onComplete {
      case failure: scala.util.Failure[Unit] =>
        logger.debug(
          s"Failed to send zipped volume data for $tracingId: ${TextUtils.stackTraceAsString(failure.exception)}")
      case _: scala.util.Success[Unit] => logger.debug(s"Successfully sent zipped volume data for $tracingId")
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
      requests = dataRequests.map(r => DataServiceDataRequest(null, dataLayer, None, r.cuboid(dataLayer), r.settings))
      data <- binaryDataService.handleDataRequests(requests)
    } yield data

  def unlinkFallback(tracing: VolumeTracing, dataSource: DataSourceLike): VolumeTracing =
    tracing.copy(
      activeSegmentId = None,
      largestSegmentId = 0L,
      fallbackLayer = None,
      version = 0L,
      resolutions = VolumeTracingDownsampling.resolutionsForVolumeTracing(dataSource, None).map(point3DToProto)
    )

  def duplicate(tracingId: String,
                sourceTracing: VolumeTracing,
                fromTask: Boolean,
                dataSetBoundingBox: Option[BoundingBox],
                resolutionRestrictions: ResolutionRestrictions): Fox[(String, VolumeTracing)] = {
    val tracingWithBB = addBoundingBoxFromTaskIfRequired(sourceTracing, fromTask, dataSetBoundingBox)
    val tracingWithResolutionRestrictions = restrictMagList(tracingWithBB, resolutionRestrictions)
    val newTracing = tracingWithResolutionRestrictions.withCreatedTimestamp(System.currentTimeMillis()).withVersion(0)
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
          NamedBoundingBox(newId, Some("task bounding box"), Some(true), Some(getRandomColor()), tracing.boundingBox))
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
          if (destinationTracing.resolutions.contains(point3DToProto(bucketPosition.resolution))) {
            saveBucket(destinationDataLayer, bucketPosition, bucketData, destinationTracing.version)
          } else Fox.successful(())
      }.toList)
    } yield ()

  private def volumeTracingLayer(tracingId: String,
                                 tracing: VolumeTracing,
                                 isTemporaryTracing: Boolean = false): VolumeTracingLayer =
    VolumeTracingLayer(
      tracingId,
      tracing.boundingBox,
      tracing.elementClass,
      tracing.largestSegmentId,
      isTemporaryTracing,
      volumeResolutions = tracing.resolutions.map(point3DFromProto).toList
    )

  def updateActionLog(tracingId: String): Fox[JsValue] = {
    def versionedTupleToJson(tuple: (Long, List[CompactVolumeUpdateAction])): JsObject =
      Json.obj(
        "version" -> tuple._1,
        "value" -> Json.toJson(tuple._2)
      )

    for {
      volumeTracings <- tracingDataStore.volumeUpdates.getMultipleVersionsAsVersionValueTuple(tracingId)(
        fromJson[List[CompactVolumeUpdateAction]])
      updateActionGroupsJs = volumeTracings.map(versionedTupleToJson)
    } yield Json.toJson(updateActionGroupsJs)
  }

  def updateResolutionList(tracingId: String,
                           tracing: VolumeTracing,
                           resolutions: Set[Point3D],
                           toCache: Boolean = false): Fox[String] =
    for {
      _ <- bool2Fox(tracing.version == 0L) ?~> "Tracing has already been edited."
      _ <- bool2Fox(resolutions.nonEmpty) ?~> "Resolution restrictions result in zero resolutions"
      id <- save(tracing.copy(resolutions = resolutions.toList.sortBy(_.maxDim).map(point3DToProto)),
                 Some(tracingId),
                 tracing.version,
                 toCache)
    } yield id

  def downsample(tracingId: String, tracing: VolumeTracing): Fox[Unit] =
    for {
      resultingResolutions <- downsampleWithLayer(tracingId, tracing, volumeTracingLayer(tracingId, tracing))
      _ <- updateResolutionList(tracingId, tracing, resultingResolutions.toSet)
    } yield ()

  def createIsosurface(tracingId: String, request: WebKnossosIsosurfaceRequest): Fox[(Array[Float], List[Int])] =
    for {
      tracing <- find(tracingId) ?~> "tracing.notFound"
      segmentationLayer = volumeTracingLayer(tracingId, tracing)
      isosurfaceRequest = IsosurfaceRequest(
        None,
        segmentationLayer,
        request.cuboid(segmentationLayer),
        request.segmentId,
        request.voxelDimensions,
        request.scale,
        request.mapping,
        request.mappingType
      )
      result <- isosurfaceService.requestIsosurfaceViaActor(isosurfaceRequest)
    } yield result

  def findData(tracingId: String): Fox[Option[Point3D]] =
    for {
      tracing <- find(tracingId) ?~> "tracing.notFound"
      volumeLayer = volumeTracingLayer(tracingId, tracing)
      bucketStream = volumeLayer.bucketProvider.bucketStream(Some(tracing.version))
      bucketPosOpt = if (bucketStream.hasNext) {
        val bucket = bucketStream.next()
        val bucketPos = bucket._1
        getPositionOfNonZeroData(bucket._2,
                                 Point3D(bucketPos.globalX, bucketPos.globalY, bucketPos.globalZ),
                                 volumeLayer.bytesPerElement)
      } else None
    } yield bucketPosOpt

  def merge(tracings: Seq[VolumeTracing]): VolumeTracing = tracings.reduceLeft(mergeTwo)

  def mergeTwo(tracingA: VolumeTracing, tracingB: VolumeTracing): VolumeTracing = {
    val largestSegmentId = Math.max(tracingA.largestSegmentId, tracingB.largestSegmentId)
    val mergedBoundingBox = combineBoundingBoxes(Some(tracingA.boundingBox), Some(tracingB.boundingBox))
    val userBoundingBoxes = combineUserBoundingBoxes(tracingA.userBoundingBox,
                                                     tracingB.userBoundingBox,
                                                     tracingA.userBoundingBoxes,
                                                     tracingB.userBoundingBoxes)

    tracingA.copy(
      createdTimestamp = System.currentTimeMillis(),
      version = 0L,
      largestSegmentId = largestSegmentId,
      boundingBox = mergedBoundingBox.getOrElse(
        com.scalableminds.webknossos.tracingstore.geometry.BoundingBox(
          com.scalableminds.webknossos.tracingstore.geometry.Point3D(0, 0, 0),
          0,
          0,
          0)), // should never be empty for volumes
      userBoundingBoxes = userBoundingBoxes
    )
  }

  def mergeVolumeData(tracingSelectors: Seq[TracingSelector],
                      tracings: Seq[VolumeTracing],
                      newId: String,
                      newTracing: VolumeTracing,
                      toCache: Boolean): Fox[Unit] = {
    val elementClass = tracings.headOption.map(_.elementClass).getOrElse(ElementClass.uint8)

    val resolutionSets = new mutable.HashSet[Set[Point3D]]()
    tracingSelectors.zip(tracings).foreach {
      case (selector, tracing) =>
        val resolutionSet = new mutable.HashSet[Point3D]()
        val dataLayer = volumeTracingLayer(selector.tracingId, tracing)
        val bucketStream: Iterator[(BucketPosition, Array[Byte])] =
          dataLayer.bucketProvider.bucketStream(Some(tracing.version))
        bucketStream.foreach {
          case (bucketPosition, _) =>
            resolutionSet.add(bucketPosition.resolution)
        }
        if (resolutionSet.nonEmpty) { // empty tracings should have no impact in this check
          resolutionSets.add(resolutionSet.toSet)
        }
    }

    if (resolutionSets.isEmpty) {
      // None of the tracings contained any volume data. Do not save buckets, do not touch resolution list
      Fox.successful(())
    } else {

      val resolutionsIntersection: Set[Point3D] = resolutionSets.headOption.map { head =>
        resolutionSets.foldLeft(head) { (acc, element) =>
          acc.intersect(element)
        }
      }.getOrElse(Set.empty)

      val mergedVolume = new MergedVolume(elementClass)

      tracingSelectors.zip(tracings).foreach {
        case (selector, tracing) =>
          val dataLayer = volumeTracingLayer(selector.tracingId, tracing)
          val labelSet: mutable.Set[UnsignedInteger] = scala.collection.mutable.Set()
          val bucketStream: Iterator[(BucketPosition, Array[Byte])] =
            dataLayer.bucketProvider.bucketStream(Some(tracing.version))
          bucketStream.foreach {
            case (bucketPosition, data) =>
              if (resolutionsIntersection.contains(bucketPosition.resolution)) {
                val dataTyped = UnsignedIntegerArray.fromByteArray(data, elementClass)
                val nonZeroData: Array[UnsignedInteger] = UnsignedIntegerArray.filterNonZero(dataTyped)
                labelSet ++= nonZeroData
              }
          }
          mergedVolume.addLabelSet(labelSet)
      }

      tracingSelectors.zip(tracings).zipWithIndex.foreach {
        case ((selector, tracing), sourceVolumeIndex) =>
          val dataLayer = volumeTracingLayer(selector.tracingId, tracing)
          val bucketStream: Iterator[(BucketPosition, Array[Byte])] =
            dataLayer.bucketProvider.bucketStream(Some(tracing.version))
          bucketStream.foreach {
            case (bucketPosition, data) =>
              if (data.length > 1 && resolutionsIntersection.contains(bucketPosition.resolution)) {
                mergedVolume.add(sourceVolumeIndex, bucketPosition, data)
              }
          }
      }
      val destinationDataLayer = volumeTracingLayer(newId, newTracing)
      for {
        _ <- mergedVolume.withAllBuckets { (bucketPosition, bucketBytes) =>
          saveBucket(destinationDataLayer, bucketPosition, bucketBytes, newTracing.version, toCache)
        }
        _ <- updateResolutionList(newId, newTracing, mergedVolume.presentResolutions)
      } yield ()
    }
  }

  def importVolumeData(tracingId: String, tracing: VolumeTracing, zipFile: File, currentVersion: Int): Fox[Long] = {
    if (currentVersion != tracing.version) return Fox.failure("version.mismatch")

    val resolutionSet = new mutable.HashSet[Point3D]()
    ZipIO.withUnziped(zipFile) {
      case (fileName, _) =>
        parseWKWFilePath(fileName.toString).map { bucketPosition: BucketPosition =>
          resolutionSet.add(bucketPosition.resolution)
        }
    }
    val resolutionsDoMatch =
      resolutionSet.isEmpty || resolutionSet == resolveLegacyResolutionList(tracing.resolutions)
        .map(point3DFromProto)
        .toSet

    if (!resolutionsDoMatch) return Fox.failure("annotation.volume.resolutionsDoNotMatch")

    val volumeLayer = volumeTracingLayer(tracingId, tracing)
    val mergedVolume = new MergedVolume(tracing.elementClass, tracing.largestSegmentId)

    val importLabelSet: mutable.Set[UnsignedInteger] = scala.collection.mutable.Set()
    ZipIO.withUnziped(zipFile) {
      case (_, is) =>
        WKWFile.read(is) {
          case (header, buckets) =>
            if (header.numBlocksPerCube == 1 && buckets.hasNext) {
              val dataTyped =
                UnsignedIntegerArray.fromByteArray(buckets.next(), elementClassFromProto(tracing.elementClass))
              val nonZeroData = UnsignedIntegerArray.filterNonZero(dataTyped)
              importLabelSet ++= nonZeroData
            }
        }
    }
    mergedVolume.addLabelSet(importLabelSet)

    volumeLayer.bucketProvider.bucketStream().foreach {
      case (position, bytes) =>
        if (!isAllZero(bytes)) {
          mergedVolume.add(0, position, bytes)
        }
    }

    ZipIO.withUnziped(zipFile) {
      case (fileName, is) =>
        WKWFile.read(is) {
          case (header, buckets) =>
            if (header.numBlocksPerCube == 1) {
              parseWKWFilePath(fileName.toString).map { bucketPosition: BucketPosition =>
                if (buckets.hasNext) {
                  val data = buckets.next()
                  if (!isAllZero(data)) {
                    mergedVolume.add(1, bucketPosition, data)
                  }
                }
              }
            }
        }
    }

    val updateGroup = UpdateActionGroup[VolumeTracing](
      tracing.version + 1,
      System.currentTimeMillis(),
      List(ImportVolumeData(mergedVolume.largestSegmentId.toSignedLong)),
      None,
      None,
      None,
      None,
      None)

    for {
      _ <- mergedVolume.withAllBuckets { (bucketPosition, bucketBytes) =>
        saveBucket(volumeLayer, bucketPosition, bucketBytes, tracing.version + 1)
      }
      _ <- handleUpdateGroup(tracingId, updateGroup, tracing.version)
    } yield mergedVolume.largestSegmentId.toSignedLong
  }

}
