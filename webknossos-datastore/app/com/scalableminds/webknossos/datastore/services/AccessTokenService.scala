package com.scalableminds.webknossos.datastore.services

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import play.api.libs.json.{Json, OFormat}
import play.api.mvc.Result
import play.api.mvc.Results.Forbidden

import scala.concurrent.duration._
import scala.concurrent.{ExecutionContext, Future}

object AccessMode extends ExtendedEnumeration {
  type AccessMode = Value
  val administrate, list, read, write, delete = Value
}

object AccessResourceType extends ExtendedEnumeration {
  type AccessResourceType = Value
  val datasource, tracing, annotation, webknossos, jobExport = Value
}

case class UserAccessAnswer(granted: Boolean, msg: Option[String] = None)
object UserAccessAnswer { implicit val jsonFormat: OFormat[UserAccessAnswer] = Json.format[UserAccessAnswer] }

case class UserAccessRequest(resourceId: DataSourceId, resourceType: AccessResourceType.Value, mode: AccessMode.Value)
object UserAccessRequest {
  implicit val jsonFormat: OFormat[UserAccessRequest] = Json.format[UserAccessRequest]

  def deleteDataSource(dataSourceId: DataSourceId): UserAccessRequest =
    UserAccessRequest(dataSourceId, AccessResourceType.datasource, AccessMode.delete)
  def administrateDataSources: UserAccessRequest =
    UserAccessRequest(DataSourceId("", ""), AccessResourceType.datasource, AccessMode.administrate)
  def administrateDataSources(organizationId: String): UserAccessRequest =
    UserAccessRequest(DataSourceId("", organizationId), AccessResourceType.datasource, AccessMode.administrate)
  def readDataSources(dataSourceId: DataSourceId): UserAccessRequest =
    UserAccessRequest(dataSourceId, AccessResourceType.datasource, AccessMode.read)
  def writeDataSource(dataSourceId: DataSourceId): UserAccessRequest =
    UserAccessRequest(dataSourceId, AccessResourceType.datasource, AccessMode.write)

  def readTracing(tracingId: String): UserAccessRequest =
    UserAccessRequest(DataSourceId(tracingId, ""), AccessResourceType.tracing, AccessMode.read)

  def writeTracing(tracingId: String): UserAccessRequest =
    UserAccessRequest(DataSourceId(tracingId, ""), AccessResourceType.tracing, AccessMode.write)

  def readAnnotation(annotationId: String): UserAccessRequest =
    UserAccessRequest(DataSourceId(annotationId, ""), AccessResourceType.annotation, AccessMode.read)

  def writeAnnotation(annotationId: String): UserAccessRequest =
    UserAccessRequest(DataSourceId(annotationId, ""), AccessResourceType.annotation, AccessMode.write)

  def downloadJobExport(jobId: String): UserAccessRequest =
    UserAccessRequest(DataSourceId(jobId, ""), AccessResourceType.jobExport, AccessMode.read)

  def webknossos: UserAccessRequest =
    UserAccessRequest(DataSourceId("webknossos", ""), AccessResourceType.webknossos, AccessMode.administrate)
}

trait AccessTokenService {
  val remoteWebknossosClient: RemoteWebknossosClient

  private val AccessExpiration: FiniteDuration = 2 minutes
  private lazy val accessAnswersCache: AlfuCache[(UserAccessRequest, Option[String]), UserAccessAnswer] =
    AlfuCache(timeToLive = AccessExpiration, timeToIdle = AccessExpiration)

  def validateAccessFromTokenContextForSyncBlock(
      accessRequest: UserAccessRequest
  )(block: => Result)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Result] =
    validateAccessFromTokenContext(accessRequest) {
      Future.successful(block)
    }

  def validateAccessFromTokenContext(
      accessRequest: UserAccessRequest
  )(block: => Future[Result])(implicit ec: ExecutionContext, tc: TokenContext): Fox[Result] =
    for {
      userAccessAnswer <- hasUserAccess(
        accessRequest
      ) ?~> "Failed to check data access, token may be expired, consider reloading."
      result <- executeBlockOnPositiveAnswer(userAccessAnswer, block)
    } yield result

  private def hasUserAccess(
      accessRequest: UserAccessRequest
  )(implicit ec: ExecutionContext, tc: TokenContext): Fox[UserAccessAnswer] =
    accessAnswersCache.getOrLoad(
      (accessRequest, tc.userTokenOpt),
      _ => remoteWebknossosClient.requestUserAccess(accessRequest)
    )

  def assertUserAccess(accessRequest: UserAccessRequest)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Unit] =
    for {
      userAccessAnswer <- hasUserAccess(
        accessRequest
      ) ?~> "Failed to check data access, token may be expired, consider reloading."
      _ <- Fox.bool2Fox(userAccessAnswer.granted) ?~> userAccessAnswer.msg.getOrElse("Access forbidden.")
    } yield ()

  private def executeBlockOnPositiveAnswer(
      userAccessAnswer: UserAccessAnswer,
      block: => Future[Result]
  ): Future[Result] =
    userAccessAnswer match {
      case UserAccessAnswer(true, _) =>
        block
      case UserAccessAnswer(false, Some(msg)) =>
        Future.successful(Forbidden("Token may be expired, consider reloading. Access forbidden: " + msg))
      case _ =>
        Future.successful(Forbidden("Token may be expired, consider reloading. Token authentication failed."))
    }
}

class DataStoreAccessTokenService @Inject() (val remoteWebknossosClient: DSRemoteWebknossosClient)
    extends AccessTokenService
