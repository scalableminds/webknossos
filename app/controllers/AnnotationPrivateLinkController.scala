package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.FoxImplicits
import io.swagger.annotations._
import play.api.libs.json._

import javax.inject.Inject
import models.annotation._
import oxalis.security.{RandomIDGenerator, WkEnv}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import utils.ObjectId

import scala.concurrent.ExecutionContext
@Api
class AnnotationPrivateLinkController @Inject()(
    annotationDAO: AnnotationDAO,
    annotationService: AnnotationService,
    annotationPrivateLinkDAO: AnnotationPrivateLinkDAO,
    annotationPrivateLinkService: AnnotationPrivateLinkService,
    sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, val bodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  @ApiOperation(hidden = true, value = "")
  def lookupPrivateLink(accessToken: String): Action[AnyContent] = sil.UnsecuredAction.async { implicit request =>
    for {
      annotationPrivateLink <- annotationPrivateLinkDAO.findOneByAccessToken(accessToken)(GlobalAccessContext)
      _ <- bool2Fox(annotationPrivateLink.expirationDateTime.forall(_ > System.currentTimeMillis())) ?~> "Token expired" ~> 404
      annotation: Annotation <- annotationDAO.findOne(annotationPrivateLink._annotation)(GlobalAccessContext)
      writtenAnnotation <- annotationService.writesLayersAndStores(annotation)
    } yield Ok(writtenAnnotation)
  }

  def list: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      links <- annotationPrivateLinkDAO.findAll
      linksJsonList <- Fox.serialCombined(links)(annotationPrivateLinkService.publicWrites)
    } yield Ok(Json.toJson(linksJsonList))
  }

  def get(id: String): Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    for {
      idValidated <- ObjectId.fromString(id)

      annotationPrivateLink <- annotationPrivateLinkDAO.findOne(idValidated)(GlobalAccessContext)
      _ <- bool2Fox(annotationPrivateLink.expirationDateTime.forall(_ > System.currentTimeMillis())) ?~> "Token expired" ~> 404
      _ <- annotationDAO
        .findOne(annotationPrivateLink._annotation)(GlobalAccessContext) ?~> "annotation.notFound" ~> NOT_FOUND

      annotationPrivateLinkJs <- annotationPrivateLinkService.publicWrites(annotationPrivateLink)
    } yield Ok(annotationPrivateLinkJs)
  }

  def create: Action[AnnotationPrivateLinkParams] = sil.SecuredAction.async(validateJson[AnnotationPrivateLinkParams]) {
    implicit request =>
      println(s"request body ${request.body}")
      val params = request.body
      val _id = ObjectId.generate
      val accessToken = RandomIDGenerator.generateBlocking(24)
      val annotationId = ObjectId(params._annotation)
      for {
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
      val annotationId = ObjectId(params._annotation)
      for {
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
    } yield Ok
  }
}
