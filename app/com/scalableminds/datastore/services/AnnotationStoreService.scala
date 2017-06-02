package com.scalableminds.datastore.services

import com.google.inject.Singleton
import com.scalableminds.braingames.binary.store.AnnotationStore
import com.scalableminds.braingames.binary.store.kvstore.{RocksDBStore, VersionedKeyValueStore}

@Singleton
class AnnotationStoreImpl extends AnnotationStore {
  val volumeStore = new VersionedKeyValueStore(new RocksDBStore("rocksdb-data"))
}
