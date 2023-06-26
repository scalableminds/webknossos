package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.wkw.WKWDataFormatHelper
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, ElementClass}
import com.scalableminds.webknossos.datastore.models.{BucketPosition, WebKnossosDataRequest}
import com.scalableminds.webknossos.datastore.services.DataConverter
import com.scalableminds.webknossos.tracingstore.tracings._
import com.scalableminds.webknossos.wrap.WKWMortonHelper
import com.typesafe.scalalogging.LazyLogging
import net.jpountz.lz4.{LZ4Compressor, LZ4Factory, LZ4FastDecompressor}
import net.liftweb.common.{Empty, Failure, Full}

import scala.annotation.tailrec
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

trait VolumeBucketReversionHelper {
  private def isRevertedBucket(data: Array[Byte]): Boolean = data sameElements Array[Byte](0)

  def isRevertedBucket(bucket: VersionedKeyValuePair[Array[Byte]]): Boolean = isRevertedBucket(bucket.value)
}

trait VolumeBucketCompression extends LazyLogging {

  private val lz4factory = LZ4Factory.fastestInstance
  private val compressor: LZ4Compressor = lz4factory.fastCompressor
  private val decompressor: LZ4FastDecompressor = lz4factory.fastDecompressor

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
    if (isAlreadyDecompressed) {
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

  def expectedUncompressedBucketSizeFor(dataLayer: DataLayer): Int =
    expectedUncompressedBucketSizeFor(dataLayer.elementClass)

  def expectedUncompressedBucketSizeFor(elementClass: ElementClass.Value): Int = {
    val bytesPerVoxel = ElementClass.bytesPerElement(elementClass)
    bytesPerVoxel * scala.math.pow(DataLayer.bucketLength, 3).intValue
  }
}

trait BucketKeys extends WKWMortonHelper with WKWDataFormatHelper with LazyLogging {
  protected def buildBucketKey(dataLayerName: String, bucket: BucketPosition): String = {
    val mortonIndex = mortonEncode(bucket.bucketX, bucket.bucketY, bucket.bucketZ)
    s"$dataLayerName/${bucket.mag.toMagLiteral(allowScalar = true)}/$mortonIndex-[${bucket.bucketX},${bucket.bucketY},${bucket.bucketZ}]"
  }

  protected def buildKeyPrefix(dataLayerName: String): String =
    s"$dataLayerName/"

  protected def parseBucketKey(key: String): Option[(String, BucketPosition)] = {
    val keyRx = "([0-9a-z-]+)/(\\d+|\\d+-\\d+-\\d+)/-?\\d+-\\[(\\d+),(\\d+),(\\d+)]".r

    key match {
      case keyRx(name, resolutionStr, xStr, yStr, zStr) =>
        val resolutionOpt = Vec3Int.fromMagLiteral(resolutionStr, allowScalar = true)
        resolutionOpt match {
          case Some(resolution) =>
            val x = xStr.toInt
            val y = yStr.toInt
            val z = zStr.toInt
            val bucket = BucketPosition(x * resolution.x * DataLayer.bucketLength,
                                        y * resolution.y * DataLayer.bucketLength,
                                        z * resolution.z * DataLayer.bucketLength,
                                        resolution,
                                        None)
            Some((name, bucket))
          case _ => None
        }

      case _ =>
        None
    }
  }

}

trait VolumeTracingBucketHelper
    extends KeyValueStoreImplicits
    with FoxImplicits
    with VolumeBucketCompression
    with DataConverter
    with BucketKeys
    with VolumeBucketReversionHelper {

  implicit def ec: ExecutionContext

  // used to store compound annotations
  private val temporaryVolumeDataTimeout: FiniteDuration = 70 minutes

  implicit def volumeDataStore: FossilDBClient
  implicit def temporaryVolumeDataStore: TemporaryVolumeDataStore

  private def loadBucketFromTemporaryStore(key: String) =
    temporaryVolumeDataStore.find(key).map(VersionedKeyValuePair(VersionedKey(key, 0), _))

  def loadBucket(dataLayer: VolumeTracingLayer,
                 bucket: BucketPosition,
                 version: Option[Long] = None): Fox[Array[Byte]] = {
    val key = buildBucketKey(dataLayer.name, bucket)

    val dataFox = loadBucketFromTemporaryStore(key) match {
      case Some(data) => Fox.successful(data)
      case None       => volumeDataStore.get(key, version, mayBeEmpty = Some(true))
    }
    val unpackedDataFox = dataFox.flatMap { versionedVolumeBucket =>
      if (isRevertedBucket(versionedVolumeBucket)) Fox.empty
      else {
        val debugInfo =
          s"key: $key, ${versionedVolumeBucket.value.length} bytes, version ${versionedVolumeBucket.version}"
        Fox.successful(
          decompressIfNeeded(versionedVolumeBucket.value, expectedUncompressedBucketSizeFor(dataLayer), debugInfo))
      }
    }
    unpackedDataFox.futureBox.flatMap {
      case Full(unpackedData) => Fox.successful(unpackedData)
      case Empty =>
        if (dataLayer.includeFallbackDataIfAvailable && dataLayer.tracing.fallbackLayer.nonEmpty) {
          loadFallbackBucket(dataLayer, bucket)
        } else Fox.empty
      case f: Failure => f.toFox
    }
  }

  private def loadFallbackBucket(dataLayer: VolumeTracingLayer, bucket: BucketPosition): Fox[Array[Byte]] = {
    val dataRequest: WebKnossosDataRequest = WebKnossosDataRequest(
      position = Vec3Int(bucket.topLeft.mag1X, bucket.topLeft.mag1Y, bucket.topLeft.mag1Z),
      mag = bucket.mag,
      cubeSize = dataLayer.lengthOfUnderlyingCubes(bucket.mag),
      fourBit = None,
      applyAgglomerate = dataLayer.tracing.mappingName,
      version = None,
      additionalCoordinates = None
    )
    for {
      remoteFallbackLayer <- dataLayer.volumeTracingService
        .remoteFallbackLayerFromVolumeTracing(dataLayer.tracing, dataLayer.name)
      (unmappedData, indices) <- dataLayer.volumeTracingService.getFallbackDataFromDatastore(remoteFallbackLayer,
                                                                                             List(dataRequest),
                                                                                             dataLayer.userToken)
      unmappedDataOrEmpty <- if (indices.isEmpty) Fox.successful(unmappedData) else Fox.empty
    } yield unmappedDataOrEmpty
  }

  protected def saveBucket(dataLayer: VolumeTracingLayer,
                           bucket: BucketPosition,
                           data: Array[Byte],
                           version: Long,
                           toTemporaryStore: Boolean = false): Fox[Unit] =
    saveBucket(dataLayer.name, dataLayer.elementClass, bucket, data, version, toTemporaryStore)

  protected def saveBucket(tracingId: String,
                           elementClass: ElementClass.Value,
                           bucket: BucketPosition,
                           data: Array[Byte],
                           version: Long,
                           toTemporaryStore: Boolean): Fox[Unit] = {
    val key = buildBucketKey(tracingId, bucket)
    val compressedBucket = compressVolumeBucket(data, expectedUncompressedBucketSizeFor(elementClass))
    if (toTemporaryStore) {
      // Note that this temporary store is for temporary volumes only (e.g. compound projects)
      // and cannot be used for download or versioning
      Fox.successful(temporaryVolumeDataStore.insert(key, compressedBucket, Some(temporaryVolumeDataTimeout)))
    } else {
      volumeDataStore.put(key, version, compressedBucket)
    }
  }

  def bucketStream(dataLayer: VolumeTracingLayer, version: Option[Long]): Iterator[(BucketPosition, Array[Byte])] = {
    val key = buildKeyPrefix(dataLayer.name)
    new BucketIterator(key, volumeDataStore, expectedUncompressedBucketSizeFor(dataLayer), version)
  }

  def bucketStreamWithVersion(dataLayer: VolumeTracingLayer,
                              version: Option[Long]): Iterator[(BucketPosition, Array[Byte], Long)] = {
    val key = buildKeyPrefix(dataLayer.name)
    new VersionedBucketIterator(key, volumeDataStore, expectedUncompressedBucketSizeFor(dataLayer), version)
  }

  def bucketStreamFromTemporaryStore(dataLayer: VolumeTracingLayer): Iterator[(BucketPosition, Array[Byte])] = {
    val keyPrefix = buildKeyPrefix(dataLayer.name)
    val keyValuePairs = temporaryVolumeDataStore.findAllConditionalWithKey(key => key.startsWith(keyPrefix))
    keyValuePairs.flatMap {
      case (bucketKey, data) =>
        parseBucketKey(bucketKey).map(tuple => (tuple._2, data))
    }.toIterator
  }
}

class VersionedBucketIterator(prefix: String,
                              volumeDataStore: FossilDBClient,
                              expectedUncompressedBucketSize: Int,
                              version: Option[Long] = None)
    extends Iterator[(BucketPosition, Array[Byte], Long)]
    with KeyValueStoreImplicits
    with VolumeBucketCompression
    with BucketKeys
    with FoxImplicits
    with VolumeBucketReversionHelper {
  private val batchSize = 64

  private var currentStartAfterKey: Option[String] = None
  private var currentBatchIterator: Iterator[VersionedKeyValuePair[Array[Byte]]] = fetchNext
  private var nextBucket: Option[VersionedKeyValuePair[Array[Byte]]] = None

  private def fetchNext =
    volumeDataStore.getMultipleKeys(currentStartAfterKey, Some(prefix), version, Some(batchSize)).toIterator

  private def fetchNextAndSave = {
    currentBatchIterator = fetchNext
    currentBatchIterator
  }

  @tailrec
  private def getNextNonRevertedBucket: Option[VersionedKeyValuePair[Array[Byte]]] =
    if (currentBatchIterator.hasNext) {
      val bucket = currentBatchIterator.next
      currentStartAfterKey = Some(bucket.key)
      if (isRevertedBucket(bucket) || parseBucketKey(bucket.key).isEmpty) {
        getNextNonRevertedBucket
      } else {
        Some(bucket)
      }
    } else {
      if (!fetchNextAndSave.hasNext) None
      else getNextNonRevertedBucket
    }

  override def hasNext: Boolean =
    if (nextBucket.isDefined) true
    else {
      nextBucket = getNextNonRevertedBucket
      nextBucket.isDefined
    }

  override def next: (BucketPosition, Array[Byte], Long) = {
    val nextRes = nextBucket match {
      case Some(bucket) => bucket
      case None         => getNextNonRevertedBucket.get
    }
    nextBucket = None
    parseBucketKey(nextRes.key)
      .map(key => {
        val debugInfo = s"key: ${nextRes.key}, ${nextRes.value.length} bytes, version ${nextRes.version}"
        (key._2, decompressIfNeeded(nextRes.value, expectedUncompressedBucketSize, debugInfo), nextRes.version)
      })
      .get
  }

}

class BucketIterator(prefix: String,
                     volumeDataStore: FossilDBClient,
                     expectedUncompressedBucketSize: Int,
                     version: Option[Long] = None)
    extends Iterator[(BucketPosition, Array[Byte])] {
  private val versionedBucketIterator =
    new VersionedBucketIterator(prefix, volumeDataStore, expectedUncompressedBucketSize, version)

  override def next: (BucketPosition, Array[Byte]) = {
    val tuple = versionedBucketIterator.next
    (tuple._1, tuple._2)
  }

  override def hasNext: Boolean = versionedBucketIterator.hasNext
}
