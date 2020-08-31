package com.scalableminds.webknossos.tracingstore.tracings.volume

import java.nio.{ByteBuffer, ByteOrder}

import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.util.tools.ExtendedTypes._
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, ElementClass}
import com.scalableminds.webknossos.datastore.services.DataConverter
import com.scalableminds.webknossos.tracingstore.tracings.{
  FossilDBClient,
  KeyValueStoreImplicits,
  VersionedKeyValuePair
}
import com.scalableminds.webknossos.wrap.WKWMortonHelper
import com.typesafe.scalalogging.LazyLogging
import net.jpountz.lz4.{LZ4Compressor, LZ4Factory, LZ4FastDecompressor}
import net.liftweb.common._
import spire.math.{UByte, UInt, ULong, UShort}

import scala.collection.mutable
import scala.concurrent.ExecutionContext.Implicits.global
import scala.reflect.ClassTag

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

  def decompressIfNeeded(data: Array[Byte], expectedUncompressedBucketSize: Int): Array[Byte] =
    if (data.length == expectedUncompressedBucketSize) {
      data
    } else {
      decompressor.decompress(data, expectedUncompressedBucketSize)
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
    with VolumeBucketCompression
    with DataConverter {

  implicit def volumeDataStore: FossilDBClient

  private def buildKeyPrefix(dataLayerName: String, resolution: Int): String =
    s"$dataLayerName/$resolution/"

  private def buildBucketKey(dataLayerName: String, bucket: BucketPosition): String = {
    val mortonIndex = mortonEncode(bucket.x, bucket.y, bucket.z)
    s"$dataLayerName/${formatResolution(bucket.resolution)}/$mortonIndex-[${bucket.x},${bucket.y},${bucket.z}]"
  }

  private def formatResolution(resolution: Point3D): String =
    if (resolution.x == resolution.y && resolution.x == resolution.z)
      s"${resolution.maxDim}"
    else
      s"${resolution.x}-${resolution.y}-${resolution.z}"

  def loadBucket(dataLayer: VolumeTracingLayer,
                 bucket: BucketPosition,
                 version: Option[Long] = None): Fox[Array[Byte]] = {
    val key = buildBucketKey(dataLayer.name, bucket)
    volumeDataStore
      .get(key, version, mayBeEmpty = Some(true))
      .futureBox
      .map(
        _.toOption match {
          case Some(versionedVolumeBucket) =>
            if (versionedVolumeBucket.value sameElements Array[Byte](0))
              if (bucket.resolution.maxDim == 1) Fox.empty else loadHigherResBuckets(dataLayer, bucket, version)
            else
              Fox.successful(
                decompressIfNeeded(versionedVolumeBucket.value, expectedUncompressedBucketSizeFor(dataLayer)))
          case _ =>
            if (bucket.resolution.maxDim == 1 || bucket.resolution.maxDim > 2) Fox.empty
            else loadHigherResBuckets(dataLayer, bucket, version)
        }
      )
      .toFox
      .flatten
  }

  def loadHigherResBuckets(dataLayer: VolumeTracingLayer, bucket: BucketPosition, version: Option[Long]) = {
    val downScaleFactor = bucket.resolution
    def downscale[T: ClassTag](data: Array[Array[T]])(nullElement: T) = {
      def downscaleImpl(data: Array[T]) = {
        def mode(a: Array[T]) = {
          val filtered = a.filterNot(_ == nullElement)
          if (filtered.isEmpty) nullElement
          else filtered.groupBy(i => i).mapValues(_.length).maxBy(_._2)._1
        }

        val factor = bucket.resolution
        val extensions = (bucket.bucketLength, bucket.bucketLength, bucket.bucketLength)

        val xGrouped = data.grouped(factor.x).toArray
        val yGroupedMap = xGrouped.zipWithIndex.groupBy(_._2 % (extensions._1 / factor.x))
        val yGrouped = yGroupedMap.values.map(_.map(_._1).grouped(factor.y).map(_.flatten).toArray)
        val zGroupedMap = yGrouped.map(_.zipWithIndex.groupBy(_._2 % (extensions._2 / factor.y)))
        val zGrouped = zGroupedMap.map(_.values.map(_.map(_._1).grouped(factor.z).map(_.flatten).toArray))
        val downScaled = zGrouped.map(yGrouped => yGrouped.map(xGrouped => xGrouped.map(mode)).toArray).toArray

        val res = mutable.ArrayBuffer[T]()
        for {
          z <- 0 until (extensions._3 / factor.z)
          y <- 0 until (extensions._2 / factor.y)
          x <- 0 until (extensions._1 / factor.x)
        } {
          res += downScaled(x)(y)(z)
        }
        res.toArray
      }
      val downScaledData = data.map(downscaleImpl)
      val res = mutable.ArrayBuffer[T]()
      for {
        z <- 0 until 32
        y <- 0 until 32
        x <- 0 until 32
      } {
        val numBox = x / 16 + y / 16 * 2 + z / 16 * 4
        val adjustedX = x - (x / 16) * 16
        val adjustedY = y - (y / 16) * 16
        val adjustedZ = z - (z / 16) * 16
        res += downScaledData(numBox)(adjustedX + 16 * adjustedY + 256 * adjustedZ)
      }
      res.toArray
    }

    val buckets = for {
      z <- 0 until downScaleFactor.z
      y <- 0 until downScaleFactor.y
      x <- 0 until downScaleFactor.x
    } yield {
      new BucketPosition(bucket.globalX + x * bucket.bucketLength,
                         bucket.globalY + y * bucket.bucketLength,
                         bucket.globalZ + z * bucket.bucketLength,
                         Point3D(1, 1, 1))
    }
    (for {
      dataBoxes <- Fox.serialSequence(buckets.toList)(loadBucket(dataLayer, _, version))
      data = if (dataBoxes.forall(_.isEmpty))
        Array.fill[Byte](bucket.volume * dataLayer.bytesPerElement)(0)
      else
        dataBoxes.flatMap {
          case Full(bytes) => bytes
          case _ =>
            Array.fill[Byte](bucket.volume * dataLayer.bytesPerElement)(0)
        }.toArray
      downscaledData = if (data.length == bucket.volume * dataLayer.bytesPerElement) data
      else
        convertData(data, dataLayer.elementClass) match {
          case data: Array[UByte] =>
            downscale[UByte](data.grouped(bucket.volume).toArray)(UByte(0))
              .foldLeft(
                ByteBuffer
                  .allocate(
                    dataLayer.bytesPerElement * data.length / downScaleFactor.x / downScaleFactor.y / downScaleFactor.z)
                  .order(ByteOrder.LITTLE_ENDIAN))((buf, el) => buf put el.toByte)
              .array
          case data: Array[UShort] =>
            downscale[UShort](data.grouped(bucket.volume).toArray)(UShort(0))
              .foldLeft(
                ByteBuffer
                  .allocate(
                    dataLayer.bytesPerElement * data.length / downScaleFactor.x / downScaleFactor.y / downScaleFactor.z)
                  .order(ByteOrder.LITTLE_ENDIAN))((buf, el) => buf putShort el.toShort)
              .array
          case data: Array[UInt] =>
            downscale[UInt](data.grouped(bucket.volume).toArray)(UInt(0))
              .foldLeft(
                ByteBuffer
                  .allocate(
                    dataLayer.bytesPerElement * data.length / downScaleFactor.x / downScaleFactor.y / downScaleFactor.z)
                  .order(ByteOrder.LITTLE_ENDIAN))((buf, el) => buf putInt el.toInt)
              .array
          case data: Array[ULong] =>
            downscale[ULong](data.grouped(bucket.volume).toArray)(ULong(0))
              .foldLeft(
                ByteBuffer
                  .allocate(
                    dataLayer.bytesPerElement * data.length / downScaleFactor.x / downScaleFactor.y / downScaleFactor.z)
                  .order(ByteOrder.LITTLE_ENDIAN))((buf, el) => buf putLong el.toLong)
              .array
          case _ => data
        }
    } yield downscaledData).toFox
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
  private val batchSize = 64

  private var currentStartKey = prefix
  private var currentBatchIterator: Iterator[VersionedKeyValuePair[Array[Byte]]] = fetchNext

  private def fetchNext =
    volumeDataStore.getMultipleKeys(currentStartKey, Some(prefix), version, Some(batchSize)).toIterator

  private def fetchNextAndSave = {
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
      .map(key => (key._2, decompressIfNeeded(nextRes.value, expectedUncompressedBucketSize), nextRes.version))
      .get
  }

  private def parseBucketKey(key: String): Option[(String, BucketPosition)] = {
    val keyRx = "([0-9a-z-]+)/(\\d+|\\d+-\\d+-\\d+)/-?\\d+-\\[(\\d+),(\\d+),(\\d+)]".r

    key match {
      case keyRx(name, resolutionStr, xStr, yStr, zStr) =>
        val resolutionOpt = parseResolution(resolutionStr)
        resolutionOpt match {
          case Some(resolution) =>
            val x = xStr.toInt
            val y = yStr.toInt
            val z = zStr.toInt
            val bucket = new BucketPosition(x * resolution.x * DataLayer.bucketLength,
                                            y * resolution.y * DataLayer.bucketLength,
                                            z * resolution.z * DataLayer.bucketLength,
                                            resolution)
            Some((name, bucket))
          case _ => None
        }

      case _ =>
        None
    }
  }

  private def parseResolution(resolutionStr: String): Option[Point3D] =
    resolutionStr.toIntOpt match {
      case Some(resolutionInt) => Some(Point3D(resolutionInt, resolutionInt, resolutionInt))
      case None =>
        val pattern = """(\d+)-(\d+)-(\d+)""".r
        resolutionStr match {
          case pattern(x, y, z) => Some(Point3D(x.toInt, y.toInt, z.toInt))
          case _                => None
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
