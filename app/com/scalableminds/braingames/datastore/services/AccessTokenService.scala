/*
 * Copyright (C) 2011-2014 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.services

import com.google.inject.Inject
import play.api.Play.current
import play.api.cache.Cache
import play.api.libs.json.{Format, Json, Reads, Writes}

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future
import scala.concurrent.duration._

object AccessMode extends Enumeration {

  val read, write, create, list = Value

  implicit val jsonFormat = Format(Reads.enumNameReads(AccessMode), Writes.enumNameWrites)
}

object AccessRessourceType extends Enumeration {

  val dataset, tracing = Value

  implicit val jsonFormat = Format(Reads.enumNameReads(AccessRessourceType), Writes.enumNameWrites)
}

case class UserAccessRequest(resourceId: String, resourceType: AccessRessourceType.Value, mode: AccessMode.Value) {
  def toCacheKey(token: String) = s"$token#$resourceId#$resourceType#$mode"
}

object UserAccessRequest {
  implicit val jsonFormat = Json.format[UserAccessRequest]

  def createDataSet =
    UserAccessRequest("", AccessRessourceType.dataset, AccessMode.create)
  def listDataSets =
    UserAccessRequest("", AccessRessourceType.dataset, AccessMode.list)
  def readDataSet(dataSetName: String) =
    UserAccessRequest(dataSetName, AccessRessourceType.dataset, AccessMode.read)
  def writeDataSet(dataSetName: String) =
    UserAccessRequest(dataSetName, AccessRessourceType.dataset, AccessMode.write)

  def readTracing(tracingId: String) =
    UserAccessRequest(tracingId, AccessRessourceType.tracing, AccessMode.read)
  def writeTracing(tracingId: String) =
    UserAccessRequest(tracingId, AccessRessourceType.tracing, AccessMode.write)
}

class AccessTokenService @Inject()(webKnossosServer: WebKnossosServer) {

  val AccessExpiration: FiniteDuration = 30.minutes

  def hasUserAccess(token: String, accessRequest: UserAccessRequest): Future[Boolean] = {
    val key = accessRequest.toCacheKey(token)
    Cache.getOrElse(key, AccessExpiration.toSeconds.toInt) {
      webKnossosServer.requestUserAccess(token, accessRequest).futureBox.map(_.isDefined)
    }
  }
}
