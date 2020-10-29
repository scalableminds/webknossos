package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, MappingProvider}
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.storage.DataCubeCache
import com.scalableminds.util.geometry.{BoundingBox, Point3D}
import com.scalableminds.util.tools.Fox
import net.liftweb.common.{Empty, Failure, Full}

import scala.concurrent.{ExecutionContext, Future}
import scala.concurrent.duration.FiniteDuration

class FallbackBucketProvider(primary: DataLayer, fallback: DataLayer) extends BucketProvider {

  override def load(readInstruction: DataReadInstruction, cache: DataCubeCache, timeout: FiniteDuration)(
      implicit ec: ExecutionContext): Fox[Array[Byte]] = {
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

  val resolutions: List[Point3D] = primary.resolutions.union(fallback.resolutions)

  val elementClass: ElementClass.Value = primary.elementClass

  val dataFormat: DataFormat.Value = DataFormat.tracing

  def lengthOfUnderlyingCubes(resolution: Point3D): Int = fallback.lengthOfUnderlyingCubes(resolution)

  val largestSegmentId: Long = math.max(primary.largestSegmentId, fallback.largestSegmentId)

  val mappings: Option[Set[String]] = primary.mappings

  lazy val bucketProvider: BucketProvider = new FallbackBucketProvider(primary, fallback)

  override lazy val mappingProvider: MappingProvider = fallback.mappingProvider

  val defaultViewConfiguration = primary.defaultViewConfiguration

  val adminViewConfiguration = primary.adminViewConfiguration
}
