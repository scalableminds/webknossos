package controllers

import play.silhouette.api.Silhouette
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import io.swagger.annotations._
import models.dataset.{PublicationDAO, PublicationService}
import play.api.libs.json._
import play.api.mvc.{Action, AnyContent}
import security.WkEnv
import utils.ObjectId

import javax.inject.Inject
import scala.concurrent.ExecutionContext

@Api
class PublicationController @Inject()(publicationService: PublicationService,
                                      publicationDAO: PublicationDAO,
                                      sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller
    with ProtoGeometryImplicits
    with FoxImplicits {

  override def allowRemoteOrigin: Boolean = true

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
