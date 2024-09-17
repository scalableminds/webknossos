package com.scalableminds.webknossos.datastore.storage

import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.webknossos.datastore.dataformats.BucketProvider
import com.scalableminds.webknossos.datastore.models.datasource.LegacyDataSourceId

class BucketProviderCache(val maxEntries: Int) extends LRUConcurrentCache[(LegacyDataSourceId, String), BucketProvider]
