/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.datastore.services

import play.api.cache.Cache
import scala.concurrent.duration._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.Play.current
import scala.concurrent.Future
import play.api.Play
import com.scalableminds.datastore.DataStorePlugin
import com.scalableminds.util.tools.Fox
import com.scalableminds.braingames.binary.models.DataLayer

object UserDataLayerService {

  val DataLayerExpiration = 30 minutes

  def asCacheKey(dataSetName: String, dataLayerName: String) =
    s"userLayer-$dataSetName-$dataLayerName"

  def findUserDataLayer(dataSetName: String, dataLayerName: String): Fox[DataLayer] = {
    Cache.getOrElse(asCacheKey(dataSetName, dataLayerName), DataLayerExpiration.toSeconds.toInt){
      DataStorePlugin
        .binaryDataService
        .oxalisServer.requestUserDataLayer(dataSetName, dataLayerName)
    }
  }
}

