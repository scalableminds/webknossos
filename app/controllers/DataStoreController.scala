package controllers

import javax.inject.Inject
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.binary.{DataStore, DataStoreDAO}
import oxalis.security.WebknossosSilhouette.UserAwareAction
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{Json, Writes}

class DataStoreController @Inject()(val messagesApi: MessagesApi) extends Controller with FoxImplicits {
  def list = UserAwareAction.async { implicit request =>
    for {
      dataStores <- DataStoreDAO.findAll ?~> Messages("dataStore.list.failed")
      js <- Fox.serialCombined(dataStores)(d => d.publicWrites)
    } yield {
      Ok(Json.toJson(js))
    }
  }
}
