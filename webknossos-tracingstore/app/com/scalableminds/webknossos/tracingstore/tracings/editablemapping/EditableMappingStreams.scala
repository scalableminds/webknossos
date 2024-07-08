package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.webknossos.datastore.SegmentToAgglomerateProto.SegmentToAgglomerateChunkProto
import com.scalableminds.webknossos.tracingstore.tracings.{
  FossilDBClient,
  KeyValueStoreImplicits,
  VersionedKeyValuePair
}
import net.liftweb.common.Full

import scala.annotation.tailrec

class VersionedAgglomerateToGraphIterator(prefix: String,
                                          segmentToAgglomerateDataStore: FossilDBClient,
                                          version: Option[Long] = None) {}

class VersionedSegmentToAgglomerateChunkIterator(prefix: String,
                                                 segmentToAgglomerateDataStore: FossilDBClient,
                                                 version: Option[Long] = None)
    extends Iterator[(String, SegmentToAgglomerateChunkProto)]
    with KeyValueStoreImplicits {
  private val batchSize = 64

  private var currentStartAfterKey: Option[String] = None
  private var currentBatchIterator: Iterator[VersionedKeyValuePair[Array[Byte]]] = fetchNext
  private var nextBucket: Option[VersionedKeyValuePair[SegmentToAgglomerateChunkProto]] = None

  private def fetchNext: Iterator[VersionedKeyValuePair[Array[Byte]]] =
    segmentToAgglomerateDataStore.getMultipleKeys(currentStartAfterKey, Some(prefix), version, Some(batchSize)).iterator

  private def fetchNextAndSave = {
    currentBatchIterator = fetchNext
    currentBatchIterator
  }

  private def isRevertedChunk(chunkBytes: Array[Byte]): Boolean =
    chunkBytes sameElements Array[Byte](0)

  @tailrec
  private def getNextNonRevertedChunk: Option[VersionedKeyValuePair[SegmentToAgglomerateChunkProto]] =
    if (currentBatchIterator.hasNext) {
      val chunk = currentBatchIterator.next()
      currentStartAfterKey = Some(chunk.key)
      val chunkParsedBox = fromProtoBytes[SegmentToAgglomerateChunkProto](chunk.value)
      chunkParsedBox match {
        case _ if isRevertedChunk(chunk.value) => getNextNonRevertedChunk
        case Full(chunkParsed)                 => Some(VersionedKeyValuePair(versionedKey = chunk.versionedKey, value = chunkParsed))
        case _                                 => getNextNonRevertedChunk
      }
    } else {
      if (!fetchNextAndSave.hasNext) None
      else getNextNonRevertedChunk
    }

  override def hasNext: Boolean =
    if (nextBucket.isDefined) true
    else {
      nextBucket = getNextNonRevertedChunk
      nextBucket.isDefined
    }

  override def next(): (String, SegmentToAgglomerateChunkProto) = {
    val nextRes = nextBucket match {
      case Some(bucket) => bucket
      case None         => getNextNonRevertedChunk.get
    }
    nextBucket = None
    (nextRes.key, nextRes.value)
  }

}
