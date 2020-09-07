package com.scalableminds.webknossos.tracingstore.tracings.volume

import java.io._
import java.nio.file.Paths

import com.google.inject.Inject
import com.scalableminds.util.geometry.{BoundingBox, Point3D}
import com.scalableminds.webknossos.datastore.dataformats.wkw.{WKWBucketStreamSink, WKWDataFormatHelper}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.{DataSource, SegmentationLayer}
import com.scalableminds.webknossos.tracingstore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.tracingstore.tracings._
import com.scalableminds.util.io.{NamedStream, ZipIO}
import com.scalableminds.util.tools.{Fox, FoxImplicits, TextUtils}
import com.scalableminds.webknossos.datastore.models.DataRequestCollection.DataRequestCollection
import com.scalableminds.webknossos.datastore.models.requests.DataServiceDataRequest
import com.scalableminds.webknossos.datastore.services.BinaryDataService

import collection.mutable.HashMap
import com.scalableminds.webknossos.tracingstore.{RedisTemporaryStore, TracingStoreConfig}
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
    config: TracingStoreConfig,
    val temporaryTracingStore: TemporaryTracingStore[VolumeTracing],
    val handledGroupIdStore: RedisTemporaryStore,
    val uncommittedUpdatesStore: RedisTemporaryStore,
    val temporaryFileCreator: TemporaryFileCreator
) extends TracingService[VolumeTracing]
    with VolumeTracingBucketHelper
    with WKWDataFormatHelper
    with ProtoGeometryImplicits
    with FoxImplicits
    with LazyLogging {

  implicit val volumeDataStore: FossilDBClient = tracingDataStore.volumeData

  implicit val tracingCompanion: VolumeTracing.type = VolumeTracing

  implicit val updateActionJsonFormat = VolumeUpdateAction.volumeUpdateActionFormat

  val tracingType = TracingType.volume

  val tracingStore = tracingDataStore.volumes

  val tracingMigrationService = VolumeTracingMigrationService

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
                val bucket = new BucketPosition(a.position.x,
                                                a.position.y,
                                                a.position.z,
                                                Point3D(resolution, resolution, resolution))
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

  def data(tracingId: String,
           tracing: VolumeTracing,
           dataRequests: DataRequestCollection): Fox[(Array[Byte], List[Int])] = {
    val dataLayer = volumeTracingLayer(tracingId, tracing)

    val requests = dataRequests.map(r => DataServiceDataRequest(null, dataLayer, None, r.cuboid(dataLayer), r.settings))
    binaryDataService.handleDataRequests(requests)
  }

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
                    destinationTracing: VolumeTracing): Fox[Unit] = {
    val sourceDataLayer = volumeTracingLayer(sourceId, sourceTracing)
    val destinationDataLayer = volumeTracingLayer(destinationId, destinationTracing)
    val buckets: Iterator[(BucketPosition, Array[Byte])] = sourceDataLayer.bucketProvider.bucketStream(1)
    for {
      _ <- Fox.combined(buckets.map {
        case (bucketPosition, bucketData) =>
          saveBucket(destinationDataLayer, bucketPosition, bucketData, destinationTracing.version)
      }.toList)
    } yield ()
  }

  private def volumeTracingLayer(tracingId: String, tracing: VolumeTracing): VolumeTracingLayer =
    VolumeTracingLayer(tracingId, tracing.boundingBox, tracing.elementClass, tracing.largestSegmentId)

  private def volumeTracingLayerWithFallback(tracingId: String,
                                             tracing: VolumeTracing,
                                             dataSource: DataSource): SegmentationLayer = {
    val dataLayer = volumeTracingLayer(tracingId, tracing)
    tracing.fallbackLayer
      .flatMap(dataSource.getDataLayer)
      .map {
        case layer: SegmentationLayer if dataLayer.elementClass == layer.elementClass =>
          new FallbackLayerAdapter(dataLayer, layer)
        case _ =>
          logger.error(
            s"Fallback layer is not a segmentation layer and thus being ignored. " +
              s"DataSource: ${dataSource.id}. FallbackLayer: ${tracing.fallbackLayer}.")
          dataLayer
      }
      .getOrElse(dataLayer)
  }

  def dataLayerForVolumeTracing(tracingId: String, dataSource: DataSource): Fox[SegmentationLayer] =
    find(tracingId).map(volumeTracingLayerWithFallback(tracingId, _, dataSource))

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

  def downsample(tracingId: String, tracing: VolumeTracing): Unit = {
    //TODO:
    // - skip if already downsampled
    // - figure out which resolutions to create
    // - list all keys first, before fetching actual data
    val data: List[VersionedKeyValuePair[Array[Byte]]] = tracingDataStore.volumeData.getMultipleKeys(tracingId, Some(tracingId))
    val keyValueMap = new mutable.HashMap[String,Array[Byte]]()  { override def default(key:String): Array[Byte] = Array[Byte](0) }
    val keys = data.map(_.key)
    data.foreach { keyValuePair: VersionedKeyValuePair[Array[Byte]] =>
      keyValueMap(keyValuePair.key) = keyValuePair.value
    }
    val originalBucketPositions: Seq[BucketPosition] = keys.flatMap(parseBucketKey).map(_._2)
    val originalMag = Point3D(1,1,1)
    val requiredMags = Seq(Point3D(2,2,1), Point3D(4,4,1), Point3D(8,8,2))
    requiredMags.foldLeft(originalMag) {
      (previousMag, requiredMag) =>
      logger.info(s"downsampling mag $requiredMag from mag $previousMag...")
      val requiredBucketPositions: mutable.HashSet[BucketPosition] = new mutable.HashSet[BucketPosition]()
      originalBucketPositions.foreach { bucketPosition: BucketPosition =>
        val downsampledBucketPosition = new BucketPosition((bucketPosition.globalX / requiredMag.x) * requiredMag.x,
          (bucketPosition.globalY / requiredMag.y) * requiredMag.y,
          (bucketPosition.globalZ / requiredMag.z) * requiredMag.z,
          requiredMag)
        requiredBucketPositions.add(downsampledBucketPosition)
      }
      val downScaleFactor = Point3D(requiredMag.x / previousMag.x, requiredMag.y / previousMag.y, requiredMag.z / previousMag.z)
      requiredBucketPositions.foreach { bucketPosition =>
        val sourceBuckets: Seq[BucketPosition] = for {
          z <- 0 until downScaleFactor.z
          y <- 0 until downScaleFactor.y
          x <- 0 until downScaleFactor.x
        } yield {
          new BucketPosition(bucketPosition.globalX + x * bucketPosition.bucketLength,
            bucketPosition.globalY + y * bucketPosition.bucketLength,
            bucketPosition.globalZ + z * bucketPosition.bucketLength,
            previousMag)
        }
      }
      requiredMag
    }
  }
}
