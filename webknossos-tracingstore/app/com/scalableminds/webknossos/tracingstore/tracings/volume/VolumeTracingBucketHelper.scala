package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.tracingstore.tracings.{FossilDBClient, VersionedKeyValuePair, KeyValueStoreImplicits}
import com.scalableminds.webknossos.wrap.WKWMortonHelper

import scala.concurrent.ExecutionContext.Implicits.global

trait VolumeTracingBucketHelper extends WKWMortonHelper with KeyValueStoreImplicits with FoxImplicits {

  implicit def volumeDataStore: FossilDBClient

  private def buildKeyPrefix(dataLayerName: String, resolution: Int): String = {
    s"$dataLayerName/${resolution}/"
  }

  private def buildBucketKey(dataLayerName: String, bucket: BucketPosition): String = {
    val mortonIndex = mortonEncode(bucket.x, bucket.y, bucket.z)
    s"$dataLayerName/${bucket.resolution.maxDim}/$mortonIndex-[${bucket.x},${bucket.y},${bucket.z}]"
  }

  def loadBucket(dataLayer: VolumeTracingLayer, bucket: BucketPosition, version: Option[Long] = None): Fox[Array[Byte]] = {
    val key = buildBucketKey(dataLayer.name, bucket)
    volumeDataStore.get(key, version, mayBeEmpty = Some(true)).futureBox.map(
      _.toOption.map { versionedVolumeBucket =>
        if(versionedVolumeBucket.value sameElements Array[Byte](0)) Fox.empty
        else Fox.successful(versionedVolumeBucket.value)
      }
    ).toFox.flatten
  }

  def saveBucket(dataLayer: VolumeTracingLayer, bucket: BucketPosition, data: Array[Byte], version: Long): Fox[_] = {
    val key = buildBucketKey(dataLayer.name, bucket)
    volumeDataStore.put(key, version, data)
  }

  def bucketStream(dataLayer: VolumeTracingLayer, resolution: Int, version: Option[Long]): Iterator[(BucketPosition, Array[Byte])] = {
    val key = buildKeyPrefix(dataLayer.name, resolution)
    new BucketIterator(key, volumeDataStore, version)
  }

  def bucketStreamWithVersion(dataLayer: VolumeTracingLayer, resolution: Int, version: Option[Long]): Iterator[(BucketPosition, Array[Byte], Long)] = {
    val key = buildKeyPrefix(dataLayer.name, resolution)
    new VersionedBucketIterator(key, volumeDataStore, version)
  }
}



class VersionedBucketIterator(prefix: String, volumeDataStore: FossilDBClient, version: Option[Long] = None) extends Iterator[(BucketPosition, Array[Byte], Long)] with WKWMortonHelper with KeyValueStoreImplicits with FoxImplicits  {
  val batchSize = 64

  var currentStartKey = prefix
  var currentBatchIterator: Iterator[VersionedKeyValuePair[Array[Byte]]] = fetchNext

  def fetchNext =
    volumeDataStore.getMultipleKeys(currentStartKey, Some(prefix), version, Some(batchSize)).toIterator

  def fetchNextAndSave = {
    currentBatchIterator = fetchNext
    if (currentBatchIterator.hasNext) currentBatchIterator.next //in pagination, skip first entry because it was already the last entry of the previous batch
    currentBatchIterator
  }

  override def hasNext: Boolean = {
    if (currentBatchIterator.hasNext) true
    else fetchNextAndSave.hasNext
  }

  override def next: (BucketPosition, Array[Byte], Long) = {
    val nextRes = currentBatchIterator.next
    currentStartKey = nextRes.key
    parseBucketKey(nextRes.key).map(key => (key._2 , nextRes.value, nextRes.version)).get
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

class BucketIterator(prefix: String, volumeDataStore: FossilDBClient, version: Option[Long] = None) extends Iterator[(BucketPosition, Array[Byte])]{
  val versionedBucketIterator = new VersionedBucketIterator(prefix, volumeDataStore, version)

  override def next: (BucketPosition, Array[Byte]) = {
    val tuple = versionedBucketIterator.next
    (tuple._1, tuple._2)
  }

  override def hasNext: Boolean = versionedBucketIterator.hasNext
}
