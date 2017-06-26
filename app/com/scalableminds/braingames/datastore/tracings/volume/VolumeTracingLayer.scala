/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings.volume

import com.scalableminds.braingames.binary.dataformats.BucketProvider
import com.scalableminds.braingames.binary.models.datasource.{DataFormat, ElementClass, SegmentationLayer}
import com.scalableminds.braingames.binary.models.requests.ReadInstruction
import com.scalableminds.braingames.binary.storage.DataCubeCache
import com.scalableminds.braingames.binary.store.kvstore.VersionedKeyValueStore
import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import play.api.libs.json.Json

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.FiniteDuration

class VolumeTracingBucketProvider(layer: VolumeTracingLayer)
  extends BucketProvider
    with VolumeTracingBucketHelper
    with FoxImplicits {

  override def load(readInstruction: ReadInstruction, cache: DataCubeCache, tracingDataStore: VersionedKeyValueStore, timeout: FiniteDuration): Fox[Array[Byte]] = {
    loadBucket(readInstruction.dataLayer.name, readInstruction.bucket)(tracingDataStore)
  }
}

case class VolumeTracingLayer(
                               name: String,
                               boundingBox: BoundingBox,
                               elementClass: ElementClass.Value,
                               largestSegmentId: Long,
                               resolutions: Set[Int] = Set(1),
                               mappings: Set[String] = Set.empty
                             ) extends SegmentationLayer {

  val dataFormat: DataFormat.Value = DataFormat.tracing

  val lengthOfUnderlyingCubes: Int = lengthOfProvidedBuckets

  val nextSegmentationId: Long = largestSegmentId + 1

  val bucketProvider: BucketProvider = new VolumeTracingBucketProvider(this)

  val mappingLoader = 0
}

object VolumeTracingLayer {

  val defaultElementClass = ElementClass.uint32

  val defaultLargestSegmentId = 1

  implicit val volumeTracingLayerFormat = Json.format[VolumeTracingLayer]
}
