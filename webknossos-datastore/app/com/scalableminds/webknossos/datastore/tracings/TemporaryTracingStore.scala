package com.scalableminds.webknossos.datastore.tracings

import akka.actor.ActorSystem
import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.webknossos.datastore.storage.TemporaryStore

class TemporaryTracingStore[T] @Inject()(@Named("webknossos-datastore") val system: ActorSystem) extends TemporaryStore[String, T]
