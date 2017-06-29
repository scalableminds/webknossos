package com.scalableminds.braingames.datastore.tracings.volume

import com.scalableminds.braingames.binary.models.BucketPosition
import com.scalableminds.braingames.binary.store.kvstore.VersionedKeyValueStore
import net.liftweb.common.Box

trait VolumeTracingBucketHelper {

  implicit def tracingDataStore: VersionedKeyValueStore

  private def mortonEncode(x: Long, y: Long, z: Long): Long = {
    var morton = 0L
    val bitLength = math.ceil(math.log(List(x, y, z).max + 1) / math.log(2)).toInt

    (0 until bitLength).foreach { i =>
      morton |= ((x & (1L << i)) << (2 * i)) |
        ((y & (1L << i)) << (2 * i + 1)) |
        ((z & (1L << i)) << (2 * i + 2))
    }
    morton
  }

  private def buildBucketKey(dataLayerName: String, bucket: BucketPosition): String = {
    val mortonIndex = mortonEncode(bucket.x, bucket.y, bucket.z)
    s"/tracings/volume-data/$dataLayerName-${bucket.resolution}-$mortonIndex-${bucket.x}_${bucket.y}_${bucket.z}"
  }

  def loadBucket(dataLayerName: String, bucket: BucketPosition): Box[Array[Byte]] = {
    val key = buildBucketKey(dataLayerName, bucket)
    tracingDataStore.get(key).map(_.value)
  }

  def saveBucket(dataLayer: VolumeTracingLayer, bucket: BucketPosition, data: Array[Byte]): Box[Unit] = {
    val key = buildBucketKey(dataLayer.name, bucket)
    tracingDataStore.put(key, 1, data)
  }
}
