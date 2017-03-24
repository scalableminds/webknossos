/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.requester.handlers

import java.io.{FileInputStream, RandomAccessFile}
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel
import java.nio.file.{Files, Path}
import java.util.concurrent.TimeoutException

import com.scalableminds.braingames.binary.models._
import com.scalableminds.braingames.binary.requester.{Cube, DataCubeCache}
import com.scalableminds.braingames.binary.store._
import com.scalableminds.util.tools.ExtendedTypes.ExtendedRandomAccessFile
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}
import org.apache.commons.lang3.reflect.FieldUtils
import play.api.libs.concurrent.Execution.Implicits._

import scala.concurrent._
import scala.concurrent.duration.FiniteDuration

object KnossosCube{
  def create(file: RandomAccessFile): KnossosCube = {
    val channel = new FileInputStream(file.getPath).getChannel
    val buffer = channel.map(FileChannel.MapMode.READ_ONLY, 0, channel.size())
    new KnossosCube(buffer, channel, file)
  }
}

class KnossosCube(mappedData: MappedByteBuffer, channel: FileChannel, raf: RandomAccessFile)
  extends Cube
    with LazyLogging {

  // We are using reflection here to access a couple of fields from the underlying mapped byte
  // buffer. Since the whole file will be memory mapped in the byte buffer, we can
  // read-access the buffer from different threads without locking. Using the random access file
  // or the buffer directly would need a mutex around the seeking and reading (as that is not thread safe).
  private val unsafe =
    FieldUtils.readField(mappedData, "unsafe", true)

  private val address =
    FieldUtils.readField(mappedData, "address", true).asInstanceOf[Long]

  private  val arrayBaseOffset =
    FieldUtils.readField(mappedData, "arrayBaseOffset", true).asInstanceOf[Long]

  private val unsafeCopy = {
    val m = unsafe.getClass.getDeclaredMethod("copyMemory",
      classOf[Object], classOf[Long], classOf[Object], classOf[Long], classOf[Long])
    m.setAccessible(true)
    m
  }

  def cutOutBucket(requestedBucket: BucketReadInstruction): Box[Array[Byte]] = {
    try {
      val offset: VoxelPosition = requestedBucket.position.topLeft
      val bytesPerElement = requestedBucket.dataLayer.bytesPerElement
      val bucketLength = requestedBucket.dataSource.lengthOfLoadedBuckets
      val cubeLength = requestedBucket.dataSource.cubeLength
      val bucketSize = bytesPerElement * bucketLength * bucketLength * bucketLength
      val result = new Array[Byte](bucketSize)

      val x = offset.x
      var y = offset.y
      var z = offset.z

      val yMax = offset.y + bucketLength
      val zMax = offset.z + bucketLength

      var idx = 0L
      while (z < zMax) {
        y = offset.y
        while (y < yMax) {
          val cubeOffset =
            (x % cubeLength +
              y % cubeLength * cubeLength +
              z % cubeLength * cubeLength * cubeLength) * bytesPerElement
          copyTo(cubeOffset, result, idx, bucketLength.toLong * bytesPerElement)
          idx += bucketLength * bytesPerElement
          y += 1
        }
        z += 1
      }
      Full(result)
    } catch {
      case e: Exception =>
        logger.error("Failed to cut out bucket: " + e.getMessage)
        Failure("Failed to cut bucket", Full(e), Empty)
    }
  }

  override protected def onFinalize(): Unit = {
    logger.trace(s"Closed file '${raf.getPath}'")
    channel.close()
    raf.close()
  }

  private def copyTo(offset: Long, other: Array[Byte], destPos: Long, length: java.lang.Long): Boolean = {
    // Any regularly called log statements in here should be avoided as they drastically slow down this method.
    if (offset + length <= mappedData.limit()) {
      try {
        val memOffset: java.lang.Long = address + offset
        val targetOffset: java.lang.Long = destPos + arrayBaseOffset
        // Anything that might go south here can result in a segmentation fault, so be careful!
        unsafeCopy.invoke(unsafe, null, memOffset, other, targetOffset, length)
        true
      } catch {
        case e: Exception =>
          // It might be tempting, but do not access the file here without synchronized!
          logger.error(s"Failed to read data! Expected length '$length' Offset: $offset. Exception: ${e.getMessage}", e)
          false
      }
    } else {
      false
    }
  }
}

class KnossosBucketHandler(val cache: DataCubeCache)
  extends BucketHandler
    with FoxImplicits
    with LazyLogging {

  lazy val dataStore = new FileDataStore

  def loadFromUnderlying(loadCube: CubeReadInstruction, timeout: FiniteDuration): Fox[KnossosCube] = {
    Future {
      blocking {
        val bucket = dataStore.load(loadCube)
          .futureBox
          .map {
            case f: Failure =>
              f.exception.map(e => logger.warn("Load from store failed: " + f.msg, e))
              f
            case x =>
              x.map(data => KnossosCube.create(data))
          }
        Await.result(bucket, timeout)
      }
    }.recover {
      case _: TimeoutException | _: InterruptedException =>
        logger.warn(s"Load from DS timed out. " +
          s"(${loadCube.dataSource.id}/${loadCube.dataLayerSection.baseDir}, " +
          s"Block: (${loadCube.position.x},${loadCube.position.y},${loadCube.position.z})")
        Failure("dataStore.load.timeout")
    }
  }

  private def selectOriginalFile(dataSource: DataSource, fallbackLayer: DataLayer, section: DataLayerSection, cubePosition: CubePosition): Option[Path] = {
    val readInstruction = CubeReadInstruction(dataSource,
                                            fallbackLayer,
                                            section,
                                            cubePosition,
                                            DataRequestSettings.default)
    val baseDir = DataStore.knossosBaseDir(readInstruction)
    val knossosFile = DataStore.knossosFilePath(baseDir,
                                                readInstruction.dataSource.id,
                                                cubePosition,
                                                DataLayer.fileExt(readInstruction.dataLayer.isCompressed))
    val fallbackFile = DataStore.fuzzyKnossosFile(baseDir,
                                                  readInstruction.dataSource.id,
                                                  cubePosition,
                                                  List(DataLayer.fileExt(readInstruction.dataLayer.isCompressed)))

    val files = fallbackFile match {
      case Some(fb) =>
        List(knossosFile, fb.toPath)
      case _ =>
        List(knossosFile)
    }
    files.filter(Files.exists(_)).headOption
  }

  private def getOriginalFile(saveBucket: BucketWriteInstruction): Option[Path] = {
    for {
      fallback <- saveBucket.dataLayer.fallback
      fallbackLayer <- saveBucket.dataSource.getDataLayer(fallback.layerName)
      cubePosition = saveBucket.position.toCube(saveBucket.dataSource.cubeLength)
      section <- fallbackLayer.sections.find(_.doesContainBucket(saveBucket.position))
      result <- selectOriginalFile(saveBucket.dataSource, fallbackLayer, section, cubePosition)
    } yield {
      result
    }
  }

  override def saveToUnderlying(saveBucket: BucketWriteInstruction, timeout: FiniteDuration): Fox[Boolean] = {
    Future {
      blocking {
        val originalFile = getOriginalFile(saveBucket)
        val saveResult = dataStore.save(saveBucket, originalFile).futureBox
        Await.result(saveResult, timeout)
      }
    }.recover {
      case _: TimeoutException | _: InterruptedException =>
        logger.warn(s"No response in time for block during save: " +
          s"(${saveBucket.dataSource.id}/${saveBucket.dataLayerSection.baseDir} ${saveBucket.position})")
        Failure("dataStore.save.timeout")
    }
  }
}
