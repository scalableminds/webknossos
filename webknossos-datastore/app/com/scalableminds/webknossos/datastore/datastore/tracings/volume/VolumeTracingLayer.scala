/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.datastore.tracings.volume

import com.scalableminds.webknossos.datastore.binary.dataformats.BucketProvider
import com.scalableminds.webknossos.datastore.binary.models.BucketPosition
import com.scalableminds.webknossos.datastore.binary.models.datasource._
import com.scalableminds.webknossos.datastore.binary.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.binary.storage.DataCubeCache
import com.scalableminds.webknossos.datastore.binary.storage.kvstore.VersionedKeyValueStore
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
                               largestSegmentId: Long
                             )(implicit val volumeDataStore: VersionedKeyValueStore) extends SegmentationLayer {

  def lengthOfUnderlyingCubes(resolution: Int): Int = DataLayer.bucketLength

  val dataFormat: DataFormat.Value = DataFormat.tracing

  val bucketProvider: BucketProvider = new VolumeTracingBucketProvider(this)

  val mappings: Set[String] = Set.empty

  val resolutions: List[Int] = List(1)
}
