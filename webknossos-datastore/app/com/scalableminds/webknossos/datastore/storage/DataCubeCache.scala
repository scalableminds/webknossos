package com.scalableminds.webknossos.datastore.storage

import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.DatasetArrayHandle
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Empty, Failure, Full}

import scala.concurrent.ExecutionContext

case class CachedCube(
    organization: String,
    dataSourceName: String,
    dataLayerName: String,
    resolution: Vec3Int,
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
      loadInstruction.cube.mag,
      loadInstruction.cube.x,
      loadInstruction.cube.y,
      loadInstruction.cube.z
    )
}

class DataCubeCache(val maxEntries: Int)
    extends LRUConcurrentCache[CachedCube, Fox[DatasetArrayHandle]]
    with FoxImplicits
    with LazyLogging {

  /**
    * Loads the due to x,y and z defined block into the cache array and
    * returns it.
    */
  def withCache[T](readInstruction: DataReadInstruction)(loadF: DataReadInstruction => Fox[DatasetArrayHandle])(
      f: DatasetArrayHandle => Fox[T])(implicit ec: ExecutionContext): Fox[T] = {
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
        for {
          result <- f(cube)
          _ = cube.finishAccess()
        } yield result
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

  override def onElementRemoval(key: CachedCube, value: Fox[DatasetArrayHandle]): Unit =
    value.map(_.scheduleForRemoval())
}
