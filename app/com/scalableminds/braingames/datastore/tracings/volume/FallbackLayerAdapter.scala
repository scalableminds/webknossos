package com.scalableminds.braingames.datastore.tracings.volume

import com.scalableminds.braingames.binary.dataformats.BucketProvider
import com.scalableminds.braingames.binary.models.datasource.{Category, DataFormat, ElementClass, SegmentationLayer}
import com.scalableminds.util.geometry.BoundingBox

class FallbackLayerAdapter(primary: SegmentationLayer, fallback: SegmentationLayer) extends SegmentationLayer {

  val name: String = primary.name

  lazy val boundingBox: BoundingBox = primary.boundingBox

  val resolutions: Set[Int] = primary.resolutions.union(fallback.resolutions)

  val elementClass: ElementClass.Value = primary.elementClass

  val dataFormat: DataFormat.Value = DataFormat.tracing

  val lengthOfUnderlyingCubes: Int = lengthOfProvidedBuckets

  val largestSegmentId: Long = math.max(primary.largestSegmentId, fallback.largestSegmentId)

  val mappings: Set[String] = primary.mappings

  lazy val bucketProvider: BucketProvider = primary.bucketProvider

  lazy val mappingLoader: Int = primary.mappingLoader
}
