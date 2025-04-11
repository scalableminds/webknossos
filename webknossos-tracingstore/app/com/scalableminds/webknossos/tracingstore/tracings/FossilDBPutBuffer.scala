package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging

import scala.collection.mutable
import scala.concurrent.ExecutionContext

class FossilDBPutBuffer(fossilDBClient: FossilDBClient, version: Option[Long] = None, maxElements: Int = 100)
    extends LazyLogging
    with FoxImplicits {

  private lazy val buffer: mutable.Map[(String, Long), Array[Byte]] =
    new mutable.HashMap[(String, Long), Array[Byte]]()

  def put(key: String, version: Long, value: Array[Byte])(implicit ec: ExecutionContext): Fox[Unit] =
    put(key, value, Some(version))

  def put(key: String, value: Array[Byte], version: Option[Long] = None)(implicit ec: ExecutionContext): Fox[Unit] =
    this.synchronized {
      for {
        versionToPut <- version
          .orElse(this.version)
          .toFox ?~> "FossilDBPutBuffer put without version (needs to be passed to put or to buffer)"
        _ = buffer.put((key, versionToPut), value)
        result <- if (isFull) {
          flush()
        } else Fox.successful(())
      } yield result
    }

  private def isFull = this.synchronized { size >= maxElements }

  private def isEmpty = this.synchronized { buffer.isEmpty }

  private def size = this.synchronized { buffer.size }

  def flush()(implicit ec: ExecutionContext): Fox[Unit] = this.synchronized {
    if (isEmpty) Fox.successful(())
    else {
      for {
        _ <- fossilDBClient.putMultipleWithIndividualVersions(buffer.toSeq)
        _ = buffer.clear()
      } yield ()
    }
  }

}
