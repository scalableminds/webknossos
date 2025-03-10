package controllers

import play.silhouette.api.Silhouette
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits

import models.dataset.{PublicationDAO, PublicationService}
import play.api.libs.json._
import play.api.mvc.{Action, AnyContent}
import security.WkEnv
import com.scalableminds.util.objectid.ObjectId

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class PublicationController @Inject()(publicationService: PublicationService,
                                      publicationDAO: PublicationDAO,
                                      sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller
    with ProtoGeometryImplicits
    with FoxImplicits {

  override def allowRemoteOrigin: Boolean = true

  def read(publicationId: ObjectId): Action[AnyContent] =
    sil.UserAwareAction.async { implicit request =>
      for {
        publication <- publicationDAO.findOne(publicationId) ?~> "publication.notFound" ~> NOT_FOUND
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
