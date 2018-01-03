/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.tracings.volume

import com.scalableminds.webknossos.datastore.binary.models.BucketPosition
import com.scalableminds.webknossos.datastore.binary.models.datasource.DataLayer
import com.scalableminds.webknossos.datastore.binary.storage.kvstore.{KeyValueStoreImplicits, VersionedKeyValueStore}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.wrap.WKWMortonHelper

import scala.concurrent.ExecutionContext.Implicits.global

trait VolumeTracingBucketHelper extends WKWMortonHelper with KeyValueStoreImplicits with FoxImplicits {

  implicit def volumeDataStore: VersionedKeyValueStore

  private def buildKeyPrefix(dataLayerName: String, resolution: Int): String = {
    s"$dataLayerName/${resolution}/"
  }

  private def buildBucketKey(dataLayerName: String, bucket: BucketPosition): String = {
    val mortonIndex = mortonEncode(bucket.x, bucket.y, bucket.z)
    s"$dataLayerName/${bucket.resolution}/$mortonIndex-[${bucket.x},${bucket.y},${bucket.z}]"
  }

  private def parseBucketKey(key: String): Option[(String, BucketPosition)] = {
    val keyRx = "([0-9a-z-]+)/(\\d+)/(\\d+)-\\[\\d+,\\d+,\\d+\\]".r

    key match {
      case keyRx(name, res, morton) =>
        val resolution = res.toInt
        val (x, y, z) = mortonDecode(morton.toLong)
        val bucket = new BucketPosition(
          x * resolution * DataLayer.bucketLength,
          y * resolution * DataLayer.bucketLength,
          z * resolution * DataLayer.bucketLength,
          resolution)
        Some((name, bucket))
      case _ =>
        None
    }
  }

  def loadBucket(dataLayer: VolumeTracingLayer, bucket: BucketPosition): Fox[Array[Byte]] = {
    val key = buildBucketKey(dataLayer.name, bucket)
    volumeDataStore.get(key).futureBox.map(_.toStream.headOption.map(_.value))
  }

  def saveBucket(dataLayer: VolumeTracingLayer, bucket: BucketPosition, data: Array[Byte]): Fox[_] = {
    val key = buildBucketKey(dataLayer.name, bucket)
    volumeDataStore.put(key, 0, data)
  }

  def bucketStream(dataLayer: VolumeTracingLayer, resolution: Int): Iterator[(BucketPosition, Array[Byte])] = {
    val key = buildKeyPrefix(dataLayer.name, resolution)
    volumeDataStore.scanKeys(key, Some(key)).flatMap { pair =>
      parseBucketKey(pair.key).map(key => (key._2 , pair.value))
    }
  }
}
