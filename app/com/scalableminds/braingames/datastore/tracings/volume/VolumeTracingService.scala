/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings.volume

import java.io.File
import java.util.UUID

import com.google.inject.Inject
import com.scalableminds.braingames.binary.dataformats.wkw.{WKWBucketStreamSink, WKWDataFormatHelper}
import com.scalableminds.braingames.binary.models.BucketPosition
import com.scalableminds.braingames.binary.models.datasource.{DataSource, SegmentationLayer}
import com.scalableminds.braingames.datastore.tracings.TracingDataStore
import com.scalableminds.util.io.ZipIO
import com.scalableminds.webknossos.wrap.WKWFile
import net.liftweb.common.{Box, Failure, Full}
import play.api.libs.iteratee.Enumerator

import scala.concurrent.ExecutionContext.Implicits.global

class VolumeTracingService @Inject()(
                                      implicit val tracingDataStore: TracingDataStore
                                    ) extends VolumeTracingBucketHelper with WKWDataFormatHelper {

  private def buildTracingKey(id: String): String = s"/tracings/volumes/$id"

  def create(dataSource: DataSource, initialContent: Option[File]): VolumeTracing = {
    val fallbackLayer = dataSource.dataLayers.flatMap {
      case layer: SegmentationLayer => Some(layer)
      case _ => None
    }.headOption

    val tracingLayer = VolumeTracingLayer(
      UUID.randomUUID.toString,
      dataSource.boundingBox,
      fallbackLayer.map(_.elementClass).getOrElse(VolumeTracingLayer.defaultElementClass),
      fallbackLayer.map(_.largestSegmentId).getOrElse(VolumeTracingLayer.defaultLargestSegmentId)
    )

    val tracing = VolumeTracing(tracingLayer, fallbackLayer.map(_.name), fallbackLayer.map(_.largestSegmentId).getOrElse(0L) + 1)
    tracingDataStore.putJson(buildTracingKey(tracing.id), 1, tracing)

    initialContent.map { file =>
      ZipIO.withUnziped(file) {
        case (fileName, is) =>
          WKWFile.read(is) {
            case (header, buckets) =>
              if (header.numBlocksPerCube == 1) {
                parseWKWFilePath(fileName.toString, header.numBlocksPerCubeDimension).map { bucket =>
                  saveBucket(tracingLayer, bucket, buckets.next())
                }
              }
          }
      }
    }

    tracing
  }

  def update(tracing: VolumeTracing, updates: List[VolumeUpdateAction]): Box[Unit] = {
    updates.foldLeft[Box[Unit]](Full(())) {
      case (_: Full[Unit], action: LabelVolumeAction) =>
        val resolution = math.pow(2, action.zoomStep).toInt
        val bucket = new BucketPosition(action.position.x, action.position.y, action.position.z, resolution, tracing.dataLayer.lengthOfProvidedBuckets)
        saveBucket(tracing.dataLayer, bucket, action.data)
      case (_: Full[Unit], _) =>
        Failure("Unknown action.")
      case (f, _) =>
        f
    }
  }

  def download(tracing: VolumeTracing): Enumerator[Array[Byte]] = {
    val layer = tracing.dataLayer
    val buckets = new WKWBucketStreamSink(layer)(layer.bucketProvider.bucketStream(1))

    Enumerator.outputStream { os =>
      ZipIO.zip(buckets.toList, os)
    }
  }

  def find(id: String): Box[VolumeTracing] = {
    tracingDataStore.getJson[VolumeTracing](buildTracingKey(id)).map(_.value)
  }
}
