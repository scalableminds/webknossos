package com.scalableminds.webknossos.tracingstore.controllers

import com.scalableminds.webknossos.datastore.controllers.Controller
import com.scalableminds.webknossos.tracingstore.RedisTemporaryStore
import com.scalableminds.webknossos.tracingstore.tracings.TracingDataStore
import com.scalableminds.webknossos.tracingstore.tracings.volume.BucketIterator
import javax.inject.Inject
import play.api.libs.json.Json

import scala.concurrent.ExecutionContext

class Application @Inject()(tracingDataStore: TracingDataStore, redisClient: RedisTemporaryStore)(
    implicit ec: ExecutionContext)
    extends Controller {

  def health = Action.async { implicit request =>
    log {
      AllowRemoteOrigin {
        for {
          _ <- tracingDataStore.healthClient.checkHealth
          _ <- redisClient.checkHealth
        intList = debugIterator.toList
        } yield Ok(Json.toJson(intList))
      }
    }
  }

  def debugIterator: Iterator[Int] = {
    val iterator = new DebugIterator()
    iterator.map {
      case i: Int => println("debugIterator map item: "); i
    }
  }

}


class DebugIterator extends Iterator[Int] {
  var i = 0

  override def next: Int = {
    val r = scala.util.Random
    if (r.nextInt(100) > 50) {
      println("debugIterator boom")
      throw new Exception("Boom")
    } else {
      println("debugIterator yielding 1")
    }
    val value = i
    i += 1
    value
  }

  override def hasNext: Boolean = {
    if (i < 20) {
      println("debugIterator hasNext")
      true
    } else {
      println("debugIterator end")
      false
    }
  }
}
