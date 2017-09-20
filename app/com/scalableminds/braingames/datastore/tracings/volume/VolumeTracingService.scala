/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings.volume

import java.io.File

import com.google.inject.Inject
import com.scalableminds.braingames.binary.dataformats.wkw.{WKWBucketStreamSink, WKWDataFormatHelper}
import com.scalableminds.braingames.binary.models.datasource.{DataSource, ElementClass, SegmentationLayer}
import com.scalableminds.braingames.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.braingames.datastore.tracings._
import com.scalableminds.util.io.ZipIO
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.wrap.WKWFile
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Failure}
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
  with LazyLogging {

  implicit val volumeDataStore = tracingDataStore.volumeData

  implicit val tracingCompanion = VolumeTracing

  val tracingType = TracingType.volume

  val tracingStore = tracingDataStore.volumes

  def initializeWithData(tracing: VolumeTracing, initialData: File): Box[_] = {
    if (tracing.version != 0L) {
      return Failure("Tracing has already been edited.")
    }

    val dataLayer = volumeTracingLayer(tracing)

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

  def data(tracing: VolumeTracing): Enumerator[Array[Byte]] = {
    val dataLayer = volumeTracingLayer(tracing)
    val buckets = new WKWBucketStreamSink(dataLayer)(dataLayer.bucketProvider.bucketStream(1))

    Enumerator.outputStream { os =>
      ZipIO.zip(buckets.toList, os)
    }
  }

  private def volumeTracingLayer(tracing: VolumeTracing): VolumeTracingLayer = {
    VolumeTracingLayer(tracing.boundingBox, tracing.elementClass, tracing.largestSegmentId)
  }

  private def volumeTracingLayerWithFallback(tracing: VolumeTracing, dataSource: DataSource): SegmentationLayer = {
    val dataLayer = volumeTracingLayer(tracing)
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
    find(tracingId).map(volumeTracingLayerWithFallback(_, dataSource))
  }
}
