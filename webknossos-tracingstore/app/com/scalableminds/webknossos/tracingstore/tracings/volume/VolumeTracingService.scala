package com.scalableminds.webknossos.tracingstore.tracings.volume

import java.io._
import java.nio.file.Paths

import com.google.inject.Inject
import com.scalableminds.util.geometry.{BoundingBox, Point3D}
import com.scalableminds.webknossos.datastore.dataformats.wkw.{WKWBucketStreamSink, WKWDataFormatHelper}
import com.scalableminds.webknossos.datastore.models.{BucketPosition, UnsignedInteger, UnsignedIntegerArray}
import com.scalableminds.webknossos.tracingstore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.tracingstore.tracings.{TracingType, _}
import com.scalableminds.util.io.{NamedStream, ZipIO}
import com.scalableminds.util.tools.{Fox, FoxImplicits, TextUtils}
import com.scalableminds.webknossos.datastore.models.DataRequestCollection.DataRequestCollection
import com.scalableminds.webknossos.datastore.models.requests.DataServiceDataRequest
import com.scalableminds.webknossos.datastore.services.{BinaryDataService, DataConverter}
import com.scalableminds.webknossos.tracingstore.RedisTemporaryStore
import com.scalableminds.webknossos.tracingstore.VolumeTracing.VolumeTracing.ElementClass
import com.scalableminds.webknossos.wrap.WKWFile
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}
import play.api.libs.Files
import play.api.libs.Files.TemporaryFileCreator

import scala.concurrent.duration._
import play.api.libs.iteratee.Enumerator
import play.api.libs.json.{JsObject, JsValue, Json}

import scala.concurrent.Future
import scala.concurrent.ExecutionContext.Implicits.global
import com.scalableminds.webknossos.tracingstore.geometry.NamedBoundingBox

import scala.collection.mutable

class VolumeTracingService @Inject()(
    tracingDataStore: TracingDataStore,
    implicit val temporaryTracingStore: TemporaryTracingStore[VolumeTracing],
    implicit val volumeDataCache: TemporaryVolumeDataStore,
    val handledGroupIdStore: RedisTemporaryStore,
    val uncommittedUpdatesStore: RedisTemporaryStore,
    val temporaryTracingIdStore: RedisTemporaryStore,
    val temporaryFileCreator: TemporaryFileCreator
) extends TracingService[VolumeTracing]
    with VolumeTracingBucketHelper
    with WKWDataFormatHelper
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
                val resolution = math.pow(2, a.zoomStep).toInt
                val bucket =
                  BucketPosition(a.position.x, a.position.y, a.position.z, Point3D(resolution, resolution, resolution))
                saveBucket(volumeTracingLayer(tracingId, t), bucket, a.data, updateGroup.version).map(_ => t)
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

  private def revertToVolumeVersion(tracingId: String,
                                    sourceVersion: Long,
                                    newVersion: Long,
                                    tracing: VolumeTracing): Fox[VolumeTracing] = {
    val sourceTracing = find(tracingId, Some(sourceVersion))
    val dataLayer = volumeTracingLayer(tracingId, tracing)
    val bucketStream = dataLayer.volumeBucketProvider.bucketStreamWithVersion(1)

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

  def initializeWithDataMultiple(tracingId: String, tracing: VolumeTracing, initialData: File): Box[_] = {
    if (tracing.version != 0L) {
      return Failure("Tracing has already been edited.")
    }
    val mergedVolume = new MergedVolume(tracing.elementClass)

    ZipIO.withUnziped(initialData) {
      case (_, is) =>
        val labelSet: mutable.Set[UnsignedInteger] = scala.collection.mutable.Set()
        ZipIO.withUnziped(is) {
          case (_, is) =>
            WKWFile.read(is) {
              case (header, buckets) =>
                if (header.numBlocksPerCube == 1) {
                  val dataTyped =
                    UnsignedIntegerArray.fromByteArray(buckets.next(), elementClassFromProto(tracing.elementClass))
                  val nonZeroData = UnsignedIntegerArray.filterNonZero(dataTyped)
                  labelSet ++= nonZeroData
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
                    val data = buckets.next()
                    if (!isAllZero(data)) {
                      mergedVolume.add(sourceVolumeIndex, bucketPosition, data)
                    }
                  }
                }
            }
        }
        sourceVolumeIndex += 1
    }

    val destinationDataLayer = volumeTracingLayer(tracingId, tracing)
    mergedVolume.saveTo(destinationDataLayer, tracing.version, toCache = false)
  }

  class MergedVolume(elementClass: ElementClass) extends DataConverter {
    private var mergedVolume = mutable.HashMap.empty[BucketPosition, Array[UnsignedInteger]]
    private var labelSets = mutable.ListBuffer[mutable.Set[UnsignedInteger]]()
    private var labelMaps = mutable.ListBuffer[mutable.HashMap[UnsignedInteger, UnsignedInteger]]()
    def addLabelSet(labelSet: mutable.Set[UnsignedInteger]): Unit = labelSets += labelSet

    private def prepareLabelMaps(): Unit =
      if (labelSets.isEmpty || labelMaps.nonEmpty) {
        ()
      } else {
        var i: UnsignedInteger = UnsignedInteger.zeroFromElementClass(elementClass).increment
        labelSets.toList.foreach { labelSet =>
          var labelMap = mutable.HashMap.empty[UnsignedInteger, UnsignedInteger]
          labelSet.foreach { label =>
            labelMap += ((label, i))
            i = i.increment
          }
          labelMaps += labelMap
        }
      }

    def add(sourceVolumeIndex: Int, bucketPosition: BucketPosition, data: Array[Byte]): Unit =
      if (data.length > 1) { // skip reverted buckets
        val dataTyped: Array[UnsignedInteger] = UnsignedIntegerArray.fromByteArray(data, elementClass)
        prepareLabelMaps()
        if (mergedVolume.contains(bucketPosition)) {
          val mutableBucketData = mergedVolume(bucketPosition)
          dataTyped.zipWithIndex.foreach {
            case (valueTyped, index) =>
              if (!valueTyped.isZero) {
                val byteValueMapped = if (labelMaps.isEmpty) valueTyped else labelMaps(sourceVolumeIndex)(valueTyped)
                mutableBucketData(index) = byteValueMapped
              }
          }
          mergedVolume += ((bucketPosition, mutableBucketData))
        } else {
          if (labelMaps.isEmpty) {
            mergedVolume += ((bucketPosition, dataTyped))
          } else {
            val dataMapped = dataTyped.map { byteValue =>
              if (!byteValue.isZero) {
                labelMaps(sourceVolumeIndex)(byteValue)
              } else byteValue
            }
            mergedVolume += ((bucketPosition, dataMapped))
          }
        }
      }

    def saveTo(layer: VolumeTracingLayer, version: Long, toCache: Boolean): Fox[Unit] =
      for {
        _ <- Fox.combined(mergedVolume.map {
          case (bucketPosition, bucketData) =>
            saveBucket(layer,
                       bucketPosition,
                       UnsignedIntegerArray.toByteArray(bucketData, elementClass),
                       version,
                       toCache)
        }.toList)
      } yield ()
  }

  def initializeWithData(tracingId: String, tracing: VolumeTracing, initialData: File): Box[_] = {
    if (tracing.version != 0L) {
      return Failure("Tracing has already been edited.")
    }

    val dataLayer = volumeTracingLayer(tracingId, tracing)

    ZipIO.withUnziped(initialData) {
      case (fileName, is) =>
        WKWFile.read(is) {
          case (header, buckets) =>
            if (header.numBlocksPerCube == 1) {
              parseWKWFilePath(fileName.toString).map { bucket =>
                val data = buckets.next()
                if (isAllZero(data)) {
                  Fox.successful(())
                } else {
                  saveBucket(dataLayer, bucket, data, tracing.version)
                }
              }
            }
        }
    }
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
      new WKWBucketStreamSink(dataLayer)(dataLayer.bucketProvider.bucketStream(1, Some(tracing.version)))

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

  @SuppressWarnings(Array("OptionGet")) //We suppress this warning because we check the option beforehand
  def duplicate(tracingId: String,
                tracing: VolumeTracing,
                fromTask: Boolean,
                dataSetBoundingBox: Option[BoundingBox]): Fox[String] = {
    val newTaskTracing = if (fromTask && dataSetBoundingBox.isDefined) {
      val newId = if (tracing.userBoundingBoxes.isEmpty) 1 else tracing.userBoundingBoxes.map(_.id).max + 1
      tracing
        .addUserBoundingBoxes(
          NamedBoundingBox(newId, Some("task bounding box"), Some(true), Some(getRandomColor()), tracing.boundingBox))
        .withBoundingBox(dataSetBoundingBox.get)
    } else tracing

    val newTracing = newTaskTracing.withCreatedTimestamp(System.currentTimeMillis()).withVersion(0)
    for {
      newId <- save(newTracing, None, newTracing.version)
      _ <- duplicateData(tracingId, tracing, newId, newTracing)
    } yield newId
  }

  def duplicateData(sourceId: String,
                    sourceTracing: VolumeTracing,
                    destinationId: String,
                    destinationTracing: VolumeTracing): Fox[Unit] =
    for {
      isTemporaryTracing <- isTemporaryTracing(sourceId)
      sourceDataLayer = volumeTracingLayer(sourceId, sourceTracing, isTemporaryTracing)
      buckets: Iterator[(BucketPosition, Array[Byte])] = sourceDataLayer.bucketProvider.bucketStream(1)
      destinationDataLayer = volumeTracingLayer(destinationId, destinationTracing)
      _ <- Fox.combined(buckets.map {
        case (bucketPosition, bucketData) =>
          saveBucket(destinationDataLayer, bucketPosition, bucketData, destinationTracing.version)
      }.toList)
    } yield ()

  private def volumeTracingLayer(tracingId: String,
                                 tracing: VolumeTracing,
                                 isTemporaryTracing: Boolean = false): VolumeTracingLayer =
    VolumeTracingLayer(tracingId,
                       tracing.boundingBox,
                       tracing.elementClass,
                       tracing.largestSegmentId,
                       isTemporaryTracing)

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
    val mergedVolume = new MergedVolume(elementClass)

    tracingSelectors.zip(tracings).foreach {
      case (selector, tracing) =>
        val dataLayer = volumeTracingLayer(selector.tracingId, tracing)
        val labelSet: mutable.Set[UnsignedInteger] = scala.collection.mutable.Set()
        val bucketStream: Iterator[(BucketPosition, Array[Byte])] =
          dataLayer.bucketProvider.bucketStream(1, Some(tracing.version))
        bucketStream.foreach {
          case (_, data) =>
            if (data.length > 1) { // skip reverted buckets
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
          dataLayer.bucketProvider.bucketStream(1, Some(tracing.version))
        bucketStream.foreach {
          case (bucketPosition, data) =>
            mergedVolume.add(sourceVolumeIndex, bucketPosition, data)
        }
    }
    val destinationDataLayer = volumeTracingLayer(newId, newTracing)
    mergedVolume.saveTo(destinationDataLayer, newTracing.version, toCache)
  }

}
