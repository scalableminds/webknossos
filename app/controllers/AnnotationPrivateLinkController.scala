package controllers

import com.scalableminds.util.Msg
import play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.box.Full
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import play.api.libs.json._

import javax.inject.Inject
import models.annotation._
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import security.{WkEnv, WkSilhouetteEnvironment}
import com.scalableminds.util.objectid.ObjectId

import scala.concurrent.ExecutionContext
class AnnotationPrivateLinkController @Inject() (
    annotationDAO: AnnotationDAO,
    annotationService: AnnotationService,
    annotationPrivateLinkDAO: AnnotationPrivateLinkDAO,
    wkSilhouetteEnvironment: WkSilhouetteEnvironment,
    annotationPrivateLinkService: AnnotationPrivateLinkService,
    sil: Silhouette[WkEnv]
)(implicit ec: ExecutionContext, val bodyParsers: PlayBodyParsers)
    extends Controller {

  private val bearerTokenService = wkSilhouetteEnvironment.combinedAuthenticatorService.tokenAuthenticatorService

  def annotationSource(accessTokenOrId: String, userToken: Option[String]): Action[AnyContent] = Action.fox { _ =>
    for {
      annotationByLinkBox <- findAnnotationByPrivateLinkIfNotExpired(accessTokenOrId).shiftBox
      annotation <- annotationByLinkBox match {
        case Full(a) => Fox.successful(a)
        case _       => findAnnotationByIdAndUserToken(accessTokenOrId, userToken)
      }
      writtenAnnotation <- annotationService.writesAsAnnotationSource(
        annotation,
        accessViaPrivateLink = annotationByLinkBox.isDefined
      )
    } yield Ok(writtenAnnotation)
  }

  private def findAnnotationByIdAndUserToken(annotationId: String, userToken: Option[String]): Fox[Annotation] =
    for {
      annotationIdValidated <- ObjectId.fromString(annotationId)
      userBox <- bearerTokenService.userForTokenOpt(userToken).shiftBox
      ctx = DBAccessContext(userBox.toOption)
      annotation <- annotationDAO.findOne(annotationIdValidated)(using ctx) ?~> Msg.Annotation.notFound
    } yield annotation

  private def findAnnotationByPrivateLinkIfNotExpired(accessToken: String): Fox[Annotation] =
    for {
      annotationPrivateLink <- annotationPrivateLinkDAO.findOneByAccessToken(accessToken)
      _ <- Fox.fromBool(
        annotationPrivateLink.expirationDateTime.forall(_ > Instant.now)
      ) ?~> Msg.Annotation.PrivateLink.expired ~> NOT_FOUND
      annotation <- annotationDAO.findOne(annotationPrivateLink._annotation)(using GlobalAccessContext)
    } yield annotation

  def list: Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      links <- annotationPrivateLinkDAO.findAll
      linksJsonList <- Fox.serialCombined(links)(annotationPrivateLinkService.publicWrites)
    } yield Ok(Json.toJson(linksJsonList))
  }

  def listByAnnotation(annotationId: ObjectId): Action[AnyContent] =
    sil.SecuredAction.fox { implicit request =>
      for {
        links <- annotationPrivateLinkDAO.findAllByAnnotation(annotationId)
        linksJsonList <- Fox.serialCombined(links)(annotationPrivateLinkService.publicWrites)
      } yield Ok(Json.toJson(linksJsonList))
    }

  def get(id: ObjectId): Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      annotationPrivateLink <- annotationPrivateLinkDAO.findOne(id)
      _ <- Fox.fromBool(
        annotationPrivateLink.expirationDateTime.forall(_ > Instant.now)
      ) ?~> Msg.Annotation.PrivateLink.expired ~> NOT_FOUND
      _ <- annotationDAO.findOne(annotationPrivateLink._annotation) ?~> Msg.Annotation.notFound ~> NOT_FOUND
      annotationPrivateLinkJs <- annotationPrivateLinkService.publicWrites(
        annotationPrivateLink
      ) ?~> Msg.Annotation.PrivateLink.publicWritesFailed
    } yield Ok(annotationPrivateLinkJs)
  }

  def create: Action[AnnotationPrivateLinkParams] = sil.SecuredAction.fox(validateJson[AnnotationPrivateLinkParams]) {
    implicit request =>
      val params = request.body
      val _id = ObjectId.generate
      val accessToken = annotationPrivateLinkService.generateToken
      for {
        annotationId <- ObjectId.fromString(params.annotation)
        _ <- annotationDAO.assertUpdateAccess(annotationId) ?~> Msg.Annotation.Edit.notAllowed ~> FORBIDDEN
        _ <- annotationPrivateLinkDAO.insertOne(
          AnnotationPrivateLink(_id, annotationId, accessToken, params.expirationDateTime)
        ) ?~> Msg.Annotation.PrivateLink.createFailed
        inserted <- annotationPrivateLinkDAO.findOne(_id)
        js <- annotationPrivateLinkService.publicWrites(inserted) ?~> Msg.Annotation.PrivateLink.publicWritesFailed
      } yield Ok(js)
  }

  def update(id: ObjectId): Action[AnnotationPrivateLinkParams] =
    sil.SecuredAction.fox(validateJson[AnnotationPrivateLinkParams]) { implicit request =>
      val params = request.body
      for {
        annotationId <- ObjectId.fromString(params.annotation)
        aPLInfo <- annotationPrivateLinkDAO.findOne(id) ?~> Msg.Annotation.PrivateLink.notFound(id) ~> NOT_FOUND
        _ <- annotationDAO.assertUpdateAccess(aPLInfo._annotation) ?~> Msg.Annotation.Edit.notAllowed ~> FORBIDDEN
        _ <- annotationDAO.assertUpdateAccess(annotationId) ?~> Msg.Annotation.Edit.notAllowed ~> FORBIDDEN
        _ <- annotationPrivateLinkDAO.updateOne(
          id,
          annotationId,
          params.expirationDateTime
        ) ?~> Msg.Annotation.PrivateLink.updateFailed
        updated <- annotationPrivateLinkDAO.findOne(id) ?~> Msg.Annotation.PrivateLink.notFound(id)
        js <- annotationPrivateLinkService.publicWrites(updated) ?~> Msg.Annotation.PrivateLink.publicWritesFailed
      } yield Ok(js)
    }

  def delete(id: ObjectId): Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      aPLInfo <- annotationPrivateLinkDAO.findOne(id) ?~> Msg.Annotation.PrivateLink.notFound(id) ~> NOT_FOUND
      _ <- annotationDAO.assertUpdateAccess(aPLInfo._annotation) ?~> Msg.Annotation.Edit.notAllowed ~> FORBIDDEN
      _ <- annotationPrivateLinkDAO.deleteOne(id) ?~> Msg.Annotation.PrivateLink.deleteFailed
    } yield JsonOk(Msg.Annotation.PrivateLink.deleteSuccess)
  }
}
