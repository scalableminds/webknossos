/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.datastore.tracings.volume

import com.scalableminds.webknossos.datastore.binary.dataformats.{BucketProvider, MappingProvider}
import com.scalableminds.webknossos.datastore.binary.models.datasource._
import com.scalableminds.webknossos.datastore.binary.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.binary.storage.DataCubeCache
import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.util.tools.Fox
import net.liftweb.common.{Empty, Failure, Full}

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future
import scala.concurrent.duration.FiniteDuration

class FallbackBucketProvider(primary: DataLayer, fallback: DataLayer) extends BucketProvider {

  override def load(readInstruction: DataReadInstruction, cache: DataCubeCache, timeout: FiniteDuration): Fox[Array[Byte]] = {
    val primaryReadInstruction = readInstruction.copy(dataLayer = primary)
    primary.bucketProvider.load(primaryReadInstruction, cache, timeout).futureBox.flatMap {
      case Full(data) =>
        Fox.successful(data)
      case Empty =>
        val fallbackReadInstruction = readInstruction.copy(dataLayer = fallback)
        fallback.bucketProvider.load(fallbackReadInstruction, cache, timeout)
      case f: Failure =>
        Future.successful(f)
    }
  }
}

class FallbackLayerAdapter(primary: SegmentationLayer, fallback: SegmentationLayer) extends SegmentationLayer {

  val name: String = s"${primary.name}/${fallback.name}"

  lazy val boundingBox: BoundingBox = primary.boundingBox

  val resolutions: List[Int] = primary.resolutions.union(fallback.resolutions)

  val elementClass: ElementClass.Value = primary.elementClass

  val dataFormat: DataFormat.Value = DataFormat.tracing

  def lengthOfUnderlyingCubes(resolution: Int): Int = fallback.lengthOfUnderlyingCubes(resolution)

  val largestSegmentId: Long = math.max(primary.largestSegmentId, fallback.largestSegmentId)

  val mappings: Set[String] = primary.mappings

  lazy val bucketProvider: BucketProvider = new FallbackBucketProvider(primary, fallback)

  override lazy val mappingProvider: MappingProvider = fallback.mappingProvider
}
