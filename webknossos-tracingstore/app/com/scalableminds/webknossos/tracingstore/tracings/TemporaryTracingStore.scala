package com.scalableminds.webknossos.tracingstore.tracings

import org.apache.pekko.actor.ActorSystem
import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.webknossos.datastore.storage.TemporaryStore
import com.scalableminds.webknossos.tracingstore.tracings.volume.MergedVolumeStats

class TemporaryTracingStore[T] @Inject()(@Named("webknossos-tracingstore") val actorSystem: ActorSystem)
    extends TemporaryStore[String, T](actorSystem)

class TemporaryMergedVolumeStatsStore @Inject()(@Named("webknossos-tracingstore") val actorSystem: ActorSystem)
    extends TemporaryStore[String, MergedVolumeStats](actorSystem)
