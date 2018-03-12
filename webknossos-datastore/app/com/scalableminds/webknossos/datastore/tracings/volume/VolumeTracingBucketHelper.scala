/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.tracings.volume

import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.datastore.tracings.{FossilDBClient, KeyValuePair, KeyValueStoreImplicits}
import com.scalableminds.webknossos.wrap.WKWMortonHelper

import scala.concurrent.ExecutionContext.Implicits.global

trait VolumeTracingBucketHelper extends WKWMortonHelper with KeyValueStoreImplicits with FoxImplicits {

  implicit def volumeDataStore: FossilDBClient

  private def buildKeyPrefix(dataLayerName: String, resolution: Int): String = {
    s"$dataLayerName/${resolution}/"
  }

  private def buildBucketKey(dataLayerName: String, bucket: BucketPosition): String = {
    val mortonIndex = mortonEncode(bucket.x, bucket.y, bucket.z)
    s"$dataLayerName/${bucket.resolution}/$mortonIndex-[${bucket.x},${bucket.y},${bucket.z}]"
  }

  def loadBucket(dataLayer: VolumeTracingLayer, bucket: BucketPosition): Fox[Array[Byte]] = {
    val key = buildBucketKey(dataLayer.name, bucket)
    volumeDataStore.get(key, mayBeEmpty = Some(true)).futureBox.map(_.toStream.headOption.map(_.value))
  }

  def saveBucket(dataLayer: VolumeTracingLayer, bucket: BucketPosition, data: Array[Byte]): Fox[_] = {
    val key = buildBucketKey(dataLayer.name, bucket)
    volumeDataStore.put(key, 0, data)
  }

  def bucketStream(dataLayer: VolumeTracingLayer, resolution: Int): Iterator[(BucketPosition, Array[Byte])] = {
    val key = buildKeyPrefix(dataLayer.name, resolution)
    new BucketIterator(key, volumeDataStore)
  }
}



class BucketIterator(prefix: String, volumeDataStore: FossilDBClient) extends Iterator[(BucketPosition, Array[Byte])] with WKWMortonHelper with KeyValueStoreImplicits with FoxImplicits  {
  val batchSize = 64

  var currentStartKey = prefix
  var currentBatchIterator: Iterator[KeyValuePair[Array[Byte]]] = fetchNext

  def fetchNext =
    volumeDataStore.getMultipleKeys(currentStartKey, Some(prefix), None, Some(batchSize)).toIterator

  def fetchNextAndSave = {
    currentBatchIterator = fetchNext
    if (currentBatchIterator.hasNext) currentBatchIterator.next //in pagination, skip first entry because it was already the last entry of the previous batch
    currentBatchIterator
  }

  override def hasNext: Boolean = {
    if (currentBatchIterator.hasNext) true
    else fetchNextAndSave.hasNext
  }

  override def next: (BucketPosition, Array[Byte]) = {
    val nextRes = currentBatchIterator.next
    currentStartKey = nextRes.key
    parseBucketKey(nextRes.key).map(key => (key._2 , nextRes.value)).get
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
          Point3D(resolution, resolution, resolution))
        Some((name, bucket))
      case _ =>
        None
    }
  }

}
