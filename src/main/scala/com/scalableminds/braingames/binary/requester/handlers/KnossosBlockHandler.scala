/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.requester.handlers

import java.io.RandomAccessFile
import java.util.concurrent.TimeoutException

import akka.remote.transport.ActorTransportAdapter.AssociateUnderlying
import com.scalableminds.braingames.binary.models._
import com.scalableminds.braingames.binary.requester.{CachedBlock, Cube, DataCache, DataCubeCache}
import com.scalableminds.braingames.binary.store._
import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Failure
import play.api.libs.concurrent.Execution.Implicits._

import scala.concurrent._
import scala.concurrent.duration.FiniteDuration

class KnossosCube(file: RandomAccessFile) extends Cube with LazyLogging{
  override def copyTo(offset: Long, other: Array[Byte], destPos: Int, length: Int): Boolean = {
    var numReadBytes = 0
    val buffer = new Array[Byte](length)
    file.synchronized{
      file.seek(offset)
      numReadBytes = file.read(buffer)
    }
    if(numReadBytes == length) {
      System.arraycopy(buffer, 0, other, destPos, length)
      true
    } else {
      val method = file.getClass.getDeclaredField("closed")
      method.setAccessible(true)
      val isClosed = method.getBoolean(file)

      val method2 = file.getClass.getDeclaredField("path")
      method2.setAccessible(true)
      val path = method2.get(file).asInstanceOf[String]
      logger.error(s"Failed to read data! Expected length '$length' got '$numReadBytes'. File: ${file.length()} Closed? ${isClosed} Offset: $offset Path: $path") // TODO: add more usefull information
      false
    }
  }

  override protected def onFinalize(): Unit = {
    logger.info("closed file :)")
    file.close()
  }
}

class KnossosBlockHandler(val cache: DataCubeCache)
  extends BlockHandler
  with FoxImplicits
  with LazyLogging {

  lazy val dataStore = new FileDataStore

  def loadFromUnderlying[T](loadBlock: LoadBlock, timeout: FiniteDuration)(f: Cube => T): Fox[T] = {
    Future {
      blocking {
        val bucket = dataStore.load(loadBlock)
          .futureBox
          .map {
            case f: Failure =>
              f.exception.map( e => logger.warn("Load from store failed: " + f.msg, e))
              f
            case x =>
              x.map(data => f(new KnossosCube(data)))
          }
        Await.result(bucket, timeout)
      }
    }.recover {
      case _: TimeoutException | _: InterruptedException =>
        logger.warn(s"Load from DS timed out. " +
          s"(${loadBlock.dataSource.id}/${loadBlock.dataLayerSection.baseDir}, " +
          s"Block: ${loadBlock.block})")
        Failure("dataStore.load.timeout")
    }
  }

  def save(saveBlock: SaveBlock, timeout: FiniteDuration): Fox[Boolean] = {
    Future {
      blocking {
        val saveResult = dataStore.save(saveBlock).futureBox
        Await.result(saveResult, timeout)
      }
    }.recover {
      case _: TimeoutException | _: InterruptedException =>
        logger.warn(s"No response in time for block during save: " +
          s"(${saveBlock.dataSource.id }/${saveBlock.dataLayerSection.baseDir } ${saveBlock.block })")
        Failure("dataStore.save.timeout")
    }
  }
}
