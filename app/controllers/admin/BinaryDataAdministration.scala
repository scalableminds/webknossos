package controllers.admin

import controllers.Controller
import play.api.libs.concurrent.Akka
import play.api.Play.current
import brainflight.security.Secured
import akka.actor.Props
import brainflight.binary._
import models.binary.DataSet
import akka.util.Timeout
import akka.util.duration._
import akka.pattern.ask
import akka.pattern.AskTimeoutException
import play.api.libs.concurrent._
import views._
import play.api.libs.json.Json
import play.api.libs.concurrent.execution.defaultContext

object BinaryDataAdministration extends Controller with Secured {

  val dataInsertionActor = Akka.system.actorOf(Props(new BinaryData2DBActor))

  implicit val timeout = Timeout(5 seconds)

  def insertionProgress = Authenticated { implicit request =>
    Async {
      val future = dataInsertionActor ? InsertionState()
      future
        .recover {
          case e: AskTimeoutException =>
            Promise.pure(Map[DataSet, Double]())
        }
        .mapTo[Map[DataSet, Double]].asPromise.map { states =>
          Ok(Json.toJson(states.map {
            case (dataSet, state) =>
              dataSet.name -> state
          }))
        }
    }
  }

  def list = Authenticated { implicit request =>
    Ok(html.admin.binary.binaryData())
  }

  def insertIntoDB(dataSetName: String) = Authenticated { implicit request =>
    import brainflight.binary.GridDataStore
    import akka.agent.Agent
    import brainflight.binary.Data

    implicit val system = Akka.system

    DataSet.findOneByName(dataSetName).map { dataSet =>
      dataInsertionActor ! InsertBinary(dataSet)
      Ok
    }.getOrElse(BadRequest("DataSet not found!"))
  }
}