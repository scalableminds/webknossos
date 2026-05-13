package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.util.tools.{AsyncIterator, Fox}
import com.scalableminds.webknossos.tracingstore.tracings.{
  FossilDBClient,
  KeyValueStoreImplicits,
  VersionedKeyValuePair
}

class VersionedFossilDbIterator(prefix: String, fossilDbClient: FossilDBClient, version: Option[Long] = None)
    extends AsyncIterator[VersionedKeyValuePair[Array[Byte]]]
    with KeyValueStoreImplicits {
  private val batchSize = 64
  private var currentStartAfterKey: Option[String] = None

  override def nextBatch(): Fox[List[VersionedKeyValuePair[Array[Byte]]]] =
    fossilDbClient.getMultipleKeys[Array[Byte]](currentStartAfterKey, Some(prefix), version, Some(batchSize)).map {
      batch =>
        currentStartAfterKey = batch.lastOption.map(_.key)
        batch
    }
}
