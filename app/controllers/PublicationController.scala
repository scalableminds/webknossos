package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import io.swagger.annotations._
import javax.inject.Inject
import models.binary.{PublicationDAO, PublicationService}
import oxalis.security.WkEnv
import play.api.libs.json._
import play.api.mvc.{Action, AnyContent}
import utils.ObjectId

import scala.concurrent.ExecutionContext

@Api
class PublicationController @Inject()(publicationService: PublicationService,
                                      publicationDAO: PublicationDAO,
                                      sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller
    with ProtoGeometryImplicits
    with FoxImplicits {

  @ApiOperation(value = "Information about a publication", nickname = "publicationInfo")
  @ApiResponses(
    Array(new ApiResponse(code = 200, message = "JSON object containing information about this publication."),
          new ApiResponse(code = 400, message = badRequestLabel)))
  def read(@ApiParam(value = "The id of the publication") publicationId: String): Action[AnyContent] =
    sil.UserAwareAction.async { implicit request =>
      for {
        publication <- publicationDAO.findOne(ObjectId(publicationId)) ?~> "publication.notFound" ~> NOT_FOUND
        js <- publicationService.publicWrites(publication)
      } yield Ok(js)
    }

  def listPublications: Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    {
      for {
        publications <- publicationDAO.findAll ?~> "publication.notFound" ~> NOT_FOUND
        jsResult <- Fox.serialCombined(publications)(publicationService.publicWrites)
      } yield Ok(Json.toJson(jsResult))
    }
  }
}
