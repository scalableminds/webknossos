package com.scalableminds.webknossos.tracingstore.tracings

import org.apache.pekko.actor.ActorSystem
import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.webknossos.datastore.storage.TemporaryStore

class TemporaryTracingStore[T] @Inject()(@Named("webknossos-tracingstore") val actorSystem: ActorSystem)
    extends TemporaryStore[String, T](actorSystem)

class TemporaryVolumeDataStore @Inject()(@Named("webknossos-tracingstore") val actorSystem: ActorSystem)
    extends TemporaryStore[String, Array[Byte]](actorSystem)
