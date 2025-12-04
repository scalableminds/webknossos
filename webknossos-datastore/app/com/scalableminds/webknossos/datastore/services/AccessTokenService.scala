package com.scalableminds.webknossos.datastore.services

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
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
  val dataset, tracing, annotation, webknossos, jobExport = Value
}

case class UserAccessAnswer(granted: Boolean, msg: Option[String] = None)
object UserAccessAnswer { implicit val jsonFormat: OFormat[UserAccessAnswer] = Json.format[UserAccessAnswer] }

case class UserAccessRequest(resourceId: Option[String], resourceType: AccessResourceType.Value, mode: AccessMode.Value)
object UserAccessRequest {
  implicit val jsonFormat: OFormat[UserAccessRequest] = Json.format[UserAccessRequest]

  def administrateDatasets: UserAccessRequest =
    UserAccessRequest(None, AccessResourceType.dataset, AccessMode.administrate)

  def administrateDatasets(organizationId: String): UserAccessRequest =
    UserAccessRequest(Some(organizationId), AccessResourceType.dataset, AccessMode.administrate)

  def readDataset(datasetId: ObjectId): UserAccessRequest =
    UserAccessRequest(Some(datasetId.toString), AccessResourceType.dataset, AccessMode.read)

  def deleteDataset(datasetId: ObjectId): UserAccessRequest =
    UserAccessRequest(Some(datasetId.toString), AccessResourceType.dataset, AccessMode.delete)

  def writeDataset(datasetId: ObjectId): UserAccessRequest =
    UserAccessRequest(Some(datasetId.toString), AccessResourceType.dataset, AccessMode.write)

  def readTracing(tracingId: String): UserAccessRequest =
    UserAccessRequest(Some(tracingId), AccessResourceType.tracing, AccessMode.read)

  def writeTracing(tracingId: String): UserAccessRequest =
    UserAccessRequest(Some(tracingId), AccessResourceType.tracing, AccessMode.write)

  def readAnnotation(annotationId: ObjectId): UserAccessRequest =
    UserAccessRequest(Some(annotationId.toString), AccessResourceType.annotation, AccessMode.read)

  def writeAnnotation(annotationId: ObjectId): UserAccessRequest =
    UserAccessRequest(Some(annotationId.toString), AccessResourceType.annotation, AccessMode.write)

  def downloadJobExport(jobId: String): UserAccessRequest =
    UserAccessRequest(Some(jobId), AccessResourceType.jobExport, AccessMode.read)

  def webknossos: UserAccessRequest =
    UserAccessRequest(None, AccessResourceType.webknossos, AccessMode.administrate)
}

trait AccessTokenService {
  val remoteWebknossosClient: RemoteWebknossosClient

  private val AccessExpiration: FiniteDuration = 2 minutes
  private lazy val accessAnswersCache: AlfuCache[(UserAccessRequest, Option[String]), UserAccessAnswer] =
    AlfuCache(timeToLive = AccessExpiration, timeToIdle = AccessExpiration)

  def validateAccessFromTokenContextForSyncBlock(accessRequest: UserAccessRequest)(
      block: => Result)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Result] =
    validateAccessFromTokenContext(accessRequest) {
      Future.successful(block)
    }

  def validateAccessFromTokenContext(accessRequest: UserAccessRequest)(
      block: => Future[Result])(implicit ec: ExecutionContext, tc: TokenContext): Fox[Result] =
    for {
      userAccessAnswer <- hasUserAccess(accessRequest) ?~> "Failed to check data access, token may be expired, consider reloading."
      result <- Fox.fromFuture(executeBlockOnPositiveAnswer(userAccessAnswer, block))
    } yield result

  private def hasUserAccess(accessRequest: UserAccessRequest)(implicit ec: ExecutionContext,
                                                              tc: TokenContext): Fox[UserAccessAnswer] =
    accessAnswersCache.getOrLoad((accessRequest, tc.userTokenOpt),
                                 _ => remoteWebknossosClient.requestUserAccess(accessRequest))

  private def executeBlockOnPositiveAnswer(userAccessAnswer: UserAccessAnswer,
                                           block: => Future[Result]): Future[Result] =
    userAccessAnswer match {
      case UserAccessAnswer(true, _) =>
        block
      case UserAccessAnswer(false, Some(msg)) =>
        // Note that this should be kept in sync with DSLegacyApiController.withResolvedDatasetId
        // to make the errors indistinguishable.
        Future.successful(Forbidden("Token may be expired, consider reloading. Access forbidden: " + msg))
      case _ =>
        Future.successful(Forbidden("Token may be expired, consider reloading. Token authentication failed."))
    }
}

class DataStoreAccessTokenService @Inject()(val remoteWebknossosClient: DSRemoteWebknossosClient)
    extends AccessTokenService
