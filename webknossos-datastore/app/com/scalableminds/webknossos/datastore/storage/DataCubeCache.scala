/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.storage

import com.newrelic.api.agent.NewRelic
import com.scalableminds.webknossos.datastore.dataformats.Cube
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import net.liftweb.common.{Box, Empty, Failure, Full}

import scala.concurrent.ExecutionContext.Implicits.global

case class CachedCube(
                       organization: String,
                       dataSourceName: String,
                       dataLayerName: String,
                       resolution: Int,
                       x: Int,
                       y: Int,
                       z: Int
                     )

object CachedCube {

  def from(loadInstruction: DataReadInstruction): CachedCube =
    CachedCube(
      loadInstruction.dataSource.id.organization,
      loadInstruction.dataSource.id.name,
      loadInstruction.dataLayer.name,
      loadInstruction.cube.resolution,
      loadInstruction.cube.x,
      loadInstruction.cube.y,
      loadInstruction.cube.z)
}

class FakeDataCubeCache extends FoxImplicits {

  def withCache[T](cubeReadInstruction: DataReadInstruction)(loadF: DataReadInstruction => Fox[Cube])(f: Cube => Box[T]): Fox[T] =
    loadF(cubeReadInstruction).flatMap(f(_).toFox)
}

class DataCubeCache(val maxEntries: Int) extends FakeDataCubeCache with LRUConcurrentCache[CachedCube, Fox[Cube]] {

  /**
    * Loads the due to x,y and z defined block into the cache array and
    * returns it.
    */
  override def withCache[T](readInstruction: DataReadInstruction)(loadF: DataReadInstruction => Fox[Cube])(f: Cube => Box[T]): Fox[T] = {
    val cachedCubeInfo = CachedCube.from(readInstruction)

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
        val cubeFox = loadF(readInstruction).futureBox.map {
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
