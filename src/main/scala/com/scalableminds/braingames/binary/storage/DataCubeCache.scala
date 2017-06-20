/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.storage

import com.newrelic.api.agent.NewRelic
import com.scalableminds.braingames.binary.dataformats.Cube
import com.scalableminds.braingames.binary.models.requests.CubeLoadInstruction
import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import net.liftweb.common.{Box, Empty, Failure, Full}

import scala.concurrent.ExecutionContext.Implicits.global

case class CachedCube(
                       team: String,
                       dataSourceName: String,
                       dataLayerName: String,
                       resolution: Int,
                       x: Int,
                       y: Int,
                       z: Int
                     )

object CachedCube {

  def from(loadInstruction: CubeLoadInstruction): CachedCube =
    CachedCube(
      loadInstruction.dataSource.id.team,
      loadInstruction.dataSource.id.name,
      loadInstruction.dataLayer.name,
      loadInstruction.position.resolution,
      loadInstruction.position.x,
      loadInstruction.position.y,
      loadInstruction.position.z)
}

class DataCubeCache(val maxEntries: Int) extends LRUConcurrentCache[CachedCube, Fox[Cube]] with FoxImplicits {

  /**
    * Loads the due to x,y and z defined block into the cache array and
    * returns it.
    */
  def withCache[T](cubeInstruction: CubeLoadInstruction)(loadF: CubeLoadInstruction => Fox[Cube])(f: Cube => Box[T]): Fox[T] = {
    val cachedCubeInfo = CachedCube.from(cubeInstruction)

    get(cachedCubeInfo) match {
      case Some(cubeFox) =>
        cubeFox.flatMap { cube =>
          cube.startAccess()
          NewRelic.incrementCounter("Custom/FileDataStore/Cache/hit")
          val result = f(cube)
          cube.finishAccess()
          result.toFox
        }
      case _ =>
        val cubeFox = loadF(cubeInstruction).futureBox.map {
          case Full(cube) =>
            cube.startAccess()
            Full(cube)
          case f: Failure =>
            remove(cachedCubeInfo)
            f
          case _ =>
            Empty
        }.toFox

        put(cachedCubeInfo, cubeFox)
        NewRelic.incrementCounter("Custom/FileDataStore/Cache/miss")
        NewRelic.recordMetric("Custom/FileDataStore/Cache/size", size())

        cubeFox.flatMap { cube =>
          val result = f(cube)
          cube.finishAccess()
          result
        }
    }
  }

  override def onElementRemoval(key: CachedCube, value: Fox[Cube]): Unit = {
    value.map(_.scheduleForRemoval())
  }
}
