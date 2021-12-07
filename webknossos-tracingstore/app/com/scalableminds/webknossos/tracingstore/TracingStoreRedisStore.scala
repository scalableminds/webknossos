package com.scalableminds.webknossos.tracingstore

import com.google.inject.Inject
import com.scalableminds.webknossos.datastore.storage.RedisTemporaryStore

import scala.concurrent.ExecutionContext

class TracingStoreRedisStore @Inject()(config: TracingStoreConfig)(implicit val ec: ExecutionContext)
    extends RedisTemporaryStore {
  val address: String = config.Tracingstore.Redis.address
  val port: Int = config.Tracingstore.Redis.port
}
