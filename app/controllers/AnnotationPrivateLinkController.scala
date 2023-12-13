package controllers

import play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.FoxImplicits

import play.api.libs.json._

import javax.inject.Inject
import models.annotation._
import net.liftweb.common.Full
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import security.{WkEnv, WkSilhouetteEnvironment}
import utils.ObjectId

import scala.concurrent.ExecutionContext
class AnnotationPrivateLinkController @Inject()(
    annotationDAO: AnnotationDAO,
    annotationService: AnnotationService,
    annotationPrivateLinkDAO: AnnotationPrivateLinkDAO,
    wkSilhouetteEnvironment: WkSilhouetteEnvironment,
    annotationPrivateLinkService: AnnotationPrivateLinkService,
    sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, val bodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  private val bearerTokenService = wkSilhouetteEnvironment.combinedAuthenticatorService.tokenAuthenticatorService

  def annotationSource(accessTokenOrId: String, userToken: Option[String]): Action[AnyContent] = Action.async {
    implicit request =>
      for {
        annotationByLinkBox <- findAnnotationByPrivateLinkIfNotExpired(accessTokenOrId).futureBox
        annotation <- annotationByLinkBox match {
          case Full(a) => Fox.successful(a)
          case _       => findAnnotationByIdAndUserToken(accessTokenOrId, userToken)
        }
        writtenAnnotation <- annotationService.writesAsAnnotationSource(annotation,
                                                                        accessViaPrivateLink =
                                                                          annotationByLinkBox.nonEmpty)
      } yield Ok(writtenAnnotation)
  }

  private def findAnnotationByIdAndUserToken(annotationId: String, userToken: Option[String]): Fox[Annotation] =
    for {
      annotationIdValidated <- ObjectId.fromString(annotationId)
      userBox <- bearerTokenService.userForTokenOpt(userToken).futureBox
      ctx = DBAccessContext(userBox.toOption)
      annotation <- annotationDAO.findOne(annotationIdValidated)(ctx) ?~> "annotation.notFound"
    } yield annotation

  private def findAnnotationByPrivateLinkIfNotExpired(accessToken: String): Fox[Annotation] =
    for {
      annotationPrivateLink <- annotationPrivateLinkDAO.findOneByAccessToken(accessToken)
      _ <- bool2Fox(annotationPrivateLink.expirationDateTime.forall(_ > Instant.now)) ?~> "Token expired" ~> 404
      annotation <- annotationDAO.findOne(annotationPrivateLink._annotation)(GlobalAccessContext)
    } yield annotation

  def list: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      links <- annotationPrivateLinkDAO.findAll
      linksJsonList <- Fox.serialCombined(links)(annotationPrivateLinkService.publicWrites)
    } yield Ok(Json.toJson(linksJsonList))
  }

  def listByAnnotation(annotationId: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        annotationIdValidated <- ObjectId.fromString(annotationId)
        links <- annotationPrivateLinkDAO.findAllByAnnotation(annotationIdValidated)
        linksJsonList <- Fox.serialCombined(links)(annotationPrivateLinkService.publicWrites)
      } yield Ok(Json.toJson(linksJsonList))
    }

  def get(id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      idValidated <- ObjectId.fromString(id)

      annotationPrivateLink <- annotationPrivateLinkDAO.findOne(idValidated)
      _ <- bool2Fox(annotationPrivateLink.expirationDateTime.forall(_ > Instant.now)) ?~> "Token expired" ~> NOT_FOUND
      _ <- annotationDAO.findOne(annotationPrivateLink._annotation) ?~> "annotation.notFound" ~> NOT_FOUND

      annotationPrivateLinkJs <- annotationPrivateLinkService.publicWrites(annotationPrivateLink)
    } yield Ok(annotationPrivateLinkJs)
  }

  def create: Action[AnnotationPrivateLinkParams] = sil.SecuredAction.async(validateJson[AnnotationPrivateLinkParams]) {
    implicit request =>
      val params = request.body
      val _id = ObjectId.generate
      val accessToken = annotationPrivateLinkService.generateToken
      for {
        annotationId <- ObjectId.fromString(params.annotation)
        _ <- annotationDAO.assertUpdateAccess(annotationId) ?~> "notAllowed" ~> FORBIDDEN
        _ <- annotationPrivateLinkDAO.insertOne(
          AnnotationPrivateLink(_id, annotationId, accessToken, params.expirationDateTime)) ?~> "create.failed"
        inserted <- annotationPrivateLinkDAO.findOne(_id)
        js <- annotationPrivateLinkService.publicWrites(inserted)
      } yield Ok(js)
  }

  def update(id: String): Action[AnnotationPrivateLinkParams] =
    sil.SecuredAction.async(validateJson[AnnotationPrivateLinkParams]) { implicit request =>
      val params = request.body
      for {
        annotationId <- ObjectId.fromString(params.annotation)
        idValidated <- ObjectId.fromString(id)
        aPLInfo <- annotationPrivateLinkDAO.findOne(idValidated) ?~> "annotation private link not found" ~> NOT_FOUND
        _ <- annotationDAO.assertUpdateAccess(aPLInfo._annotation) ?~> "notAllowed" ~> FORBIDDEN
        _ <- annotationDAO.assertUpdateAccess(annotationId) ?~> "notAllowed" ~> FORBIDDEN
        _ <- annotationPrivateLinkDAO.updateOne(idValidated, annotationId, params.expirationDateTime) ?~> "update.failed"
        updated <- annotationPrivateLinkDAO.findOne(idValidated) ?~> "not Found"
        js <- annotationPrivateLinkService.publicWrites(updated) ?~> "write failed"
      } yield Ok(js)
    }

  def delete(id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      idValidated <- ObjectId.fromString(id)
      aPLInfo <- annotationPrivateLinkDAO.findOne(idValidated) ?~> "notFound" ~> NOT_FOUND
      _ <- annotationDAO.assertUpdateAccess(aPLInfo._annotation) ?~> "notAllowed" ~> FORBIDDEN
      _ <- annotationPrivateLinkDAO.deleteOne(idValidated) ?~> "delete failed"
    } yield JsonOk("privateLink deleted")
  }
}
