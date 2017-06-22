/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings.volume

import com.scalableminds.braingames.binary.dataformats.BucketProvider
import com.scalableminds.braingames.binary.models.datasource.{DataFormat, DataLayer, ElementClass, SegmentationLayer}
import com.scalableminds.util.geometry.BoundingBox
import play.api.libs.json.Json

case class VolumeTracingLayer(
                               name: String,
                               boundingBox: BoundingBox,
                               elementClass: ElementClass.Value,
                               largestSegmentId: Long
                             ) extends SegmentationLayer {

  val dataFormat: DataFormat.Value = DataFormat.tracing

  val lengthOfUnderlyingCubes: Int = lengthOfProvidedBuckets

  val resolutions: Set[Int] = Set(1)

  val mappings: Set[String] = Set.empty

  val bucketProvider: BucketProvider = new VolumeTracingBucketProvider(this)

  val mappingLoader = 0
}

object VolumeTracingLayer {
  implicit val volumeTracingLayerFormat = Json.format[VolumeTracingLayer]
}
