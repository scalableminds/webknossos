package com.scalableminds.webknossos.datastore.controllers

import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.tracings.TracingDataStore
import javax.inject.Inject

import play.api.mvc.Action
import play.api.mvc.Results.Ok

import scala.concurrent.ExecutionContext

class Application @Inject()(tracingDataStore: TracingDataStore,
                            dataStoreConfig: DataStoreConfig)
                           (implicit ec: ExecutionContext)
  extends Controller {

  def health = Action.async { implicit request =>
    AllowRemoteOrigin {
      for {
        _ <- tracingDataStore.healthClient.checkHealth
      } yield Ok("Ok")
    }
  }
}
