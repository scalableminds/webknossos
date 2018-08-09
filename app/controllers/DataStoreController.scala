package controllers

import javax.inject.Inject
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.binary.{DataStore, DataStoreDAO, WebKnossosStore}
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

  def addForeignDataStore(name: String, url: String, key: String) = UserAwareAction.async { implicit request =>
    // we could also add the parameter 'isForeign' to the arguments
    val dataStore = DataStore(name, url, WebKnossosStore, key, isForeign = true) // change the key
    for {
      _ <- DataStoreDAO.findOneByName(name).reverse ?~> Messages("dataStore.name.exists") // add this to messages
      _ <- DataStoreDAO.findOneByKey(key).reverse ?~> Messages("dataStore.key.exists") // add this to messages
      _ <- DataStoreDAO.insertOne(dataStore) //?~> Messages("dataStore.list.failed")
    } yield {
      Ok
    }
  }
}
