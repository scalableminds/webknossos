/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings.volume

import java.io.File

import com.google.inject.Inject
import com.scalableminds.braingames.binary.dataformats.wkw.{WKWBucketStreamSink, WKWDataFormatHelper}
import com.scalableminds.braingames.datastore.tracings.{TracingDataStore, TracingService, TracingType}
import com.scalableminds.util.io.ZipIO
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.wrap.WKWFile
import net.liftweb.common.{Box, Failure}
import play.api.libs.iteratee.Enumerator

import scala.concurrent.ExecutionContext.Implicits.global
import scala.reflect._

class VolumeTracingService @Inject()(
                                      tracingDataStore: TracingDataStore
                                    ) extends TracingService[VolumeTracing] with VolumeTracingBucketHelper with WKWDataFormatHelper {

  implicit val volumeDataStore = tracingDataStore.volumeData

  implicit val tracingFormat = VolumeTracing.volumeTracingFormat

  implicit val tag = classTag[VolumeTracing]

  val tracingType = TracingType.volume

  val tracingStore = tracingDataStore.volumes

  def initializeWithData(tracing: VolumeTracing, initialData: File): Box[_] = {
    if (tracing.version != 0L) {
      return Failure("Tracing has already been edited.")
    }

    ZipIO.withUnziped(initialData) {
      case (fileName, is) =>
        WKWFile.read(is) {
          case (header, buckets) =>
            if (header.numBlocksPerCube == 1) {
              parseWKWFilePath(fileName.toString).map { bucket =>
                saveBucket(tracing.dataLayer, bucket, buckets.next())
              }
            }
        }
    }
  }

  def update(tracing: VolumeTracing, updates: List[VolumeUpdateAction]): Fox[_] = {
    /*updates.foldLeft[Fox[_]](Fox.successful(())) {
      case (_: Full[Unit], action: UpdateBucketVolumeAction) =>
        val resolution = math.pow(2, action.zoomStep).toInt
        val bucket = new BucketPosition(action.position.x, action.position.y, action.position.z, resolution)
        saveBucket(tracing.dataLayer, bucket, action.data)
      case (_: Full[Unit], _) =>
        Failure("Unknown action.")
      case (f, _) =>
        f
    }*/
    Fox.successful(())
  }

  def data(tracing: VolumeTracing): Enumerator[Array[Byte]] = {
    val layer = tracing.dataLayer
    val buckets = new WKWBucketStreamSink(layer)(layer.bucketProvider.bucketStream(1))

    Enumerator.outputStream { os =>
      ZipIO.zip(buckets.toList, os)
    }
  }
}
