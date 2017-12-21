/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings

import akka.actor.ActorSystem
import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.braingames.binary.storage.TemporaryStore

class TemporaryTracingStore[T] @Inject()(@Named("braingames-binary") val system: ActorSystem) extends TemporaryStore[String, T]
