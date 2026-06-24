package controllers

import com.scalableminds.util.Msg
import play.silhouette.api.Silhouette
import com.scalableminds.util.tools.Fox
import models.annotation.{TracingStoreDAO, TracingStoreService}
import play.api.libs.json.{Json, OFormat}

import javax.inject.Inject
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import security.WkEnv

import scala.concurrent.ExecutionContext

case class TracingStoreParameters(name: String, url: String, publicUrl: String)
object TracingStoreParameters {
  implicit val jsonFormat: OFormat[TracingStoreParameters] = Json.format[TracingStoreParameters]
}

class TracingStoreController @Inject() (
    tracingStoreService: TracingStoreService,
    tracingStoreDAO: TracingStoreDAO,
    sil: Silhouette[WkEnv]
)(implicit ec: ExecutionContext, playBodyParsers: PlayBodyParsers)
    extends Controller
     {

  def listOne: Action[AnyContent] = sil.UserAwareAction.async {
    for {
      tracingStore <- tracingStoreDAO.findFirst ?~> Msg.TracingStore.listFailed
      js <- tracingStoreService.publicWrites(tracingStore)
    } yield Ok(Json.toJson(js))
  }

  def update(name: String): Action[TracingStoreParameters] =
    sil.SecuredAction.async(validateJson[TracingStoreParameters]) { implicit request =>
      for {
        _ <- Fox.fromBool(request.identity.isAdmin)
        existing <- tracingStoreDAO.findOneByName(name) ?~> Msg.TracingStore.notFound ~> NOT_FOUND
        _ <- Fox.fromBool(request.body.name == name)
        updated = existing.copy(name = request.body.name, url = request.body.url, publicUrl = request.body.publicUrl)
        _ <- tracingStoreDAO.updateOne(updated) ?~> Msg.TracingStore.createFailed
        js <- tracingStoreService.publicWrites(updated)
      } yield Ok(Json.toJson(js))
    }

}
