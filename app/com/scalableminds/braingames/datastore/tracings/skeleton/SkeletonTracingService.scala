package com.scalableminds.braingames.datastore.tracings.skeleton

import com.google.inject.Inject
import com.scalableminds.braingames.binary.models.datasource.DataSource
import com.scalableminds.braingames.binary.store.kvstore.VersionedKeyValueStore
import com.scalableminds.braingames.datastore.tracings.skeleton.elements.SkeletonTracing
import com.scalableminds.util.geometry.Scale

/**
  * Created by f on 28.06.17.
  */
class SkeletonTracingService @Inject()(
                                        implicit val tracingDataStore: VersionedKeyValueStore
                                      ) {

  def create(dataSource: DataSource): SkeletonTracing = {
    SkeletonTracing(name = "DummyTracing",
      dataSetName = "DummyDatasetName",
      trees = List(),
      timestamp = System.currentTimeMillis(),
      activeNodeId = None,
      scale = new Scale(1,1,1),
      editPosition = None,
      editRotation = None,
      zoomLevel = None)
  }
}
