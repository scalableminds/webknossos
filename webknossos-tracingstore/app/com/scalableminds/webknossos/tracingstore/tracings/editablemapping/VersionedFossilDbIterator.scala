package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.util.tools.{Fox, FoxIterator}
import com.scalableminds.webknossos.tracingstore.tracings.{
  FossilDBClient,
  KeyValueStoreConversions,
  VersionedKeyValuePair
}
import com.typesafe.scalalogging.LazyLogging

import scala.concurrent.ExecutionContext

class VersionedFossilDbIterator(prefix: String, fossilDbClient: FossilDBClient, version: Option[Long] = None)(implicit
    ec: ExecutionContext
) extends FoxIterator[VersionedKeyValuePair[Array[Byte]]]
    with KeyValueStoreConversions
    with LazyLogging {
  private val batchSize = 64

  private var currentStartAfterKey: Option[String] = None
  private var currentBatch: Iterator[VersionedKeyValuePair[Array[Byte]]] = Iterator.empty
  private var batchesExhausted: Boolean = false

  private def fetchNextBatch(): Fox[Iterator[VersionedKeyValuePair[Array[Byte]]]] =
    fossilDbClient
      .getMultipleKeys(currentStartAfterKey, Some(prefix), version, Some(batchSize))(wrapInBox)
      .map(_.iterator)

  override def next(): Fox[VersionedKeyValuePair[Array[Byte]]] =
    if (currentBatch.hasNext) {
      val keyValuePair = currentBatch.next()
      currentStartAfterKey = Some(keyValuePair.key)
      Fox.successful(keyValuePair)
    } else if (batchesExhausted) {
      Fox.empty
    } else {
      for {
        fetchedBatch <- fetchNextBatch()
        result <- {
          currentBatch = fetchedBatch
          if (!currentBatch.hasNext) {
            batchesExhausted = true
            Fox.empty
          } else {
            next()
          }
        }
      } yield result
    }

}
