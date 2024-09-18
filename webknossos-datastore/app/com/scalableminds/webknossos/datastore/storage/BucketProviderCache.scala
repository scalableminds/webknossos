package com.scalableminds.webknossos.datastore.storage

import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.webknossos.datastore.dataformats.BucketProvider
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId

class BucketProviderCache(val maxEntries: Int) extends LRUConcurrentCache[(DataSourceId, String), BucketProvider]
