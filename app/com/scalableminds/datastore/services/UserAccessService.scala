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

object UserAccessService {

  val AccessExpiration = 30 minutes

  def hasAccess(token: String, dataSetName: String, dataLayerName: String): Future[Boolean] = {
    Cache.getOrElse(token, AccessExpiration.toSeconds.toInt){
      DataStorePlugin.current
        .map(_.oxalisServer.requestUserAccess(token, dataSetName, dataLayerName))
        .getOrElse(Future.successful(false))
    }
  }

}
