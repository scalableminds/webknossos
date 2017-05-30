
package com.scalableminds.braingames.binary.store

import com.scalableminds.braingames.binary.store.kvstore.{RocksDBStore, VersionedKeyValueStore}

object AnnotationStore {
  val volumeStore = new VersionedKeyValueStore(new RocksDBStore("rockssdb-data/volumes"))
}
