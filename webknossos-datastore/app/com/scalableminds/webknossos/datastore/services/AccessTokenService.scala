package com.scalableminds.webknossos.datastore.services

import com.google.inject.Inject
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import play.api.cache.SyncCacheApi
import play.api.libs.json.{Format, Json, OFormat, Reads, Writes}
import play.api.mvc.Results.Forbidden
import play.api.mvc.{Request, Result}

import scala.concurrent.{ExecutionContext, Future}
import scala.concurrent.duration._

object AccessMode extends Enumeration {

  val administrate, list, read, write, delete = Value

  implicit val jsonFormat: Format[AccessMode.Value] = Format(Reads.enumNameReads(AccessMode), Writes.enumNameWrites)
}

object AccessResourceType extends Enumeration {

  val datasource, tracing, webknossos = Value

  implicit val jsonFormat: Format[AccessResourceType.Value] = Format(Reads.enumNameReads(AccessResourceType), Writes.enumNameWrites)
}

case class UserAccessRequest(resourceId: DataSourceId, resourceType: AccessResourceType.Value, mode: AccessMode.Value) {
  def toCacheKey(token: Option[String]) = s"$token#$resourceId#$resourceType#$mode"
}

case class UserAccessAnswer(granted: Boolean, msg: Option[String] = None)
object UserAccessAnswer { implicit val jsonFormat: OFormat[UserAccessAnswer] = Json.format[UserAccessAnswer] }

object UserAccessRequest {
  implicit val jsonFormat: OFormat[UserAccessRequest] = Json.format[UserAccessRequest]

  def deleteDataSource(dataSourceId: DataSourceId): UserAccessRequest =
    UserAccessRequest(dataSourceId, AccessResourceType.datasource, AccessMode.delete)
  def administrateDataSources: UserAccessRequest =
    UserAccessRequest(DataSourceId("", ""), AccessResourceType.datasource, AccessMode.administrate)
  def listDataSources: UserAccessRequest =
    UserAccessRequest(DataSourceId("", ""), AccessResourceType.datasource, AccessMode.list)
  def readDataSources(dataSourceId: DataSourceId): UserAccessRequest =
    UserAccessRequest(dataSourceId, AccessResourceType.datasource, AccessMode.read)
  def writeDataSource(dataSourceId: DataSourceId): UserAccessRequest =
    UserAccessRequest(dataSourceId, AccessResourceType.datasource, AccessMode.write)

  def readTracing(tracingId: String): UserAccessRequest =
    UserAccessRequest(DataSourceId(tracingId, ""), AccessResourceType.tracing, AccessMode.read)
  def writeTracing(tracingId: String): UserAccessRequest =
    UserAccessRequest(DataSourceId(tracingId, ""), AccessResourceType.tracing, AccessMode.write)

  def webknossos: UserAccessRequest =
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
    for {
      userAccessAnswer <- hasUserAccess(accessRequest, request) ?~> "Failed to check data access, token may be expired, consider reloading."
      result <- executeBlockOnPositiveAnswer(userAccessAnswer, block)
    } yield result

  private def hasUserAccess[A](accessRequest: UserAccessRequest, request: Request[A]): Fox[UserAccessAnswer] = {
    val tokenOpt = tokenFromRequest(request)
    hasUserAccess(accessRequest, tokenOpt)
  }

  def tokenFromRequest[A](request: Request[A]): Option[String] =
    request.getQueryString("token").flatMap(token => if (token.isEmpty) None else Some(token))

  private def hasUserAccess(accessRequest: UserAccessRequest, token: Option[String]): Fox[UserAccessAnswer] = {
    val key = accessRequest.toCacheKey(token)
    cache.getOrElseUpdate(key, AccessExpiration) {
      webKnossosServer.requestUserAccess(token, accessRequest)
    }
  }

  private def executeBlockOnPositiveAnswer[A](userAccessAnswer: UserAccessAnswer, block: => Future[Result]): Future[Result] =
    userAccessAnswer match {
      case UserAccessAnswer(true, _) =>
        block
      case UserAccessAnswer(false, Some(msg)) =>
        Future.successful(Forbidden("Token may be expired, consider reloading. Access forbidden: " + msg))
      case _ =>
        Future.successful(Forbidden("Token may be expired, consider reloading. Token authentication failed."))
    }
}

class DataStoreAccessTokenService @Inject()(val webKnossosServer: DataStoreWkRpcClient, val cache: SyncCacheApi)
    extends AccessTokenService
