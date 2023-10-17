package com.scalableminds.webknossos.datastore.dataformats

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.storage.{DataCubeCache, RemoteSourceDescriptorService}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Empty

import scala.concurrent.ExecutionContext

trait BucketProvider extends FoxImplicits with LazyLogging {

  def remoteSourceDescriptorServiceOpt: Option[RemoteSourceDescriptorService]

  // To be defined in subclass.
  def openShardOrArrayHandle(readInstruction: DataReadInstruction)(implicit ec: ExecutionContext): Fox[DataCubeHandle] =
    Empty

  def load(readInstruction: DataReadInstruction, cache: DataCubeCache)(
      implicit ec: ExecutionContext): Fox[Array[Byte]] =
    cache.withCache(readInstruction)(openShardOrArrayHandleWithTimeout)(
      _.cutOutBucket(readInstruction.bucket, readInstruction.dataLayer))

  private def openShardOrArrayHandleWithTimeout(readInstruction: DataReadInstruction)(
      implicit ec: ExecutionContext): Fox[DataCubeHandle] = {
    val t = System.currentTimeMillis
    for {
      result <- openShardOrArrayHandle(readInstruction).futureBox
      duration = System.currentTimeMillis - t
      _ = if (duration > 500) {
        val className = this.getClass.getName.split("\\.").last
        logger.warn(
          s"Opening file in $className took ${if (duration > 3000) "really " else ""}long.\n"
            + s"  duration: $duration ms\n"
            + s"  dataSource: ${readInstruction.dataSource.id.name}\n"
            + s"  dataLayer: ${readInstruction.dataLayer.name}\n"
            + s"  cube: ${readInstruction.cube}"
        )
      }
    } yield result
  }

  def bucketStream(version: Option[Long] = None): Iterator[(BucketPosition, Array[Byte])] =
    Iterator.empty

}
