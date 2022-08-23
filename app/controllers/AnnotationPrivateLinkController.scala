package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.FoxImplicits
import io.swagger.annotations._
import play.api.libs.json._

import javax.inject.Inject
import models.annotation._
import oxalis.security.WkEnv
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
  def lookupPrivateLink(accessToken: String): Action[AnyContent] = Action.async { implicit request =>
    for {
      annotationPrivateLink <- annotationPrivateLinkDAO.findOneByAccessToken(accessToken)
      _ <- bool2Fox(annotationPrivateLink.expirationDateTime.forall(_ > System.currentTimeMillis())) ?~> "Token expired" ~> 404
      annotation: Annotation <- annotationDAO.findOne(annotationPrivateLink._annotation)(GlobalAccessContext)
      writtenAnnotation <- annotationService.writesAsAnnotationSource(annotation)
    } yield Ok(writtenAnnotation)
  }

  @ApiOperation(value = "List all existing private zarr links for a user", nickname = "listPrivateLinks")
  @ApiResponses(
    Array(new ApiResponse(code = 200, message = "JSON object containing string that private link was deleted."),
          new ApiResponse(code = 400, message = badRequestLabel)))
  def list: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      links <- annotationPrivateLinkDAO.findAll
      linksJsonList <- Fox.serialCombined(links)(annotationPrivateLinkService.publicWrites)
    } yield Ok(Json.toJson(linksJsonList))
  }

  @ApiOperation(value = "List all existing private zarr links for a user for a given annotation",
                nickname = "listPrivateLinksByAnnotation")
  @ApiResponses(
    Array(new ApiResponse(code = 200, message = "JSON object containing string that private link was deleted."),
          new ApiResponse(code = 400, message = badRequestLabel)))
  def listByAnnotation(@ApiParam(value = "The id of the annotation") annotationId: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        annotationIdValidated <- ObjectId.fromString(annotationId)
        links <- annotationPrivateLinkDAO.findAllByAnnotation(annotationIdValidated)
        linksJsonList <- Fox.serialCombined(links)(annotationPrivateLinkService.publicWrites)
      } yield Ok(Json.toJson(linksJsonList))
    }

  @ApiOperation(value = "Get the private zarr link for a user for a given id if it exists", nickname = "getPrivateLink")
  @ApiResponses(
    Array(
      new ApiResponse(code = 200, message = "JSON object containing string that private link was deleted."),
      new ApiResponse(code = 400, message = badRequestLabel),
      new ApiResponse(code = 404, message = badRequestLabel)
    ))
  def get(@ApiParam(value = "The id of the private link") id: String): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        idValidated <- ObjectId.fromString(id)

        annotationPrivateLink <- annotationPrivateLinkDAO.findOne(idValidated)
        _ <- bool2Fox(annotationPrivateLink.expirationDateTime.forall(_ > System.currentTimeMillis())) ?~> "Token expired" ~> NOT_FOUND
        _ <- annotationDAO.findOne(annotationPrivateLink._annotation) ?~> "annotation.notFound" ~> NOT_FOUND

        annotationPrivateLinkJs <- annotationPrivateLinkService.publicWrites(annotationPrivateLink)
      } yield Ok(annotationPrivateLinkJs)
  }

  @ApiOperation(
    value = """Creates a given private link for an annotation for zarr streaming
Expects:
 - As JSON object body with keys:
  - annotation (string): annotation id to create private link for
  - expirationDateTime (Optional[bool]): optional UNIX timestamp, expiration date and time for the link
""",
    nickname = "createPrivateLink"
  )
  @ApiImplicitParams(
    Array(
      new ApiImplicitParam(name = "annotationPrivateLinkParams",
                           required = true,
                           dataTypeClass = classOf[AnnotationPrivateLinkParams],
                           paramType = "body")))
  @ApiResponses(
    Array(
      new ApiResponse(code = 200, message = "JSON object containing string that private link was deleted."),
      new ApiResponse(code = 400, message = badRequestLabel),
      new ApiResponse(code = 404, message = badRequestLabel),
      new ApiResponse(code = 403, message = badRequestLabel)
    ))
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

  @ApiOperation(
    value = """Updates a given private link for an annotation for zarr streaming
Expects:
 - As JSON object body with keys:
  - annotation (string): annotation id to create private link for
  - expirationDateTime (Optional[bool]): optional UNIX timestamp, expiration date and time for the link
""",
    nickname = "updatePrivateLink"
  )
  @ApiImplicitParams(
    Array(
      new ApiImplicitParam(name = "annotationPrivateLinkParams",
                           required = true,
                           dataTypeClass = classOf[AnnotationPrivateLinkParams],
                           paramType = "body")))
  @ApiResponses(
    Array(
      new ApiResponse(code = 200, message = "JSON object containing string that private link was deleted."),
      new ApiResponse(code = 400, message = badRequestLabel),
      new ApiResponse(code = 404, message = badRequestLabel),
      new ApiResponse(code = 403, message = badRequestLabel)
    ))
  def update(@ApiParam(value = "The id of the private link") id: String): Action[AnnotationPrivateLinkParams] =
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

  @ApiOperation(value = "Deletes a given private link for an annotation for zarr streaming",
                nickname = "deletePrivateLink")
  @ApiResponses(
    Array(
      new ApiResponse(code = 200, message = "JSON object containing string that private link was deleted."),
      new ApiResponse(code = 400, message = badRequestLabel),
      new ApiResponse(code = 404, message = badRequestLabel),
      new ApiResponse(code = 403, message = badRequestLabel)
    ))
  def delete(@ApiParam(value = "The id of the private link") id: String): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        idValidated <- ObjectId.fromString(id)
        aPLInfo <- annotationPrivateLinkDAO.findOne(idValidated) ?~> "notFound" ~> NOT_FOUND
        _ <- annotationDAO.assertUpdateAccess(aPLInfo._annotation) ?~> "notAllowed" ~> FORBIDDEN
        _ <- annotationPrivateLinkDAO.deleteOne(idValidated) ?~> "delete failed"
      } yield JsonOk("privateLink deleted")
  }
}
