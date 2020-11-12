package com.scalableminds.webknossos.datastore.dataformats

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.storage.DataCubeCache
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty}

import scala.concurrent.ExecutionContext

trait BucketProvider extends FoxImplicits with LazyLogging {

  def loadFromUnderlying(readInstruction: DataReadInstruction): Box[Cube] = Empty

  def load(readInstruction: DataReadInstruction, cache: DataCubeCache)(
      implicit ec: ExecutionContext): Fox[Array[Byte]] = {

    def loadFromUnderlyingWithTimeout(readInstruction: DataReadInstruction): Box[Cube] = {
      val t = System.currentTimeMillis
      val result = loadFromUnderlying(readInstruction)
      val duration = System.currentTimeMillis - t
      if (duration > 500) {
        val className = this.getClass.getName.split("\\.").last
        logger.warn(
          s"loading file in $className took ${if (duration > 3000) "really " else ""}long.\n"
            + s"  duration: $duration\n"
            + s"  dataSource: ${readInstruction.dataSource.id.name}\n"
            + s"  dataLayer: ${readInstruction.dataLayer.name}\n"
            + s"  cube: ${readInstruction.cube}"
        )
      }
      result
    }

    cache.withCache(readInstruction)(loadFromUnderlyingWithTimeout)(
      _.cutOutBucket(readInstruction.dataLayer, readInstruction.bucket))
  }

  def bucketStream(version: Option[Long] = None): Iterator[(BucketPosition, Array[Byte])] =
    Iterator.empty
}
