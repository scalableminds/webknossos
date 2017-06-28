/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.services

import com.google.inject.Inject
import com.scalableminds.braingames.datastore.tracings.volume.VolumeTracing
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import play.api.Play.current
import play.api.cache.Cache

import scala.concurrent.duration._

class TracingContentService @Inject()(webKnossosServer: WebKnossosServer) extends FoxImplicits {

  private val DataLayerExpiration = 30.minutes

  def findVolumeTracing(id: String): Fox[VolumeTracing] = {
    Cache.getOrElse(id, DataLayerExpiration.toSeconds.toInt) {
      webKnossosServer.getVolumeTracing(id)
    }
  }
}
