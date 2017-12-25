/*
 * Copyright (C) 2011-2014 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.datastore.services

import com.google.inject.Inject
import com.scalableminds.util.tools.Fox
import play.api.Play.current
import play.api.cache.Cache
import play.api.libs.json.{Format, Json, Reads, Writes}

import scala.concurrent.duration._

object AccessMode extends Enumeration {

  val administrate, list, read, write = Value

  implicit val jsonFormat = Format(Reads.enumNameReads(AccessMode), Writes.enumNameWrites)
}

object AccessResourceType extends Enumeration {

  val datasource, tracing, webknossos = Value

  implicit val jsonFormat = Format(Reads.enumNameReads(AccessResourceType), Writes.enumNameWrites)
}

case class UserAccessRequest(resourceId: String, resourceType: AccessResourceType.Value, mode: AccessMode.Value) {
  def toCacheKey(token: String) = s"$token#$resourceId#$resourceType#$mode"
}

case class UserAccessAnswer(granted: Boolean, msg: Option[String] = None)
object UserAccessAnswer {implicit val jsonFormat = Json.format[UserAccessAnswer]}

object UserAccessRequest {
  implicit val jsonFormat = Json.format[UserAccessRequest]

  def administrateDataSources =
    UserAccessRequest("", AccessResourceType.datasource, AccessMode.administrate)
  def listDataSources =
    UserAccessRequest("", AccessResourceType.datasource, AccessMode.list)
  def readDataSources(dataSourceName: String) =
    UserAccessRequest(dataSourceName, AccessResourceType.datasource, AccessMode.read)
  def writeDataSource(dataSourceName: String) =
    UserAccessRequest(dataSourceName, AccessResourceType.datasource, AccessMode.write)

  def readTracing(tracingId: String) =
    UserAccessRequest(tracingId, AccessResourceType.tracing, AccessMode.read)
  def writeTracing(tracingId: String) =
    UserAccessRequest(tracingId, AccessResourceType.tracing, AccessMode.write)

  def webknossos =
    UserAccessRequest("webknossos", AccessResourceType.webknossos, AccessMode.administrate)
}


class AccessTokenService @Inject()(webKnossosServer: WebKnossosServer) {

  val AccessExpiration: FiniteDuration = 2.minutes

  def hasUserAccess(token: String, accessRequest: UserAccessRequest): Fox[UserAccessAnswer] = {
    val key = accessRequest.toCacheKey(token)
    Cache.getOrElse(key, AccessExpiration.toSeconds.toInt) {
      webKnossosServer.requestUserAccess(token, accessRequest)
    }
  }
}
