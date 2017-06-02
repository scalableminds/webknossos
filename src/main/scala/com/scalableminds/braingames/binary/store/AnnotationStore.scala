
package com.scalableminds.braingames.binary.store

import com.scalableminds.braingames.binary.store.kvstore.VersionedKeyValueStore

trait AnnotationStore {
  def volumeStore: VersionedKeyValueStore
}
