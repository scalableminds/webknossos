package com.scalableminds.webknossos.datastore.dataformats

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.datavault.{FileSystemVaultPath, VaultPath}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.storage.{DataCubeCache, RemoteSourceDescriptorService}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Empty

import scala.concurrent.ExecutionContext

trait BucketProvider extends FoxImplicits with LazyLogging {

  def remoteSourceDescriptorServiceOpt: Option[RemoteSourceDescriptorService]

  // To be defined in subclass.
  def loadFromUnderlying(readInstruction: DataReadInstruction)(implicit ec: ExecutionContext): Fox[DataCubeHandle] =
    Empty

  def load(readInstruction: DataReadInstruction, cache: DataCubeCache)(
      implicit ec: ExecutionContext): Fox[Array[Byte]] =
    cache.withCache(readInstruction)(loadFromUnderlyingWithTimeout)(_.cutOutBucket(readInstruction.bucket))

  private def loadFromUnderlyingWithTimeout(readInstruction: DataReadInstruction)(
      implicit ec: ExecutionContext): Fox[DataCubeHandle] = {
    val t = System.currentTimeMillis
    for {
      result <- loadFromUnderlying(readInstruction).futureBox
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

  protected def localPathFrom(readInstruction: DataReadInstruction, relativeMagPath: String)(
      implicit ec: ExecutionContext): Fox[VaultPath] = {
    val magPath = FileSystemVaultPath.fromPath(
      readInstruction.baseDir
        .resolve(readInstruction.dataSource.id.team)
        .resolve(readInstruction.dataSource.id.name)
        .resolve(readInstruction.dataLayer.name)
        .resolve(relativeMagPath))
    if (magPath.exists) {
      Fox.successful(magPath)
    } else Fox.empty
  }

}
