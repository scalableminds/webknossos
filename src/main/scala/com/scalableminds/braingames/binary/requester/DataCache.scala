/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.requester

import java.util.concurrent.atomic.{AtomicBoolean, AtomicInteger}

import com.newrelic.api.agent.NewRelic
import com.scalableminds.braingames.binary.models.{BucketReadInstruction, CubeReadInstruction}
import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box

import scala.concurrent.ExecutionContext.Implicits._
import scala.concurrent.Future

case class Data(value: Array[Byte]) extends AnyVal

case class CachedCube(
                        id: String,
                        dataLayerId: String,
                        dataLayerName: String,
                        dataLayerBaseDir: String,
                        resolution: Int,
                        x: Int,
                        y: Int,
                        z: Int)

object CachedCube {
  def from(b: CubeReadInstruction): CachedCube =
    CachedCube(
                 b.dataSource.id,
                 b.dataLayerSection.sectionId,
                 b.dataLayer.name,
                 b.dataLayer.baseDir,
                 b.position.resolution,
                 b.position.x,
                 b.position.y,
                 b.position.z)
}

trait Cube extends LazyLogging{
  private val accessCounter = new AtomicInteger()
  private val scheduledForRemoval = new AtomicBoolean()

  def cutOutBucket(requestedCube: BucketReadInstruction): Box[Array[Byte]]

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
trait DataCache extends FoxImplicits{
  def cache: LRUConcurrentCache[CachedCube, Fox[Cube]]

  /**
    * Loads the due to x,y and z defined block into the cache array and
    * returns it.
    */
  def withCache[T](blockInfo: CubeReadInstruction)(loadF: => Fox[Cube])(f: Cube => Box[T]): Fox[T] = {
    val cachedBlockInfo = CachedCube.from(blockInfo)

    cache.get(cachedBlockInfo) match {
      case Some(cubeFox) =>
        cubeFox.flatMap { cube =>
          cube.startAccess()
          NewRelic.incrementCounter("Custom/FileDataStore/Cache/hit")
          val result = f(cube)
          cube.finishAccess()
          result.toFox
        }
      case _ =>
        val cubeF = loadF.map{ cube =>
          cube.startAccess()
          cube
        }
        cache.put(cachedBlockInfo,cubeF)
        NewRelic.incrementCounter("Custom/FileDataStore/Cache/miss")
        NewRelic.recordMetric("Custom/FileDataStore/Cache/size", cache.size())

        cubeF.flatMap{cube =>
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
