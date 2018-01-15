/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.tracings.volume

import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.BucketProvider
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.storage.DataCubeCache
import com.scalableminds.webknossos.datastore.tracings.FossilDBClient

import scala.concurrent.duration.FiniteDuration

class VolumeTracingBucketProvider(layer: VolumeTracingLayer)
  extends BucketProvider
    with VolumeTracingBucketHelper
    with FoxImplicits {

  val volumeDataStore: FossilDBClient = layer.volumeDataStore

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
                             )(implicit val volumeDataStore: FossilDBClient) extends SegmentationLayer {

  def lengthOfUnderlyingCubes(resolution: Int): Int = DataLayer.bucketLength

  val dataFormat: DataFormat.Value = DataFormat.tracing

  val bucketProvider: BucketProvider = new VolumeTracingBucketProvider(this)

  val mappings: Set[String] = Set.empty

  val resolutions: List[Int] = List(1)
}
