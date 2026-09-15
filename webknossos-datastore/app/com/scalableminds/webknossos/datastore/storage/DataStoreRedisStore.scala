package com.scalableminds.webknossos.datastore.storage

import com.google.inject.Inject
import com.scalableminds.webknossos.datastore.DataStoreConfig
import play.api.inject.ApplicationLifecycle

import scala.concurrent.ExecutionContext

class DataStoreRedisStore @Inject() (config: DataStoreConfig, val lifecycle: ApplicationLifecycle)(implicit
    val ec: ExecutionContext
) extends RedisTemporaryStore {
  val address: String = config.Datastore.Redis.address
  val port: Int = config.Datastore.Redis.port
}
