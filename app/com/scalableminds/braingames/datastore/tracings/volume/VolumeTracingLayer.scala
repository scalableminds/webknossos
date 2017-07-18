/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings.volume

import com.scalableminds.braingames.binary.dataformats.BucketProvider
import com.scalableminds.braingames.binary.models.BucketPosition
import com.scalableminds.braingames.binary.models.datasource.{Category, DataFormat, ElementClass, SegmentationLayer}
import com.scalableminds.braingames.binary.models.requests.DataReadInstruction
import com.scalableminds.braingames.binary.storage.DataCubeCache
import com.scalableminds.braingames.binary.storage.kvstore.VersionedKeyValueStore
import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import play.api.libs.json.Json

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.FiniteDuration

class VolumeTracingBucketProvider(layer: VolumeTracingLayer)
  extends BucketProvider
    with VolumeTracingBucketHelper
    with FoxImplicits {

  val volumeDataStore: VersionedKeyValueStore = layer.volumeDataStore

  override def load(readInstruction: DataReadInstruction, cache: DataCubeCache, timeout: FiniteDuration): Fox[Array[Byte]] = {
    loadBucket(layer, readInstruction.bucket)
  }

  override def bucketStream(resolution: Int): Iterator[(BucketPosition, Array[Byte])] = {
    bucketStream(layer, resolution)
  }
}

case class VolumeTracingLayer(
                               name: String,
                               boundingBox: BoundingBox,
                               elementClass: ElementClass.Value,
                               largestSegmentId: Long,
                               resolutions: List[Int] = List(1),
                               // can be removed, after all tracing stuff has been moved to datastore
                               mappings: Set[String] = Set.empty,
                               override val category: Category.Value = Category.segmentation
                             )(implicit val volumeDataStore: VersionedKeyValueStore) extends SegmentationLayer {

  val dataFormat: DataFormat.Value = DataFormat.tracing

  val lengthOfUnderlyingCubes: Int = lengthOfProvidedBuckets

  val nextSegmentationId: Long = largestSegmentId + 1

  val bucketProvider: BucketProvider = new VolumeTracingBucketProvider(this)
}

object VolumeTracingLayer {

  val defaultElementClass = ElementClass.uint32

  val defaultLargestSegmentId = 1

  implicit def volumeTracingLayerFormat(implicit volumeDataStore: VersionedKeyValueStore) = Json.format[VolumeTracingLayer]
}
