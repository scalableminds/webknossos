package controllers

import com.scalableminds.util.accesscontext.DBAccessContext
import javax.inject.Inject
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.binary.{DataStore, DataStoreDAO, DataStoreService}
import oxalis.security.WkEnv
import com.mohiva.play.silhouette.api.Silhouette
import com.mohiva.play.silhouette.api.actions.{SecuredRequest, UserAwareRequest}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.json.{Json, Writes}

import scala.concurrent.ExecutionContext

class DataStoreController @Inject()(dataStoreDAO: DataStoreDAO,
                                    dataStoreService: DataStoreService,
                                    sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  def list = sil.UserAwareAction.async { implicit request =>
    for {
      dataStores <- dataStoreDAO.findAll ?~> "dataStore.list.failed"
      js <- Fox.serialCombined(dataStores)(d => dataStoreService.publicWrites(d))
    } yield {
      Ok(Json.toJson(js))
    }
  }
}
