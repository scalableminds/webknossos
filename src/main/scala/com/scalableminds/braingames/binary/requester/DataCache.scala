/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.requester

import java.util.concurrent.atomic.{AtomicBoolean, AtomicInteger}

import com.newrelic.api.agent.NewRelic
import com.scalableminds.braingames.binary.models.{DataStoreBlock, LoadBlock}
import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging

import scala.concurrent.ExecutionContext.Implicits._

case class Data(value: Array[Byte]) extends AnyVal

case class CachedBlock(
                        id: String,
                        dataLayerId: String,
                        dataLayerName: String,
                        dataLayerBaseDir: String,
                        resolution: Int,
                        x: Int,
                        y: Int,
                        z: Int)

object CachedBlock {
  def from(b: DataStoreBlock): CachedBlock =
    CachedBlock(
                 b.dataSource.id,
                 b.dataLayerSection.sectionId,
                 b.dataLayer.name,
                 b.dataLayer.baseDir,
                 b.resolution,
                 b.block.x,
                 b.block.y,
                 b.block.z)
}

trait Cube extends LazyLogging{
  private val accessCounter = new AtomicInteger()
  private val scheduledForRemoval = new AtomicBoolean()

  def copyTo(offset: Long, other: Array[Byte], destPos: Int, length: Int): Boolean

  def startAccess(): Unit = {
    accessCounter.incrementAndGet()
  }

  def finishAccess(): Unit = {
    // Check if we are the last one to use this cube, if that is the case and the cube needs to be removed -> remove it
    val currentUsers = accessCounter.decrementAndGet()
    if(currentUsers == 0 && scheduledForRemoval.get())
      onFinalize()
  }

  def scheduleForRemoval(): Unit = {
    scheduledForRemoval.set(true)
    // Check if we can directly remove this cube (only possible if it is currently unused)
    if(accessCounter.get() == 0)
      onFinalize()
  }

  protected def onFinalize(): Unit = {}
}

/**
  * A data store implementation which uses the hdd as data storage
  */
trait DataCache {
  def cache: LRUConcurrentCache[CachedBlock, Cube]

  /**
    * Loads the due to x,y and z defined block into the cache array and
    * returns it.
    */
  def withCache[T](blockInfo: LoadBlock)(loadF: (Cube => T) => Fox[T])(f: Cube => T): Fox[T] = {
    val cachedBlockInfo = CachedBlock.from(blockInfo)

    cache.get(cachedBlockInfo) match {
      case Some(cube) =>
        cube.startAccess()
        NewRelic.incrementCounter("Custom/FileDataStore/Cache/hit")
        val result = f(cube)
        cube.finishAccess()
        Fox.successful(result)
      case _ =>
        loadF{ cube: Cube =>
          NewRelic.recordMetric("Custom/FileDataStore/Cache/size", cache.size())
          NewRelic.incrementCounter("Custom/FileDataStore/Cache/miss")
          cube.startAccess()
          cache.put(cachedBlockInfo, cube)
          val result = f(cube)
          cube.finishAccess()
          result
        }
    }
  }

  /**
    * Called when the store is restarted or going to get shutdown
    */
  def cleanUp(): Unit = {
    cache.clear()
  }
}
