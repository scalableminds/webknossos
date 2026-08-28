package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.webknossos.tracingstore.tracings.{
  FossilDBClient,
  KeyValueStoreConversions,
  VersionedKeyValuePair
}
import com.typesafe.scalalogging.LazyLogging

import scala.annotation.tailrec

class VersionedFossilDbIterator(prefix: String, fossilDbClient: FossilDBClient, version: Option[Long] = None)
    extends Iterator[VersionedKeyValuePair[Array[Byte]]]
    with KeyValueStoreConversions
    with LazyLogging {
  private val batchSize = 64

  private var currentStartAfterKey: Option[String] = None
  private var currentBatchIterator: Iterator[VersionedKeyValuePair[Array[Byte]]] = fetchNext()
  private var nextKeyValuePair: Option[VersionedKeyValuePair[Array[Byte]]] = None

  private def fetchNext() =
    fossilDbClient.getMultipleKeys(currentStartAfterKey, Some(prefix), version, Some(batchSize))(wrapInBox).iterator

  private def fetchNextAndSave = {
    currentBatchIterator = fetchNext()
    currentBatchIterator
  }

  @tailrec
  private def getNextKeyValuePair: Option[VersionedKeyValuePair[Array[Byte]]] =
    if (currentBatchIterator.hasNext) {
      val keyValuePair = currentBatchIterator.next()
      currentStartAfterKey = Some(keyValuePair.key)
      Some(keyValuePair)
    } else {
      if (!fetchNextAndSave.hasNext) None
      else getNextKeyValuePair
    }

  override def hasNext: Boolean =
    if (nextKeyValuePair.isDefined) true
    else {
      nextKeyValuePair = getNextKeyValuePair
      nextKeyValuePair.isDefined
    }

  override def next(): VersionedKeyValuePair[Array[Byte]] = {
    val nextRes = nextKeyValuePair match {
      case Some(value) => value
      case None        => getNextKeyValuePair.getOrElse(throw new NoSuchElementException())
    }
    nextKeyValuePair = None
    nextRes
  }

}
