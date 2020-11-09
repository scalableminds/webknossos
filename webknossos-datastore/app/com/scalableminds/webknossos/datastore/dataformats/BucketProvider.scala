package com.scalableminds.webknossos.datastore.dataformats

import java.util.concurrent.TimeoutException

import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.storage.DataCubeCache
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Failure

import scala.concurrent.duration.FiniteDuration
import scala.concurrent.{Await, ExecutionContext, Future}

trait BucketProvider extends FoxImplicits with LazyLogging {

  def loadFromUnderlying(readInstruction: DataReadInstruction)(implicit ec: ExecutionContext): Fox[Cube] = Fox.empty

  def load(readInstruction: DataReadInstruction, cache: DataCubeCache, timeout: FiniteDuration)(
      implicit ec: ExecutionContext): Fox[Array[Byte]] = {

    def loadFromUnderlyingWithTimeout(readInstruction: DataReadInstruction): Fox[Cube] =
      Future {
        val t = System.currentTimeMillis
        val className = this.getClass.getName.split("\\.").last
        val result = Await.result(loadFromUnderlying(readInstruction).futureBox, timeout)
        val duration = System.currentTimeMillis - t
        if (duration > 500) {
          logger.warn(
            s"loading file in $className took too long.\n"
              + s"  duration: $duration\n"
              + s"  dataSource: ${readInstruction.dataSource.id.name}\n"
              + s"  dataLayer: ${readInstruction.dataLayer.name}\n"
              + s"  cube: ${readInstruction.cube}"
          )
        }
        result
      }.recover {
        case _: TimeoutException | _: InterruptedException =>
          logger.warn(s"Loading cube timed out. " +
            s"(${readInstruction.dataSource.id.team}/${readInstruction.dataSource.id.name}/${readInstruction.dataLayer.name}, " +
            s"Cube: (${readInstruction.cube.x}, ${readInstruction.cube.y}, ${readInstruction.cube.z})")
          Failure("dataStore.load.timeout")
      }

    cache.withCache(readInstruction)(loadFromUnderlyingWithTimeout)(
      _.cutOutBucket(readInstruction.dataLayer, readInstruction.bucket))
  }

  def bucketStream(version: Option[Long] = None): Iterator[(BucketPosition, Array[Byte])] =
    Iterator.empty
}
