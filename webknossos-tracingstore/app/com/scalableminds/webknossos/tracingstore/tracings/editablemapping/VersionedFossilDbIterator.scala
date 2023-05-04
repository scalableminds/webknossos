package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.util.tools.FoxImplicits
import com.scalableminds.webknossos.tracingstore.tracings.{
  FossilDBClient,
  KeyValueStoreImplicits,
  VersionedKeyValuePair
}

import scala.annotation.tailrec

class VersionedFossilDbIterator(prefix: String, fossilDbClient: FossilDBClient, version: Option[Long] = None)
    extends Iterator[VersionedKeyValuePair[Array[Byte]]]
    with KeyValueStoreImplicits
    with FoxImplicits {
  private val batchSize = 64

  private var currentStartKey = prefix
  private var currentBatchIterator: Iterator[VersionedKeyValuePair[Array[Byte]]] = fetchNext
  private var nextKeyValuePair: Option[VersionedKeyValuePair[Array[Byte]]] = None

  private def fetchNext =
    fossilDbClient.getMultipleKeys(currentStartKey, Some(prefix), version, Some(batchSize)).toIterator

  private def fetchNextAndSave = {
    currentBatchIterator = fetchNext
    if (currentBatchIterator.hasNext) currentBatchIterator.next //in pagination, skip first entry because it was already the last entry of the previous batch
    currentBatchIterator
  }

  @tailrec
  private def getNextKeyValuePair: Option[VersionedKeyValuePair[Array[Byte]]] =
    if (currentBatchIterator.hasNext) {
      val keyValuePair = currentBatchIterator.next
      currentStartKey = keyValuePair.key
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

  override def next: VersionedKeyValuePair[Array[Byte]] = {
    val nextRes = nextKeyValuePair match {
      case Some(value) => value
      case None        => getNextKeyValuePair.get
    }
    nextKeyValuePair = None
    nextRes
  }

}
