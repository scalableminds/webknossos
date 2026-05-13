package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.util.tools.{AsyncIterator, Fox}
import com.scalableminds.webknossos.datastore.AgglomerateGraph.AgglomerateGraph
import com.scalableminds.webknossos.datastore.SegmentToAgglomerateProto.SegmentToAgglomerateChunkProto
import com.scalableminds.webknossos.tracingstore.tracings.volume.ReversionHelper
import com.scalableminds.webknossos.tracingstore.tracings.{FossilDBClient, KeyValueStoreImplicits}

import scala.concurrent.ExecutionContext

class VersionedAgglomerateToGraphIterator(prefix: String,
                                          segmentToAgglomerateDataStore: FossilDBClient,
                                          version: Option[Long] = None)(implicit ec: ExecutionContext)
    extends AsyncIterator[(String, AgglomerateGraph, Long)]
    with ReversionHelper
    with KeyValueStoreImplicits {
  private val batchSize = 64
  private var currentStartAfterKey: Option[String] = None

  override def nextBatch(): Fox[List[(String, AgglomerateGraph, Long)]] =
    segmentToAgglomerateDataStore
      .getMultipleKeys[Array[Byte]](currentStartAfterKey, Some(prefix), version, Some(batchSize))
      .flatMap { rawBatch =>
        if (rawBatch.isEmpty) Fox.successful(Nil)
        else {
          currentStartAfterKey = rawBatch.lastOption.map(_.key)
          val parsed = rawBatch.filterNot(item => isRevertedElement(item.value)).flatMap { item =>
            fromProtoBytes[AgglomerateGraph](item.value).toOption.map(graph => (item.key, graph, item.version))
          }
          if (parsed.nonEmpty) Fox.successful(parsed)
          else nextBatch()
        }
      }
}

class VersionedSegmentToAgglomerateChunkIterator(prefix: String,
                                                 segmentToAgglomerateDataStore: FossilDBClient,
                                                 version: Option[Long] = None)(implicit ec: ExecutionContext)
    extends AsyncIterator[(String, SegmentToAgglomerateChunkProto, Long)]
    with ReversionHelper
    with KeyValueStoreImplicits {
  private val batchSize = 64
  private var currentStartAfterKey: Option[String] = None

  override def nextBatch(): Fox[List[(String, SegmentToAgglomerateChunkProto, Long)]] =
    segmentToAgglomerateDataStore
      .getMultipleKeys[Array[Byte]](currentStartAfterKey, Some(prefix), version, Some(batchSize))
      .flatMap { rawBatch =>
        if (rawBatch.isEmpty) Fox.successful(Nil)
        else {
          currentStartAfterKey = rawBatch.lastOption.map(_.key)
          val parsed = rawBatch.filterNot(item => isRevertedElement(item.value)).flatMap { item =>
            fromProtoBytes[SegmentToAgglomerateChunkProto](item.value).toOption.map(chunk =>
              (item.key, chunk, item.version))
          }
          if (parsed.nonEmpty) Fox.successful(parsed)
          else nextBatch()
        }
      }
}
