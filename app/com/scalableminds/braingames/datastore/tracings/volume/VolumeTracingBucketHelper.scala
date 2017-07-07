package com.scalableminds.braingames.datastore.tracings.volume

import com.scalableminds.braingames.binary.models.BucketPosition
import com.scalableminds.braingames.binary.store.kvstore.VersionedKeyValueStore
import com.scalableminds.webknossos.wrap.WKWMortonHelper
import net.liftweb.common.Box

trait VolumeTracingBucketHelper extends WKWMortonHelper {

  implicit def tracingDataStore: VersionedKeyValueStore

  private def buildKeyPrefix(dataLayerName: String, resolution: Int): String = {
    s"$dataLayerName/${resolution}/"
  }

  private def buildBucketKey(dataLayerName: String, bucket: BucketPosition): String = {
    val mortonIndex = mortonEncode(bucket.x, bucket.y, bucket.z)
    s"$dataLayerName/${bucket.resolution}/$mortonIndex-[${bucket.x},${bucket.y},${bucket.z}]"
  }

  private def parseBucketKey(key: String, bucketLength: Int): Option[(String, BucketPosition)] = {
    val keyRx = "([0-9a-z-]+)/(\\d+)/(\\d+)-\\[\\d+,\\d+,\\d+\\]".r

    key match {
      case keyRx(name, res, morton) =>
        val resolution = res.toInt
        val (x, y, z) = mortonDecode(morton.toLong)
        val bucket = new BucketPosition(
          x * resolution * bucketLength,
          y * resolution * bucketLength,
          z * resolution * bucketLength,
          resolution,
          bucketLength)
        Some((name, bucket))
      case _ =>
        None
    }
  }

  def loadBucket(dataLayer: VolumeTracingLayer, bucket: BucketPosition): Option[Array[Byte]] = {
    val key = buildBucketKey(dataLayer.name, bucket)
    tracingDataStore.get("volume-data", key).toStream.headOption.map(_.value)
  }

  def saveBucket(dataLayer: VolumeTracingLayer, bucket: BucketPosition, data: Array[Byte]): Box[Unit] = {
    val key = buildBucketKey(dataLayer.name, bucket)
    tracingDataStore.put("volume-data", key, 0, data)
  }

  def bucketStream(dataLayer: VolumeTracingLayer, resolution: Int): Iterator[(BucketPosition, Array[Byte])] = {
    val key = buildKeyPrefix(dataLayer.name, resolution)
    tracingDataStore.scanKeys("volume-data", key, Some(key)).flatMap { pair =>
      parseBucketKey(pair.key, dataLayer.lengthOfProvidedBuckets).map(key => (key._2 , pair.value))
    }
  }
}
