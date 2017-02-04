/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.requester.handlers

import java.io.RandomAccessFile
import java.util.concurrent.TimeoutException

import com.scalableminds.braingames.binary.models._
import com.scalableminds.braingames.binary.requester.{Cube, DataCubeCache}
import com.scalableminds.braingames.binary.store._
import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.tools.ExtendedTypes.ExtendedRandomAccessFile
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Failure, Full}
import play.api.libs.concurrent.Execution.Implicits._

import scala.concurrent._
import scala.concurrent.duration.FiniteDuration

class KnossosCube(file: RandomAccessFile) extends Cube with LazyLogging {
  def cutOutBucket(requestedBucket: BucketReadInstruction): Box[Array[Byte]] = {
    val offset: VoxelPosition = requestedBucket.position.topLeft
    val bytesPerElement: Int = requestedBucket.dataLayer.bytesPerElement
    val bucketLength: Int = requestedBucket.dataSource.lengthOfLoadedBuckets
    val cubeLength: Int = requestedBucket.dataSource.cubeLength
    val bucketSize = bytesPerElement * bucketLength * bucketLength * bucketLength
    val result = new Array[Byte](bucketSize)

    val x = offset.x
    var y = offset.y
    var z = offset.z

    val yMax = offset.y + bucketLength
    val zMax = offset.z + bucketLength

    var idx = 0
    while (z < zMax) {
      y = offset.y
      while (y < yMax) {
        val cubeOffset =
          (x % cubeLength +
            y % cubeLength * cubeLength +
            z % cubeLength * cubeLength * cubeLength) * bytesPerElement
        if (!copyTo(cubeOffset, result, idx, bucketLength * bytesPerElement))
          logger.trace(s"Failed to copy from cube to bucket. " +
            s"DS: ${requestedBucket.dataSource.id}/${requestedBucket.dataLayer.name} Bucket: ${requestedBucket.position}")
        idx += bucketLength * bytesPerElement
        y += 1
      }
      z += 1
    }

    Full(result)
  }

  override protected def onFinalize(): Unit = {
    logger.trace(s"Closed file '${file.getPath}'")
    file.close()
  }

  private def copyTo(offset: Long, other: Array[Byte], destPos: Int, length: Int): Boolean = {
    var numReadBytes = 0
    val buffer = new Array[Byte](length)
    file.synchronized {
      file.seek(offset)
      numReadBytes = file.read(buffer)
    }
    if (numReadBytes > -1 ) {
      System.arraycopy(buffer, 0, other, destPos, numReadBytes)
      true
    } else {
      logger.trace(s"Failed to read data! Expected length '$length' " +
        s"got '$numReadBytes'. File: ${file.length} " +
        s"Closed? ${file.isClosed} Offset: $offset Path: ${file.getPath}")
      false
    }
  }
}

class KnossosBucketHandler(val cache: DataCubeCache)
  extends BucketHandler
    with FoxImplicits
    with LazyLogging {

  lazy val dataStore = new FileDataStore

  def loadFromUnderlying[T](loadCube: CubeReadInstruction, timeout: FiniteDuration)(f: Cube => Box[T]): Fox[T] = {
    Future {
      blocking {
        val bucket = dataStore.load(loadCube)
          .futureBox
          .map {
            case f: Failure =>
              f.exception.map(e => logger.warn("Load from store failed: " + f.msg, e))
              f
            case x =>
              x.flatMap(data => f(new KnossosCube(data)))
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

  override def saveToUnderlying(saveBucket: BucketWriteInstruction, timeout: FiniteDuration): Fox[Boolean] = {
    Future {
      blocking {
        val saveResult = dataStore.save(saveBucket).futureBox
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
