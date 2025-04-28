package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging

import scala.collection.mutable
import scala.concurrent.ExecutionContext

// Buffered writing to FossilDB.
// Caution: Caller is responsible to call a final flush() after putting everything
// Caution: Not thread safe! Make sure no concurrent access happens.
class FossilDBPutBuffer(fossilDBClient: FossilDBClient, version: Option[Long] = None, maxElements: Int = 100)
    extends LazyLogging
    with FoxImplicits {

  private lazy val buffer: mutable.Map[(String, Long), Array[Byte]] =
    new mutable.HashMap[(String, Long), Array[Byte]]()

  def put(key: String, version: Long, value: Array[Byte])(implicit ec: ExecutionContext): Fox[Unit] =
    put(key, value, Some(version))

  def put(key: String, value: Array[Byte], version: Option[Long] = None)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      versionToPut <- version
        .orElse(this.version)
        .toFox ?~> "FossilDBPutBuffer put without version (needs to be passed to put or to buffer)"
      _ = buffer.put((key, versionToPut), value)
      result <- if (isFull) {
        flush()
      } else Fox.successful(())
    } yield result

  private def isFull = size >= maxElements

  private def isEmpty = buffer.isEmpty

  private def size = buffer.size

  def flush()(implicit ec: ExecutionContext): Fox[Unit] =
    if (isEmpty) Fox.successful(())
    else {
      for {
        _ <- fossilDBClient.putMultipleWithIndividualVersions(buffer.toSeq)
        _ = buffer.clear()
      } yield ()
    }

}
