package com.scalableminds.webknossos.datastore.services

import com.google.inject.Inject
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import play.api.cache.CacheApi
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

case class UserAccessRequest(resourceId: DataSourceId, resourceType: AccessResourceType.Value, mode: AccessMode.Value) {
  def toCacheKey(token: String) = s"$token#$resourceId#$resourceType#$mode"
}

case class UserAccessAnswer(granted: Boolean, msg: Option[String] = None)
object UserAccessAnswer {implicit val jsonFormat = Json.format[UserAccessAnswer]}

object UserAccessRequest {
  implicit val jsonFormat = Json.format[UserAccessRequest]

  def administrateDataSources =
    UserAccessRequest(DataSourceId("", ""), AccessResourceType.datasource, AccessMode.administrate)
  def listDataSources =
    UserAccessRequest(DataSourceId("", ""), AccessResourceType.datasource, AccessMode.list)
  def readDataSources(dataSourceId: DataSourceId) =
    UserAccessRequest(dataSourceId, AccessResourceType.datasource, AccessMode.read)
  def writeDataSource(dataSourceId: DataSourceId) =
    UserAccessRequest(dataSourceId, AccessResourceType.datasource, AccessMode.write)

  def readTracing(tracingId: String) =
    UserAccessRequest(DataSourceId(tracingId, ""), AccessResourceType.tracing, AccessMode.read)
  def writeTracing(tracingId: String) =
    UserAccessRequest(DataSourceId(tracingId, ""), AccessResourceType.tracing, AccessMode.write)

  def webknossos =
    UserAccessRequest(DataSourceId("webknossos", ""), AccessResourceType.webknossos, AccessMode.administrate)
}


class AccessTokenService @Inject()(webKnossosServer: WebKnossosServer, cache: CacheApi) {

  val AccessExpiration: FiniteDuration = 2.minutes

  def hasUserAccess(token: String, accessRequest: UserAccessRequest): Fox[UserAccessAnswer] = {
    val key = accessRequest.toCacheKey(token)
    cache.getOrElse(key, AccessExpiration) {
      webKnossosServer.requestUserAccess(token, accessRequest)
    }
  }
}
