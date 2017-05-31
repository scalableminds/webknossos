/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.datastore.services

import com.scalableminds.braingames.binary.models.DataLayer
import com.scalableminds.datastore.DataStorePlugin
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import play.api.Play.current
import play.api.cache.Cache
import play.api.libs.concurrent.Execution.Implicits._

import scala.concurrent.duration._

object UserDataLayerService extends FoxImplicits {

  private val DataLayerExpiration = 30.minutes

  private def asCacheKey(dataSetName: String, dataLayerName: String) =
    s"userLayer-$dataSetName-$dataLayerName"

  def findUserDataLayer(dataSetName: String, dataLayerName: String): Fox[DataLayer] = {
    Cache.getOrElse(asCacheKey(dataSetName, dataLayerName), DataLayerExpiration.toSeconds.toInt) {
      DataStorePlugin
        .current.toFox.flatMap(_.oxalisServer.requestUserDataLayer(dataSetName, dataLayerName))
    }
  }
}
