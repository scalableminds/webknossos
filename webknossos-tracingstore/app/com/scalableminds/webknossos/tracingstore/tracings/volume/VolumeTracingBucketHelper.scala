package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{BoxImplicits, Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.wkw.WKWDataFormatHelper
import com.scalableminds.webknossos.datastore.models.datasource.{AdditionalAxis, DataLayer, ElementClass}
import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, BucketPosition, WebknossosDataRequest}
import com.scalableminds.webknossos.datastore.services.DataConverter
import com.scalableminds.webknossos.tracingstore.tracings._
import com.typesafe.scalalogging.LazyLogging
import net.jpountz.lz4.{LZ4Compressor, LZ4Factory, LZ4FastDecompressor}
import net.liftweb.common.Box.tryo
import net.liftweb.common.{Box, Empty, Failure, Full}

import scala.annotation.tailrec
import scala.collection.mutable.ListBuffer
import scala.concurrent.ExecutionContext

trait ReversionHelper {
  val revertedValue: Array[Byte] = Array[Byte](0)

  protected def isRevertedElement(data: Array[Byte]): Boolean = data.sameElements(revertedValue)

  protected def isRevertedElement(bucket: VersionedKeyValuePair[Array[Byte]]): Boolean = isRevertedElement(bucket.value)
}

trait VolumeBucketCompression extends LazyLogging {

  private val lz4factory = LZ4Factory.fastestInstance
  private val compressor: LZ4Compressor = lz4factory.fastCompressor
  private val decompressor: LZ4FastDecompressor = lz4factory.fastDecompressor

  protected def compressVolumeBucket(data: Array[Byte], expectedUncompressedBucketSize: Int): Array[Byte] =
    if (data.length == expectedUncompressedBucketSize) {
      val compressedData = compressor.compress(data)
      if (compressedData.length < data.length) {
        compressedData
      } else data
    } else {
      // assume already compressed
      data
    }

  protected def decompressIfNeeded(data: Array[Byte],
                                   expectedUncompressedBucketSize: Int,
                                   debugInfo: String): Array[Byte] = {
    val isAlreadyDecompressed = data.length == expectedUncompressedBucketSize
    if (isAlreadyDecompressed) {
      data
    } else {
      try {
        decompressor.decompress(data, expectedUncompressedBucketSize)
      } catch {
        case e: Exception =>
          logger.error(
            s"Failed to LZ4-decompress volume bucket ($debugInfo, compressed size: ${data.length}, expected uncompressed size $expectedUncompressedBucketSize): $e")
          throw e
      }
    }
  }

  protected def expectedUncompressedBucketSizeFor(dataLayer: DataLayer): Int =
    expectedUncompressedBucketSizeFor(dataLayer.elementClass)

  protected def expectedUncompressedBucketSizeFor(elementClass: ElementClass.Value): Int = {
    val bytesPerVoxel = ElementClass.bytesPerElement(elementClass)
    bytesPerVoxel * scala.math.pow(DataLayer.bucketLength, 3).intValue
  }
}

trait AdditionalCoordinateKey {
  protected def additionalCoordinatesKeyPart(additionalCoordinates: Seq[AdditionalCoordinate],
                                             additionalAxes: Seq[AdditionalAxis],
                                             prefix: String = ""): String = {
    // Bucket key additional coordinates need to be ordered to be found later.
    val valueMap = additionalCoordinates.map(a => a.name -> a.value).toMap
    val sortedValues = additionalAxes.sortBy(_.index).map(a => valueMap(a.name))
    if (sortedValues.nonEmpty) {
      f"$prefix${sortedValues.map(_.toString).mkString(",")}"
    } else {
      ""
    }
  }
}

trait BucketKeys extends WKWDataFormatHelper with AdditionalCoordinateKey {
  protected def buildBucketKey(volumeTracingId: String,
                               bucket: BucketPosition,
                               additionalAxes: Option[Seq[AdditionalAxis]]): String =
    (bucket.additionalCoordinates, additionalAxes, bucket.hasAdditionalCoordinates) match {
      case (Some(additionalCoordinates), Some(axes), true) =>
        s"$volumeTracingId/${bucket.mag.toMagLiteral(allowScalar = true)}/[${additionalCoordinatesKeyPart(
          additionalCoordinates,
          axes)}][${bucket.bucketX},${bucket.bucketY},${bucket.bucketZ}]"
      case _ =>
        s"$volumeTracingId/${bucket.mag.toMagLiteral(allowScalar = true)}/[${bucket.bucketX},${bucket.bucketY},${bucket.bucketZ}]"
    }

  protected def buildKeyPrefix(volumeTracingId: String): String =
    s"$volumeTracingId/"

  protected def parseBucketKey(key: String,
                               additionalAxes: Option[Seq[AdditionalAxis]]): Option[(String, BucketPosition)] =
    additionalAxes match {
      case Some(value) if value.nonEmpty => parseBucketKeyWithAdditionalAxes(key, value)
      case _                             => parseBucketKeyXYZ(key)
    }

  private def parseBucketKeyXYZ(key: String) = {
    val keyRx = "([0-9a-z-]+)/(\\d+|\\d+-\\d+-\\d+)/\\[(\\d+),(\\d+),(\\d+)]".r
    key match {
      case keyRx(name, magStr, xStr, yStr, zStr) =>
        getBucketPosition(xStr, yStr, zStr, magStr, None).map(bucketPosition => (name, bucketPosition))
      case _ =>
        None
    }
  }

  private def parseBucketKeyWithAdditionalAxes(
      key: String,
      additionalAxes: Seq[AdditionalAxis]): Option[(String, BucketPosition)] = {
    val additionalCoordinateCapture = Array.fill(additionalAxes.length)("(\\d+)").mkString(",")
    val keyRx = s"([0-9a-z-]+)/(\\d+|\\d+-\\d+-\\d+)/\\[$additionalCoordinateCapture]\\[(\\d+),(\\d+),(\\d+)]".r
    val matchOpt = keyRx.findFirstMatchIn(key)
    matchOpt match {
      case Some(aMatch) =>
        val name = aMatch.group(1)
        val magStr = aMatch.group(2)
        val xStr = aMatch.group(additionalAxes.length + 3)
        val yStr = aMatch.group(additionalAxes.length + 4)
        val zStr = aMatch.group(additionalAxes.length + 5)

        val additionalAxesIndexSorted = additionalAxes.sortBy(_.index)
        val additionalCoordinates: Seq[AdditionalCoordinate] =
          (3 until additionalAxes.length + 3).zipWithIndex.map(
            groupIndexAndAxisIndex =>
              AdditionalCoordinate(additionalAxesIndexSorted(groupIndexAndAxisIndex._2).name,
                                   aMatch.group(groupIndexAndAxisIndex._1).toInt))

        getBucketPosition(xStr, yStr, zStr, magStr, Some(additionalCoordinates)).map(bucketPosition =>
          (name, bucketPosition))

      case _ =>
        None
    }
  }

  private def getBucketPosition(xStr: String,
                                yStr: String,
                                zStr: String,
                                magStr: String,
                                additionalCoordinates: Option[Seq[AdditionalCoordinate]]): Option[BucketPosition] = {
    val magnOpt = Vec3Int.fromMagLiteral(magStr, allowScalar = true)
    magnOpt.map { mag =>
      val x = xStr.toInt
      val y = yStr.toInt
      val z = zStr.toInt
      BucketPosition(
        x * mag.x * DataLayer.bucketLength,
        y * mag.y * DataLayer.bucketLength,
        z * mag.z * DataLayer.bucketLength,
        mag,
        additionalCoordinates
      )
    }
  }

}

trait VolumeTracingBucketHelper
    extends KeyValueStoreImplicits
    with FoxImplicits
    with VolumeBucketCompression
    with DataConverter
    with BucketKeys
    with ReversionHelper {

  implicit def ec: ExecutionContext
  def volumeDataStore: FossilDBClient
  def temporaryTracingService: TemporaryTracingService

  def loadBuckets(volumeTracingLayer: VolumeTracingLayer,
                  bucketPositions: Seq[BucketPosition],
                  version: Option[Long]): Fox[Seq[Box[Array[Byte]]]] = {
    val bucketKeys = bucketPositions.map(buildBucketKey(volumeTracingLayer.name, _, volumeTracingLayer.additionalAxes))

    for {
      bucketKeyValueBoxesFromFossil <- if (volumeTracingLayer.isTemporaryTracing) {
        Fox.successful(temporaryTracingService.getVolumeBuckets(bucketKeys).map(option2Box))
      } else {
        volumeDataStore.getMultipleKeysByList(bucketKeys, version).map(_.map(_.map(_.value)))
      }
      bucketBoxesFromFossil = bucketKeyValueBoxesFromFossil
      bucketBoxesWithFallback <- addFallbackBucketData(volumeTracingLayer, bucketPositions, bucketBoxesFromFossil)
      bucketBoxesUnpacked = bucketBoxesWithFallback.map { bucketBox =>
        bucketBox.flatMap { volumeBucket: Array[Byte] =>
          if (isRevertedElement(volumeBucket)) Empty
          else {
            tryo(decompressIfNeeded(volumeBucket, expectedUncompressedBucketSizeFor(volumeTracingLayer), ""))
          }
        }
      }
    } yield bucketBoxesUnpacked
  }

  private def addFallbackBucketData(volumeTracingLayer: VolumeTracingLayer,
                                    bucketPositions: Seq[BucketPosition],
                                    bucketBoxesFromFossil: Seq[Box[Array[Byte]]]): Fox[Seq[Box[Array[Byte]]]] =
    if (!volumeTracingLayer.includeFallbackDataIfAvailable || volumeTracingLayer.tracing.fallbackLayer.isEmpty) {
      Fox.successful(bucketBoxesFromFossil)
    } else {
      for {
        remoteFallbackLayer <- volumeTracingLayer.volumeTracingService
          .remoteFallbackLayerForVolumeTracing(volumeTracingLayer.tracing, volumeTracingLayer.annotationId)
        _ <- BoxImplicits.assertNoFailure(bucketBoxesFromFossil).toFox
        indicesWhereEmpty = bucketBoxesFromFossil.zipWithIndex.collect { case (dataBox, idx) if dataBox.isEmpty => idx }
        dataRequests = indicesWhereEmpty.map { idx =>
          val bucketPosition = bucketPositions(idx)
          WebknossosDataRequest(
            position = Vec3Int(bucketPosition.topLeft.mag1X, bucketPosition.topLeft.mag1Y, bucketPosition.topLeft.mag1Z),
            mag = bucketPosition.mag,
            cubeSize = volumeTracingLayer.lengthOfUnderlyingCubes(bucketPosition.mag),
            fourBit = None,
            applyAgglomerate = volumeTracingLayer.tracing.mappingName,
            version = None,
            additionalCoordinates = None
          )
        }
        (flatDataFromDataStore, datastoreMissingBucketIndices) <- volumeTracingLayer.volumeTracingService
          .getFallbackBucketsFromDataStore(remoteFallbackLayer, dataRequests)(volumeTracingLayer.tokenContext)
        bucketBoxesFromDataStore <- splitIntoBuckets(dataRequests.length,
                                                     flatDataFromDataStore,
                                                     datastoreMissingBucketIndices.toSet,
                                                     volumeTracingLayer.elementClass) ?~> "fallbackData.split.failed"
        _ <- bool2Fox(bucketBoxesFromDataStore.length == indicesWhereEmpty.length) ?~> "length mismatch"
        bucketBoxesFromDataStoreIterator = bucketBoxesFromDataStore.iterator
        bucketBoxesFilled = bucketBoxesFromFossil.map {
          case Full(bucketFromFossil) => Full(bucketFromFossil)
          case Empty                  => bucketBoxesFromDataStoreIterator.next()
          case f: Failure             => f
        }
      } yield bucketBoxesFilled
    }

  private def splitIntoBuckets(expectedBucketCount: Int,
                               flatDataFromDataStore: Array[Byte],
                               datastoreMissingBucketIndices: Set[Int],
                               elementClass: ElementClass.Value): Box[Seq[Box[Array[Byte]]]] = tryo {
    val bytesPerBucket = expectedUncompressedBucketSizeFor(elementClass)
    if ((expectedBucketCount - datastoreMissingBucketIndices.size) * bytesPerBucket != flatDataFromDataStore.length) {
      throw new IllegalStateException(
        s"bucket data array from datastore does not have expected length to be split into ${expectedBucketCount - datastoreMissingBucketIndices.length} buckets.")
    }
    var currentBucketIdx = 0
    var currentPosition = 0
    val bucketsMutable = ListBuffer[Box[Array[Byte]]]()
    for (_ <- 0 until expectedBucketCount) {
      if (datastoreMissingBucketIndices.contains(currentBucketIdx)) {
        bucketsMutable.append(Empty)
      } else {
        bucketsMutable.append(Full(flatDataFromDataStore.slice(currentPosition, currentPosition + bytesPerBucket)))
        currentPosition += bytesPerBucket
      }
      currentBucketIdx += 1
    }
    bucketsMutable.toList
  }

  def loadBucket(volumeTracingLayer: VolumeTracingLayer,
                 bucket: BucketPosition,
                 version: Option[Long] = None): Fox[Array[Byte]] = {
    val bucketKey = buildBucketKey(volumeTracingLayer.name, bucket, volumeTracingLayer.additionalAxes)

    val dataFox =
      if (volumeTracingLayer.isTemporaryTracing)
        temporaryTracingService.getVolumeBucket(bucketKey).map(VersionedKeyValuePair(VersionedKey(bucketKey, 0), _))
      else
        volumeDataStore.get(bucketKey, version, mayBeEmpty = Some(true))

    val unpackedDataFox: Fox[Array[Byte]] = dataFox.flatMap { versionedVolumeBucket =>
      if (isRevertedElement(versionedVolumeBucket)) Fox.empty
      else {
        val debugInfo =
          s"key: $bucketKey, ${versionedVolumeBucket.value.length} bytes, version ${versionedVolumeBucket.version}"
        Fox.successful(
          decompressIfNeeded(versionedVolumeBucket.value,
                             expectedUncompressedBucketSizeFor(volumeTracingLayer),
                             debugInfo))
      }
    }
    unpackedDataFox.futureBox.flatMap {
      case Full(unpackedData) =>
        Fox.successful(unpackedData)
      case Empty =>
        if (volumeTracingLayer.includeFallbackDataIfAvailable && volumeTracingLayer.tracing.fallbackLayer.nonEmpty) {
          for {
            remoteFallbackLayer <- volumeTracingLayer.volumeTracingService
              .remoteFallbackLayerForVolumeTracing(volumeTracingLayer.tracing, volumeTracingLayer.annotationId)
            fallbackBucket <- loadFallbackBucket(volumeTracingLayer, remoteFallbackLayer, bucket)
          } yield fallbackBucket
        } else Fox.empty
      case f: Failure =>
        f.toFox
    }
  }

  private def loadFallbackBucket(layer: VolumeTracingLayer,
                                 remoteFallbackLayer: RemoteFallbackLayer,
                                 bucket: BucketPosition): Fox[Array[Byte]] = {
    val dataRequest: WebknossosDataRequest = WebknossosDataRequest(
      position = Vec3Int(bucket.topLeft.mag1X, bucket.topLeft.mag1Y, bucket.topLeft.mag1Z),
      mag = bucket.mag,
      cubeSize = layer.lengthOfUnderlyingCubes(bucket.mag),
      fourBit = None,
      applyAgglomerate = layer.tracing.mappingName,
      version = None,
      additionalCoordinates = None
    )
    layer.volumeTracingService.getFallbackBucketFromDataStore(remoteFallbackLayer, dataRequest)(ec, layer.tokenContext)
  }

  protected def saveBucket(dataLayer: VolumeTracingLayer,
                           bucket: BucketPosition,
                           data: Array[Byte],
                           version: Long,
                           toTemporaryStore: Boolean = false): Fox[Unit] =
    saveBucket(dataLayer.tracingId,
               dataLayer.elementClass,
               bucket,
               data,
               version,
               toTemporaryStore,
               dataLayer.additionalAxes)

  protected def saveBucket(tracingId: String,
                           elementClass: ElementClass.Value,
                           bucket: BucketPosition,
                           data: Array[Byte],
                           version: Long,
                           toTemporaryStore: Boolean,
                           additionalAxes: Option[Seq[AdditionalAxis]]): Fox[Unit] = {
    val bucketKey = buildBucketKey(tracingId, bucket, additionalAxes)
    val compressedBucket = compressVolumeBucket(data, expectedUncompressedBucketSizeFor(elementClass))
    if (toTemporaryStore) {
      temporaryTracingService.saveVolumeBucket(bucketKey, compressedBucket)
    } else {
      volumeDataStore.put(bucketKey, version, compressedBucket)
    }
  }

  protected def saveBuckets(dataLayer: VolumeTracingLayer,
                            bucketPositions: Seq[BucketPosition],
                            bucketBytes: Seq[Array[Byte]],
                            version: Long,
                            toTemporaryStore: Boolean = false): Fox[Unit] = {
    val bucketKeys = bucketPositions.map(buildBucketKey(dataLayer.tracingId, _, dataLayer.additionalAxes))
    val expectedUncompressedSize = expectedUncompressedBucketSizeFor(dataLayer.elementClass)
    val compressedBuckets =
      bucketBytes.map(singleBucketBytes => compressVolumeBucket(singleBucketBytes, expectedUncompressedSize))
    if (toTemporaryStore) {
      temporaryTracingService.saveVolumeBuckets(bucketKeys.zip(compressedBuckets))
    } else {
      volumeDataStore.putMultiple(bucketKeys.zip(compressedBuckets), version)
    }
  }

  def bucketStream(dataLayer: VolumeTracingLayer, version: Option[Long]): Iterator[(BucketPosition, Array[Byte])] = {
    val keyPrefix = buildKeyPrefix(dataLayer.name)
    new BucketIterator(keyPrefix,
                       volumeDataStore,
                       expectedUncompressedBucketSizeFor(dataLayer),
                       version,
                       dataLayer.additionalAxes)
  }

  def bucketStreamWithVersion(dataLayer: VolumeTracingLayer,
                              version: Option[Long]): Iterator[(BucketPosition, Array[Byte], Long)] = {
    val keyPrefix = buildKeyPrefix(dataLayer.name)
    new VersionedBucketIterator(keyPrefix,
                                volumeDataStore,
                                expectedUncompressedBucketSizeFor(dataLayer),
                                version,
                                dataLayer.additionalAxes)
  }

  def bucketStreamFromTemporaryStore(dataLayer: VolumeTracingLayer): Iterator[(BucketPosition, Array[Byte])] = {
    val keyPrefix = buildKeyPrefix(dataLayer.name)
    val keyValuePairs = temporaryTracingService.getAllVolumeBucketsWithPrefix(keyPrefix)
    keyValuePairs.flatMap {
      case (bucketKey, data) =>
        parseBucketKey(bucketKey, dataLayer.additionalAxes).map(tuple => (tuple._2, data))
    }.iterator
  }
}

class VersionedBucketIterator(prefix: String,
                              volumeDataStore: FossilDBClient,
                              expectedUncompressedBucketSize: Int,
                              version: Option[Long] = None,
                              additionalAxes: Option[Seq[AdditionalAxis]])
    extends Iterator[(BucketPosition, Array[Byte], Long)]
    with KeyValueStoreImplicits
    with VolumeBucketCompression
    with BucketKeys
    with FoxImplicits
    with ReversionHelper {
  private val batchSize = 64

  private var currentStartAfterKey: Option[String] = None
  private var currentBatchIterator: Iterator[VersionedKeyValuePair[Array[Byte]]] = fetchNext
  private var nextBucket: Option[VersionedKeyValuePair[Array[Byte]]] = None

  private def fetchNext =
    volumeDataStore.getMultipleKeys(currentStartAfterKey, Some(prefix), version, Some(batchSize)).iterator

  private def fetchNextAndSave = {
    currentBatchIterator = fetchNext
    currentBatchIterator
  }

  @tailrec
  private def getNextNonRevertedBucket: Option[VersionedKeyValuePair[Array[Byte]]] =
    if (currentBatchIterator.hasNext) {
      val bucket = currentBatchIterator.next()
      currentStartAfterKey = Some(bucket.key)
      if (isRevertedElement(bucket) || parseBucketKey(bucket.key, additionalAxes).isEmpty) {
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

  override def next(): (BucketPosition, Array[Byte], Long) = {
    val nextRes = nextBucket match {
      case Some(bucket) => bucket
      case None         => getNextNonRevertedBucket.get
    }
    nextBucket = None
    parseBucketKey(nextRes.key, additionalAxes)
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
                     version: Option[Long] = None,
                     additionalAxes: Option[Seq[AdditionalAxis]])
    extends Iterator[(BucketPosition, Array[Byte])] {
  private val versionedBucketIterator =
    new VersionedBucketIterator(prefix, volumeDataStore, expectedUncompressedBucketSize, version, additionalAxes)

  override def next(): (BucketPosition, Array[Byte]) = {
    val tuple = versionedBucketIterator.next()
    (tuple._1, tuple._2)
  }

  override def hasNext: Boolean = versionedBucketIterator.hasNext
}
