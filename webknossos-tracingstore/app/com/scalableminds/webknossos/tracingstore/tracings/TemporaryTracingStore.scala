package com.scalableminds.webknossos.tracingstore.tracings

import akka.actor.ActorSystem
import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.webknossos.datastore.storage.TemporaryStore

class TemporaryTracingStore[T] @Inject()(@Named("webknossos-tracingstore") val system: ActorSystem)
    extends TemporaryStore[String, T](system)

class TemporaryVolumeDataStore @Inject()(@Named("webknossos-tracingstore") val system: ActorSystem)
    extends TemporaryStore[String, Array[Byte]](system)
