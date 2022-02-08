package com.scalableminds.webknossos.datastore.storage

import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.DataCube
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import net.liftweb.common.{Box, Empty, Failure, Full}

import scala.concurrent.ExecutionContext.Implicits.global

case class CachedCube(
    organization: String,
    dataSourceName: String,
    dataLayerName: String,
    resolution: Point3D,
    x: Int,
    y: Int,
    z: Int
)

object CachedCube {

  def from(loadInstruction: DataReadInstruction): CachedCube =
    CachedCube(
      loadInstruction.dataSource.id.team,
      loadInstruction.dataSource.id.name,
      loadInstruction.dataLayer.name,
      loadInstruction.cube.resolution,
      loadInstruction.cube.x,
      loadInstruction.cube.y,
      loadInstruction.cube.z
    )
}

class DataCubeCache(val maxEntries: Int) extends LRUConcurrentCache[CachedCube, Fox[DataCube]] with FoxImplicits {

  /**
    * Loads the due to x,y and z defined block into the cache array and
    * returns it.
    */
  def withCache[T](readInstruction: DataReadInstruction)(loadF: DataReadInstruction => Fox[DataCube])(
      f: DataCube => Box[T]): Fox[T] = {
    val cachedCubeInfo = CachedCube.from(readInstruction)

    def handleUncachedCube(): Fox[T] = {
      val cubeFox = loadF(readInstruction).futureBox.map {
        case Full(cube) =>
          if (cube.tryAccess()) Full(cube)
          else Empty
        case f: Failure =>
          remove(cachedCubeInfo)
          f
        case _ =>
          Empty
      }.toFox

      put(cachedCubeInfo, cubeFox)

      cubeFox.flatMap { cube =>
        val result = f(cube)
        cube.finishAccess()
        result
      }
    }

    get(cachedCubeInfo) match {
      case Some(cubeFox) =>
        cubeFox.flatMap { cube =>
          if (cube.tryAccess()) {
            val result = f(cube)
            cube.finishAccess()
            result.toFox
          } else {
            handleUncachedCube()
          }
        }
      case _ => handleUncachedCube()
    }
  }

  override def onElementRemoval(key: CachedCube, value: Fox[DataCube]): Unit =
    value.map(_.scheduleForRemoval())
}
