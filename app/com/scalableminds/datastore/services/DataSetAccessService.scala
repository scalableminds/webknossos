/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.datastore.services

import com.scalableminds.datastore.DataStorePlugin
import play.api.cache.Cache

import scala.concurrent.Future
import scala.concurrent.duration._
import play.api.Play.current

object DataSetAccessService {

  val AccessExpiration = 30 minutes

  def hasAccess(token: String, dataSetName: String): Future[Boolean] = {
    Cache.getOrElse(token, AccessExpiration.toSeconds.toInt){
      DataStorePlugin.current
        .map(_.oxalisServer.requestDataSetAccess(token, dataSetName))
        .getOrElse(Future.successful(false))
    }
  }

}
