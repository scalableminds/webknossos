/*
 * Copyright (C) 2011-2014 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.services

import com.google.inject.Inject
import play.api.Play.current
import play.api.cache.Cache

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future
import scala.concurrent.duration._

class AccessTokenService @Inject()(webKnossosServer: WebKnossosServer) {

  val AccessExpiration: FiniteDuration = 30.minutes

  def hasUserAccess(token: String, dataSetName: String, dataLayerName: String): Future[Boolean] = {
    Cache.getOrElse(token, AccessExpiration.toSeconds.toInt) {
      webKnossosServer.requestUserAccess(token, dataSetName, dataLayerName).futureBox.map(_.isDefined)
    }
  }

  def hasDataSetAccess(token: String, dataSetName: String): Future[Boolean] = {
    Cache.getOrElse(token, AccessExpiration.toSeconds.toInt) {
      webKnossosServer.requestDataSetAccess(token, dataSetName).futureBox.map(_.isDefined)
    }
  }
}
