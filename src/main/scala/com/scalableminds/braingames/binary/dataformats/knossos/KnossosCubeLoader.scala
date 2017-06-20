/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.dataformats.knossos

import java.io.{FileInputStream, FileNotFoundException, RandomAccessFile}
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel
import java.nio.file.Path

import com.newrelic.api.agent.NewRelic
import com.scalableminds.braingames.binary.dataformats.{Cube, CubeLoader}
import com.scalableminds.braingames.binary.models._
import com.scalableminds.braingames.binary.models.datasource.DataLayer
import com.scalableminds.braingames.binary.models.requests.CubeLoadInstruction
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.ExtendedTypes.ExtendedRandomAccessFile
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}
import org.apache.commons.lang3.reflect.FieldUtils
import play.api.libs.concurrent.Execution.Implicits._

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

  def cutOutBucket(dataLayer: DataLayer, bucket: BucketPosition): Box[Array[Byte]] = {
    try {
      val offset: VoxelPosition = bucket.topLeft
      val bytesPerElement = dataLayer.bytesPerElement
      val bucketLength = dataLayer.lengthOfProvidedBuckets
      val cubeLength = dataLayer.lengthOfUnderlyingCubes
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

object KnossosCube {

  def apply(file: RandomAccessFile): KnossosCube = {
    val channel = new FileInputStream(file.getPath).getChannel
    val buffer = channel.map(FileChannel.MapMode.READ_ONLY, 0, channel.size())
    new KnossosCube(buffer, channel, file)
  }
}


class KnossosCubeLoader extends CubeLoader with FoxImplicits with LazyLogging {

  /*private def loadCubeFromUnderlying(loadCube: CubeReadInstruction, section: KnossosDataLayerSection, timeout: FiniteDuration): Fox[KnossosCube] = {
    Future {
      blocking {
        val bucket = dataStore.load(loadCube, section)
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
          s"(${loadCube.dataSource.id}/${section.baseDir}, " +
          s"Block: (${loadCube.position.x},${loadCube.position.y},${loadCube.position.z})")
        Failure("dataStore.load.timeout")
    }
  }*/

  def load(cubeInstruction: CubeLoadInstruction): Fox[KnossosCube] = {
    cubeInstruction.dataLayer match {
      case layer: KnossosDataLayer =>
        for {
          section <- layer.sections.find(_.doesContainCube(cubeInstruction.position))
          knossosFile <- loadKnossosFile(cubeInstruction, section)
        } yield {
          KnossosCube(knossosFile)
        }
      case _ =>
        // This should never happen!
        val errorMsg = "DataStore failure: Unexpected layer type."
        logger.error(errorMsg)
        Failure(errorMsg)
    }
  }

  private def knossosFilePath(cubeInstruction: CubeLoadInstruction, section: KnossosSection): Path = {
    cubeInstruction.baseDir
      .resolve(cubeInstruction.dataSource.id.team)
      .resolve(cubeInstruction.dataSource.id.name)
      .resolve(cubeInstruction.dataLayer.name)
      .resolve(section.name)
      .resolve(cubeInstruction.position.resolution.toString)
      .resolve("x%04d".format(cubeInstruction.position.x))
      .resolve("y%04d".format(cubeInstruction.position.y))
      .resolve("z%04d".format(cubeInstruction.position.z))
  }

  private def loadKnossosFile(cubeInstruction: CubeLoadInstruction, section: KnossosSection): Box[RandomAccessFile] = {
    val dataDirectory = knossosFilePath(cubeInstruction, section)
    val knossosFileFilter = PathUtils.fileExtensionFilter(KnossosDataFormat.dataFileExtension) _
    PathUtils.listFiles(dataDirectory, knossosFileFilter).flatMap(_.headOption).flatMap { file =>
      try {
        logger.trace(s"Accessing file: ${file.toAbsolutePath}")
        val t = System.currentTimeMillis
        val r = new RandomAccessFile(file.toString, "r")
        NewRelic.recordResponseTimeMetric("Custom/FileDataStore/files-response-time", System.currentTimeMillis - t)
        NewRelic.incrementCounter("Custom/FileDataStore/files-loaded")
        Full(r)
      } catch {
        case e: FileNotFoundException =>
          logger.info(s"DataStore couldn't find file: ${file.toAbsolutePath}")
          Empty
        case e: Exception =>
          Failure(s"An exception occurred while trying to load: ${e.getMessage}")
      }
    }
  }
}
