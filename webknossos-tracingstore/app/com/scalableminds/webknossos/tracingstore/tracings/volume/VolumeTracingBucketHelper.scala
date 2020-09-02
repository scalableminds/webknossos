package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, ElementClass}
import com.scalableminds.webknossos.tracingstore.tracings.{
  FossilDBClient,
  KeyValueStoreImplicits,
  VersionedKeyValuePair
}
import com.scalableminds.webknossos.wrap.WKWMortonHelper
import com.typesafe.scalalogging.LazyLogging
import net.jpountz.lz4.{LZ4Compressor, LZ4Factory, LZ4FastDecompressor}

import scala.concurrent.ExecutionContext.Implicits.global

trait VolumeBucketCompression extends LazyLogging {

  private val lz4factory = LZ4Factory.fastestInstance
  val compressor: LZ4Compressor = lz4factory.fastCompressor
  val decompressor: LZ4FastDecompressor = lz4factory.fastDecompressor

  def compressVolumeBucket(data: Array[Byte], expectedUncompressedBucketSize: Int): Array[Byte] =
    if (data.length == expectedUncompressedBucketSize) {
      val compressedData = compressor.compress(data)
      if (compressedData.length < data.length) {
        compressedData
      } else data
    } else {
      // assume already compressed
      data
    }

  def decompressIfNeeded(data: Array[Byte], expectedUncompressedBucketSize: Int, debugInfo: String): Array[Byte] = {
    val isAlreadyDecompressed = data.length == expectedUncompressedBucketSize
    // revertToVersion overwrites buckets with a single zero to indicate the absence of data without deleting old versions
    val isRevertedBucket = data.length == 1
    if (isAlreadyDecompressed || isRevertedBucket) {
      data
    } else {
      try {
        decompressor.decompress(data, expectedUncompressedBucketSize)
      } catch {
        case e: Exception =>
          logger.error(
            s"Failed to LZ4-decompress volume bucket ($debugInfo, expected uncompressed size $expectedUncompressedBucketSize)")
          throw e
      }
    }
  }

  def expectedUncompressedBucketSizeFor(dataLayer: DataLayer): Int = {
    // frontend treats 8-byte segmentations as 4-byte segmentations,
    // truncating high IDs. Volume buckets will have at most 4-byte voxels
    val bytesPerVoxel = scala.math.min(ElementClass.bytesPerElement(dataLayer.elementClass), 4)
    bytesPerVoxel * scala.math.pow(DataLayer.bucketLength, 3).intValue
  }
}

trait VolumeTracingBucketHelper
    extends WKWMortonHelper
    with KeyValueStoreImplicits
    with FoxImplicits
    with VolumeBucketCompression {

  implicit def volumeDataStore: FossilDBClient

  private def buildKeyPrefix(dataLayerName: String, resolution: Int): String =
    s"$dataLayerName/${resolution}/"

  private def buildBucketKey(dataLayerName: String, bucket: BucketPosition): String = {
    val mortonIndex = mortonEncode(bucket.x, bucket.y, bucket.z)
    s"$dataLayerName/${bucket.resolution.maxDim}/$mortonIndex-[${bucket.x},${bucket.y},${bucket.z}]"
  }

  def loadBucket(dataLayer: VolumeTracingLayer,
                 bucket: BucketPosition,
                 version: Option[Long] = None): Fox[Array[Byte]] = {
    val key = buildBucketKey(dataLayer.name, bucket)
    volumeDataStore
      .get(key, version, mayBeEmpty = Some(true))
      .futureBox
      .map(
        _.toOption.map { versionedVolumeBucket =>
          if (versionedVolumeBucket.value sameElements Array[Byte](0)) Fox.empty
          else {
            val debugInfo =
              s"key: $key, ${versionedVolumeBucket.value.length} bytes, version ${versionedVolumeBucket.version}"
            Fox.successful(
              decompressIfNeeded(versionedVolumeBucket.value, expectedUncompressedBucketSizeFor(dataLayer), debugInfo))
          }
        }
      )
      .toFox
      .flatten
  }

  def saveBucket(dataLayer: VolumeTracingLayer, bucket: BucketPosition, data: Array[Byte], version: Long): Fox[Unit] = {
    val key = buildBucketKey(dataLayer.name, bucket)
    volumeDataStore.put(key, version, compressVolumeBucket(data, expectedUncompressedBucketSizeFor(dataLayer)))
  }

  def bucketStream(dataLayer: VolumeTracingLayer,
                   resolution: Int,
                   version: Option[Long]): Iterator[(BucketPosition, Array[Byte])] = {
    val key = buildKeyPrefix(dataLayer.name, resolution)
    new BucketIterator(key, volumeDataStore, expectedUncompressedBucketSizeFor(dataLayer), version)
  }

  def bucketStreamWithVersion(dataLayer: VolumeTracingLayer,
                              resolution: Int,
                              version: Option[Long]): Iterator[(BucketPosition, Array[Byte], Long)] = {
    val key = buildKeyPrefix(dataLayer.name, resolution)
    new VersionedBucketIterator(key, volumeDataStore, expectedUncompressedBucketSizeFor(dataLayer), version)
  }
}

class VersionedBucketIterator(prefix: String,
                              volumeDataStore: FossilDBClient,
                              expectedUncompressedBucketSize: Int,
                              version: Option[Long] = None)
    extends Iterator[(BucketPosition, Array[Byte], Long)]
    with WKWMortonHelper
    with KeyValueStoreImplicits
    with VolumeBucketCompression
    with FoxImplicits {
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

  override def hasNext: Boolean =
    if (currentBatchIterator.hasNext) true
    else fetchNextAndSave.hasNext

  override def next: (BucketPosition, Array[Byte], Long) = {
    val nextRes = currentBatchIterator.next
    currentStartKey = nextRes.key
    parseBucketKey(nextRes.key)
      .map(key => {
        val debugInfo = s"key: ${nextRes.key}, ${nextRes.value.length} bytes, version ${nextRes.version}"
        (key._2, decompressIfNeeded(nextRes.value, expectedUncompressedBucketSize, debugInfo), nextRes.version)
      })
      .get
  }

  private def parseBucketKey(key: String): Option[(String, BucketPosition)] = {
    val keyRx = "([0-9a-z-]+)/(\\d+)/-?\\d+-\\[(\\d+),(\\d+),(\\d+)\\]".r

    key match {
      case keyRx(name, resolutionStr, xStr, yStr, zStr) =>
        val resolution = resolutionStr.toInt
        val x = xStr.toInt
        val y = yStr.toInt
        val z = zStr.toInt
        val bucket = new BucketPosition(x * resolution * DataLayer.bucketLength,
                                        y * resolution * DataLayer.bucketLength,
                                        z * resolution * DataLayer.bucketLength,
                                        Point3D(resolution, resolution, resolution))
        Some((name, bucket))
      case _ =>
        None
    }
  }

}

class BucketIterator(prefix: String,
                     volumeDataStore: FossilDBClient,
                     expectedUncompressedBucketSize: Int,
                     version: Option[Long] = None)
    extends Iterator[(BucketPosition, Array[Byte])] {
  val versionedBucketIterator =
    new VersionedBucketIterator(prefix, volumeDataStore, expectedUncompressedBucketSize, version)

  override def next: (BucketPosition, Array[Byte]) = {
    val tuple = versionedBucketIterator.next
    (tuple._1, tuple._2)
  }

  override def hasNext: Boolean = versionedBucketIterator.hasNext
}
