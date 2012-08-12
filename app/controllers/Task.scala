package controllers

import play.api.Logger
import play.api.libs.json.Json._
import play.api.libs.json._
import models.BranchPoint
import play.api.mvc._
import org.bson.types.ObjectId
import brainflight.tools.Math._
import brainflight.security.Secured
import brainflight.tools.geometry.Vector3I
import brainflight.tools.geometry.Vector3I._
import models.{ User, TransformationMatrix }
import models.Role
import models.Origin
import models.graph.Experiment
import play.api.libs.iteratee.Concurrent
import play.api.libs.iteratee.Iteratee
import play.api.libs.iteratee.Concurrent.Channel
import play.api.libs.iteratee.Input
import play.api.libs.iteratee.Done
import play.api.libs.iteratee.Enumerator
import play.api.libs.Comet

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 19.12.11
 * Time: 11:27
 */
class TaskHandler(var task: Experiment) {
  def processInput(input: JsValue) {
    (input.asOpt[Map[String, JsValue]]) map { obj =>
      obj.collect {
        case ("log", value)            =>
        // TODO
        case ("useBranchpoint", value) =>
        // TODO
        case ("addBranchpoint", value) =>
        // TODO
      }
    }
  }

  def unicastOnStart(channel: Channel[JsValue]) {
    channel.push(Json.obj(
      "task" -> task))
  }

  def unicastOnComplete() {
    Logger.trace("Unicast task socket completed.")
  }

  def unicastOnError(error: String, input: Input[JsValue]) {
    Logger.warn("Error on task socket: %s".format(error))
  }

  def openWebsocket() = {
    val output = Concurrent.unicast[JsValue](
      unicastOnStart,
      unicastOnComplete,
      unicastOnError)

    val input = Iteratee.foreach[JsValue] { input =>
      processInput(input)
    } /*.mapDone { _ =>
      
    }*/
    (input, output)
  }
}

object Task extends Controller with Secured {
  override val DefaultAccessRole = Role.User

  def createEOFPair(error: Option[String] = None) = {
    val iteratee = Done[JsValue, Unit]((), Input.EOF)

    // Send an error and close the socket    

    val enumerator = Enumerator[JsValue](
      // send any kind of error message here    
      Json.toJson(Map(
        "error" -> (error getOrElse "connection closed")))).andThen(Enumerator.enumInput(Input.EOF))
    (iteratee, enumerator)
  }

  def createTaskInformation(user: User, task: Experiment) = {
    Json.obj(
      "task" -> task)
  }

  def initialize(dataSetId: String) = Authenticated {
    implicit request =>
      val user = request.user
      (for {
        taskId <- user.tasks.headOption
        task <- Experiment.findOneById(taskId)
      } yield Ok(createTaskInformation(user, task))) getOrElse BadRequest("Couldn't open new route.")
  }

  def connect(dataSetId: String) = AuthenticatedWebSocket[JsValue]() { user =>
    request =>
      (for {
        taskId <- user.tasks.headOption
        task <- Experiment.findOneById(taskId)
      } yield (new TaskHandler(task)).openWebsocket()) getOrElse createEOFPair(Some("Couldn't find a task."))
  }

  def cometRCV(dataSetId: String, callback: String) = Authenticated { implicit request =>
    val (_, output) = (for {
      taskId <- request.user.tasks.headOption
      task <- Experiment.findOneById(taskId)
    } yield (new TaskHandler(task)).openWebsocket()) getOrElse createEOFPair(Some("Couldn't find a task."))
    Ok.stream(output &> Comet(callback = "parent." + callback))
  }

  def cometSND(taskId: String) = Authenticated(parser = parse.json) { implicit request =>
    Experiment.findOneById(taskId).map { task =>
      ((new TaskHandler(task)) processInput (request.body))
      Ok
    } getOrElse BadRequest("Couldn't update the requested task.")
  }
}