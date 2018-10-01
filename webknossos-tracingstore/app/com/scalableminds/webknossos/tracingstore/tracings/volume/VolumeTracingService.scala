package com.scalableminds.webknossos.tracingstore.tracings.volume

import java.io.File
import java.nio.file.Paths

import com.google.inject.Inject
import com.scalableminds.util.geometry.Point3D
import com.scalableminds.webknossos.datastore.dataformats.wkw.{WKWBucketStreamSink, WKWDataFormatHelper}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.{DataSource, ElementClass, SegmentationLayer}
import com.scalableminds.webknossos.tracingstore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.tracingstore.tracings._
import com.scalableminds.util.io.{NamedStream, ZipIO}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.tracingstore.geometry.BoundingBox
import com.scalableminds.webknossos.datastore.models.DataRequestCollection.DataRequestCollection
import com.scalableminds.webknossos.datastore.models.requests.DataServiceDataRequest
import com.scalableminds.webknossos.datastore.services.BinaryDataService
import com.scalableminds.webknossos.wrap.WKWFile
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}

import scala.concurrent.duration._
import play.api.libs.iteratee.Enumerator

import scala.concurrent.ExecutionContext.Implicits.global

class VolumeTracingService @Inject()(
                                      tracingDataStore: TracingDataStore,
                                      val temporaryTracingStore: TemporaryTracingStore[VolumeTracing]
                                    )
  extends TracingService[VolumeTracing]
  with VolumeTracingBucketHelper
  with WKWDataFormatHelper
  with ProtoGeometryImplicits
  with FoxImplicits
  with LazyLogging {

  implicit val volumeDataStore = tracingDataStore.volumeData

  implicit val tracingCompanion = VolumeTracing

  implicit val updateActionReads = VolumeUpdateAction.volumeUpdateActionReads

  val tracingType = TracingType.volume

  val tracingStore = tracingDataStore.volumes

  /* We want to reuse the bucket loading methods from binaryDataService for the volume tracings, however, it does not
     actually load anything from disk, unlike its “normal” instance in the datastore (only from the volume tracing store) */
  val binaryDataService = new BinaryDataService(Paths.get(""), 10 seconds, 100)

  override def currentVersion(tracingId: String): Fox[Long] = tracingDataStore.volumes.getVersion(tracingId).getOrElse(0L)

  def handleUpdateGroup(tracingId: String, updateGroup: UpdateActionGroup[VolumeTracing]): Fox[_] = {
    updateGroup.actions.foldLeft(find(tracingId)) { (tracing, action) =>
      tracing.futureBox.flatMap {
        case Full(t) =>
          action match {
            case a: UpdateBucketVolumeAction =>
              val resolution = math.pow(2, a.zoomStep).toInt
              val bucket = new BucketPosition(a.position.x, a.position.y, a.position.z, Point3D(resolution, resolution, resolution))
              saveBucket(volumeTracingLayer(tracingId, t), bucket, a.data).map(_ => t)
            case a: UpdateTracingVolumeAction =>
              Fox.successful(t.copy(activeSegmentId = Some(a.activeSegmentId), editPosition = a.editPosition, editRotation = a.editRotation, largestSegmentId = a.largestSegmentId, zoomLevel = a.zoomLevel, userBoundingBox = a.userBoundingBox))
            case _ =>
              Fox.failure("Unknown action.")
          }
        case Empty =>
          Fox.empty
        case f: Failure =>
          Fox.failure(f.msg)
      }
    }.map(t => save(t.copy(version = updateGroup.version), Some(tracingId), updateGroup.version))
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
                saveBucket(dataLayer, bucket, buckets.next())
              }
            }
        }
    }
  }

  def allData(tracingId: String, tracing: VolumeTracing): Enumerator[Array[Byte]] = {
    val dataLayer = volumeTracingLayer(tracingId, tracing)
    val buckets = new WKWBucketStreamSink(dataLayer)(dataLayer.bucketProvider.bucketStream(1))

    Enumerator.outputStream { os =>
      ZipIO.zip(buckets, os)
    }
  }

  def data(tracingId: String, tracing: VolumeTracing, dataRequests: DataRequestCollection): Fox[(Array[Byte], List[Int])] = {
    val dataLayer = volumeTracingLayer(tracingId, tracing)

    val requests = dataRequests.map(r => DataServiceDataRequest(null, dataLayer, r.cuboid(dataLayer), r.settings))
    binaryDataService.handleDataRequests(requests)
  }

  def duplicate(tracingId: String, tracing: VolumeTracing): Fox[String] = {
    val newTracing = tracing.withCreatedTimestamp(System.currentTimeMillis()).withVersion(0)
    for {
      newId <- save(newTracing, None, newTracing.version)
      _ <- duplicateData(tracingId, tracing, newId, newTracing)
    } yield newId
  }

  def duplicateData(sourceId: String, sourceTracing: VolumeTracing, destinationId: String, destinationTracing: VolumeTracing) = {
    val sourceDataLayer = volumeTracingLayer(sourceId, sourceTracing)
    val destinationDataLayer = volumeTracingLayer(destinationId, destinationTracing)
    val buckets: Iterator[(BucketPosition, Array[Byte])] = sourceDataLayer.bucketProvider.bucketStream(1)
    for {
      _ <- Fox.combined(buckets.map { case (bucketPosition, bucketData) =>
              saveBucket(destinationDataLayer, bucketPosition, bucketData)
            }.toList)
    } yield ()
  }

  private def volumeTracingLayer(tracingId: String, tracing: VolumeTracing): VolumeTracingLayer = {
    VolumeTracingLayer(tracingId, tracing.boundingBox, tracing.elementClass, tracing.largestSegmentId)
  }

  private def volumeTracingLayerWithFallback(tracingId: String, tracing: VolumeTracing, dataSource: DataSource): SegmentationLayer = {
    val dataLayer = volumeTracingLayer(tracingId, tracing)
    tracing.fallbackLayer.flatMap(dataSource.getDataLayer).map {
      case layer: SegmentationLayer if dataLayer.elementClass == layer.elementClass =>
        new FallbackLayerAdapter(dataLayer, layer)
      case _ =>
        logger.error(s"Fallback layer is not a segmentation layer and thus being ignored. " +
          s"DataSource: ${dataSource.id}. FallbackLayer: ${tracing.fallbackLayer}.")
        dataLayer
    }.getOrElse(dataLayer)
  }

  def dataLayerForVolumeTracing(tracingId: String, dataSource: DataSource): Fox[SegmentationLayer] = {
    find(tracingId).map(volumeTracingLayerWithFallback(tracingId, _, dataSource))
  }
}
