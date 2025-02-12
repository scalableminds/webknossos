package controllers

import play.silhouette.api.Silhouette
import com.scalableminds.util.tools.FoxImplicits
import models.annotation.{TracingStore, TracingStoreDAO, TracingStoreService}
import play.api.libs.functional.syntax._
import play.api.libs.json._

import javax.inject.Inject
import play.api.mvc.{AbstractController, Action, AnyContent, ControllerComponents}
import security.WkEnv

import scala.concurrent.ExecutionContext

class TracingStoreController @Inject() (
    tracingStoreService: TracingStoreService,
    tracingStoreDAO: TracingStoreDAO,
    sil: Silhouette[WkEnv],
    cc: ControllerComponents
)(implicit ec: ExecutionContext)
    extends AbstractController(cc)
    with WkControllerUtils
    with FoxImplicits {
  private val tracingStorePublicReads: Reads[TracingStore] =
    ((__ \ "name").read[String] and
      (__ \ "url").read[String] and
      (__ \ "publicUrl").read[String])(TracingStore.fromUpdateForm)

  def listOne: Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    for {
      tracingStore <- tracingStoreDAO.findFirst ?~> "tracingStore.list.failed"
      js <- tracingStoreService.publicWrites(tracingStore)
    } yield Ok(Json.toJson(js))
  }

  def update(name: String): Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(tracingStorePublicReads) { tracingStore =>
      for {
        _ <- bool2Fox(request.identity.isAdmin)
        _ <- tracingStoreDAO.findOneByName(name) ?~> "tracingStore.notFound" ~> NOT_FOUND
        _ <- bool2Fox(tracingStore.name == name)
        _ <- tracingStoreDAO.updateOne(tracingStore) ?~> "tracingStore.create.failed"
        js <- tracingStoreService.publicWrites(tracingStore)
      } yield Ok(Json.toJson(js))
    }
  }

}
