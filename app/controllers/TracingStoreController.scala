package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.FoxImplicits
import javax.inject.Inject
import models.annotation.{TracingStore, TracingStoreDAO, TracingStoreService}
import net.liftweb.common.Empty
import oxalis.security.WkEnv
import play.api.i18n.Messages
import play.api.libs.functional.syntax._
import play.api.libs.json._

import scala.concurrent.{ExecutionContext, Future}

class TracingStoreController @Inject()(tracingStoreService: TracingStoreService,
                                       tracingStoreDAO: TracingStoreDAO,
                                       sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {
  val tracingStorePublicReads: Reads[TracingStore] =
    ((__ \ 'name).read[String] and
      (__ \ 'url).read[String] and
      (__ \ 'publicUrl).read[String])(TracingStore.fromUpdateForm _)

  def listOne = sil.UserAwareAction.async { implicit request =>
    for {
      tracingStore <- tracingStoreDAO.findFirst ?~> "tracingStore.list.failed"
      js <- tracingStoreService.publicWrites(tracingStore)
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def update(name: String) = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(tracingStorePublicReads) { tracingStore =>
      for {
        _ <- bool2Fox(request.identity.isAdmin)
        _ <- tracingStoreDAO.findOneByName(name) ?~> "tracingStore.notFound" ~> NOT_FOUND
        _ <- bool2Fox(tracingStore.name == name)
        _ <- tracingStoreDAO.updateOne(tracingStore) ?~> "tracingStore.create.failed"
        js <- tracingStoreService.publicWrites(tracingStore)
      } yield { Ok(Json.toJson(js)) }
    }
  }

}
