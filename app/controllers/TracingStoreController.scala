package controllers

import com.scalableminds.util.Msg
import play.silhouette.api.Silhouette
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{TracingStore, TracingStoreDAO, TracingStoreService}
import play.api.libs.functional.syntax._
import play.api.libs.json._

import javax.inject.Inject
import play.api.mvc.{Action, AnyContent}
import security.WkEnv

import scala.concurrent.ExecutionContext

class TracingStoreController @Inject()(tracingStoreService: TracingStoreService,
                                       tracingStoreDAO: TracingStoreDAO,
                                       sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  private val tracingStorePublicReads: Reads[TracingStore] =
    ((__ \ "name").read[String] and
      (__ \ "url").read[String] and
      (__ \ "publicUrl").read[String])(TracingStore.fromUpdateForm _)

  def listOne: Action[AnyContent] = sil.UserAwareAction.async {
    for {
      tracingStore <- tracingStoreDAO.findFirst ?~> Msg.TracingStore.listFailed
      js <- tracingStoreService.publicWrites(tracingStore)
    } yield Ok(Json.toJson(js))
  }

  def update(name: String): Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(tracingStorePublicReads) { tracingStore =>
      for {
        _ <- Fox.fromBool(request.identity.isAdmin)
        _ <- tracingStoreDAO.findOneByName(name) ?~> Msg.TracingStore.notFound ~> NOT_FOUND
        _ <- Fox.fromBool(tracingStore.name == name)
        _ <- tracingStoreDAO.updateOne(tracingStore) ?~> Msg.TracingStore.createFailed
        js <- tracingStoreService.publicWrites(tracingStore)
      } yield Ok(Json.toJson(js))
    }
  }

}
