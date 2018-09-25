package controllers

import javax.inject.Inject
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import oxalis.security.WkEnv
import com.mohiva.play.silhouette.api.Silhouette
import models.annotation.{TracingStoreDAO, TracingStoreService}
import play.api.libs.json.Json

import scala.concurrent.ExecutionContext

class TracingStoreController @Inject()(tracingStoreDAO: TracingStoreDAO,
                                       tracingStoreService: TracingStoreService,
                                    sil: Silhouette[WkEnv])
                                   (implicit ec: ExecutionContext)
  extends Controller with FoxImplicits {

  def listOne = sil.UserAwareAction.async { implicit request =>
    for {
      tracingStores <- tracingStoreDAO.findAll ?~> "tracingStore.list.failed"
      tracingStore <- tracingStores.headOption.toFox
      js <- tracingStoreService.publicWrites(tracingStore)
    } yield {
      Ok(Json.toJson(js))
    }
  }
}
