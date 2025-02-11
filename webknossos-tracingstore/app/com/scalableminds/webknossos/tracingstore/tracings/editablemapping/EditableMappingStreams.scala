package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.webknossos.datastore.AgglomerateGraph.AgglomerateGraph
import com.scalableminds.webknossos.datastore.SegmentToAgglomerateProto.SegmentToAgglomerateChunkProto
import com.scalableminds.webknossos.tracingstore.tracings.volume.ReversionHelper
import com.scalableminds.webknossos.tracingstore.tracings.{
  FossilDBClient,
  KeyValueStoreImplicits,
  VersionedKeyValuePair
}
import com.scalableminds.util.tools.Full

import scala.annotation.tailrec

class VersionedAgglomerateToGraphIterator(
    prefix: String,
    segmentToAgglomerateDataStore: FossilDBClient,
    version: Option[Long] = None
) extends Iterator[(String, AgglomerateGraph, Long)]
    with ReversionHelper
    with KeyValueStoreImplicits {
  private val batchSize = 64

  private var currentStartAfterKey: Option[String] = None
  private var currentBatchIterator: Iterator[VersionedKeyValuePair[Array[Byte]]] = fetchNext
  private var nextGraph: Option[VersionedKeyValuePair[AgglomerateGraph]] = None

  private def fetchNext: Iterator[VersionedKeyValuePair[Array[Byte]]] =
    segmentToAgglomerateDataStore
      .getMultipleKeys(currentStartAfterKey, Some(prefix), version, Some(batchSize))(wrapInBox)
      .iterator

  private def fetchNextAndSave = {
    currentBatchIterator = fetchNext
    currentBatchIterator
  }

  @tailrec
  private def getNextNonRevertedGraph: Option[VersionedKeyValuePair[AgglomerateGraph]] =
    if (currentBatchIterator.hasNext) {
      val chunk = currentBatchIterator.next()
      currentStartAfterKey = Some(chunk.key)
      val graphParsedBox = fromProtoBytes[AgglomerateGraph](chunk.value)
      graphParsedBox match {
        case _ if isRevertedElement(chunk.value) => getNextNonRevertedGraph
        case Full(graphParsed) => Some(VersionedKeyValuePair(versionedKey = chunk.versionedKey, value = graphParsed))
        case _                 => getNextNonRevertedGraph
      }
    } else {
      if (!fetchNextAndSave.hasNext) None
      else getNextNonRevertedGraph
    }

  override def hasNext: Boolean =
    if (nextGraph.isDefined) true
    else {
      nextGraph = getNextNonRevertedGraph
      nextGraph.isDefined
    }

  override def next(): (String, AgglomerateGraph, Long) = {
    val nextRes = nextGraph match {
      case Some(bucket) => bucket
      case None         => getNextNonRevertedGraph.get
    }
    nextGraph = None
    (nextRes.key, nextRes.value, nextRes.version)
  }

}

class VersionedSegmentToAgglomerateChunkIterator(
    prefix: String,
    segmentToAgglomerateDataStore: FossilDBClient,
    version: Option[Long] = None
) extends Iterator[(String, SegmentToAgglomerateChunkProto, Long)]
    with ReversionHelper
    with KeyValueStoreImplicits {
  private val batchSize = 64

  private var currentStartAfterKey: Option[String] = None
  private var currentBatchIterator: Iterator[VersionedKeyValuePair[Array[Byte]]] = fetchNext
  private var nextChunk: Option[VersionedKeyValuePair[SegmentToAgglomerateChunkProto]] = None

  private def fetchNext: Iterator[VersionedKeyValuePair[Array[Byte]]] =
    segmentToAgglomerateDataStore
      .getMultipleKeys(currentStartAfterKey, Some(prefix), version, Some(batchSize))(wrapInBox)
      .iterator

  private def fetchNextAndSave = {
    currentBatchIterator = fetchNext
    currentBatchIterator
  }

  @tailrec
  private def getNextNonRevertedChunk: Option[VersionedKeyValuePair[SegmentToAgglomerateChunkProto]] =
    if (currentBatchIterator.hasNext) {
      val chunk = currentBatchIterator.next()
      currentStartAfterKey = Some(chunk.key)
      val chunkParsedBox = fromProtoBytes[SegmentToAgglomerateChunkProto](chunk.value)
      chunkParsedBox match {
        case _ if isRevertedElement(chunk.value) => getNextNonRevertedChunk
        case Full(chunkParsed) => Some(VersionedKeyValuePair(versionedKey = chunk.versionedKey, value = chunkParsed))
        case _                 => getNextNonRevertedChunk
      }
    } else {
      if (!fetchNextAndSave.hasNext) None
      else getNextNonRevertedChunk
    }

  override def hasNext: Boolean =
    if (nextChunk.isDefined) true
    else {
      nextChunk = getNextNonRevertedChunk
      nextChunk.isDefined
    }

  override def next(): (String, SegmentToAgglomerateChunkProto, Long) = {
    val nextRes = nextChunk match {
      case Some(bucket) => bucket
      case None         => getNextNonRevertedChunk.get
    }
    nextChunk = None
    (nextRes.key, nextRes.value, nextRes.version)
  }

}
