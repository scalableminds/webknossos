package com.scalableminds.webknossos.tracingstore.tracings

import org.apache.pekko.actor.ActorSystem
import com.google.inject.Inject
import com.scalableminds.webknossos.datastore.storage.TemporaryStore
import com.scalableminds.webknossos.tracingstore.tracings.volume.MergedVolumeStats

class TemporaryTracingStore[T] @Inject() (val actorSystem: ActorSystem) extends TemporaryStore[String, T](actorSystem)

class TemporaryMergedVolumeStatsStore @Inject() (val actorSystem: ActorSystem)
    extends TemporaryStore[String, MergedVolumeStats](actorSystem)
