package com.scalableminds.webknossos.datastore.services

import com.google.inject.Inject
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import play.api.cache.SyncCacheApi
import play.api.libs.json.{Format, Json, Reads, Writes}
import play.api.mvc.Results.Forbidden
import play.api.mvc.{Request, Result}

import scala.concurrent.{ExecutionContext, Future}
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
object UserAccessAnswer { implicit val jsonFormat = Json.format[UserAccessAnswer] }

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

trait AccessTokenService {
  val webKnossosServer: WkRpcClient
  val cache: SyncCacheApi

  val AccessExpiration: FiniteDuration = 2.minutes

  def validateAccessForSyncBlock[A](accessRequest: UserAccessRequest)(
      block: => Result)(implicit request: Request[A], ec: ExecutionContext): Fox[Result] =
    validateAccess(accessRequest) {
      Future.successful(block)
    }

  def validateAccess[A](accessRequest: UserAccessRequest)(block: => Future[Result])(implicit request: Request[A],
                                                                                    ec: ExecutionContext): Fox[Result] =
    hasUserAccess(accessRequest, request).flatMap { userAccessAnswer =>
      executeBlockOnPositiveAnswer(userAccessAnswer, block)
    }

  private def hasUserAccess[A](accessRequest: UserAccessRequest, request: Request[A])(
      implicit ec: ExecutionContext): Fox[UserAccessAnswer] =
    request
      .getQueryString("token")
      .map { token =>
        hasUserAccess(accessRequest, token)
      }
      .getOrElse(Fox.successful(UserAccessAnswer(false, Some("No access token."))))

  private def hasUserAccess(accessRequest: UserAccessRequest, token: String)(
      implicit ec: ExecutionContext): Fox[UserAccessAnswer] = {
    val key = accessRequest.toCacheKey(token)
    cache.getOrElseUpdate(key, AccessExpiration) {
      webKnossosServer.requestUserAccess(token, accessRequest)
    }
  }

  private def executeBlockOnPositiveAnswer[A](userAccessAnswer: UserAccessAnswer, block: => Future[Result])(
      implicit request: Request[A]): Future[Result] =
    userAccessAnswer match {
      case UserAccessAnswer(true, _) =>
        block
      case UserAccessAnswer(false, Some(msg)) =>
        Future.successful(Forbidden("Forbidden: " + msg))
      case _ =>
        Future.successful(Forbidden("Token authentication failed"))
    }
}

class DataStoreAccessTokenService @Inject()(val webKnossosServer: DataStoreWkRpcClient, val cache: SyncCacheApi)
    extends AccessTokenService
