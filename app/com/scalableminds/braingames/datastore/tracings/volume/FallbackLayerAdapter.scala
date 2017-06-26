package com.scalableminds.braingames.datastore.tracings.volume

import com.scalableminds.braingames.binary.dataformats.BucketProvider
import com.scalableminds.braingames.binary.models.datasource._
import com.scalableminds.braingames.binary.models.requests.ReadInstruction
import com.scalableminds.braingames.binary.storage.DataCubeCache
import com.scalableminds.braingames.binary.store.kvstore.VersionedKeyValueStore
import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.util.tools.Fox
import net.liftweb.common.{Empty, Failure, Full}

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future
import scala.concurrent.duration.FiniteDuration

class FallbackBucketProvider(primary: DataLayer, fallback: DataLayer) extends BucketProvider {

  override def load(readInstruction: ReadInstruction, cache: DataCubeCache, tracingDataStore: VersionedKeyValueStore, timeout: FiniteDuration): Fox[Array[Byte]] = {
    val primaryReadInstruction = readInstruction.copy(dataLayer = primary)
    primary.bucketProvider.load(primaryReadInstruction, cache, tracingDataStore, timeout).futureBox.flatMap {
      case Full(data) =>
        Fox.successful(data)
      case Empty =>
        val fallbackReadInstruction = readInstruction.copy(dataLayer = fallback)
        fallback.bucketProvider.load(fallbackReadInstruction, cache, tracingDataStore, timeout)
      case f: Failure =>
        Future.successful(f)
    }
  }
}

class FallbackLayerAdapter(primary: SegmentationLayer, fallback: SegmentationLayer) extends SegmentationLayer {

  val name: String = s"${primary.name}/${fallback.name}"

  lazy val boundingBox: BoundingBox = primary.boundingBox

  val resolutions: Set[Int] = primary.resolutions.union(fallback.resolutions)

  val elementClass: ElementClass.Value = primary.elementClass

  val dataFormat: DataFormat.Value = DataFormat.tracing

  val lengthOfUnderlyingCubes: Int = lengthOfProvidedBuckets

  val largestSegmentId: Long = math.max(primary.largestSegmentId, fallback.largestSegmentId)

  val mappings: Set[String] = primary.mappings

  lazy val bucketProvider: BucketProvider = new FallbackBucketProvider(primary, fallback)

  lazy val mappingLoader: Int = primary.mappingLoader
}
