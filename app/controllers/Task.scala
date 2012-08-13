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
import models.DataSet
import models.graph.Node
import models.graph.Edge
import brainflight.tools.geometry.Point3D

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 19.12.11
 * Time: 11:27
 */
class TaskHandler(var task: Experiment) {

  def parseNode(jso: JsObject) = {
    for {
      id <- (jso \ "id").asOpt[Int]
      radius <- (jso \ "radius").asOpt[Float]
      positionArray <- (jso \ "position").asOpt[Array[Int]]
      position <- Point3D.fromArray(positionArray)
      viewport <- (jso \ "viewport").asOpt[Int]
      resolution <- (jso \ "resolution").asOpt[Int]

    } yield {
      val time = System.currentTimeMillis
      Node(id, radius, position, viewport, resolution, time)
    }
  }

  def parseEdges(nodes: List[Node], edgesList: List[List[Int]]) = {
    edgesList.flatMap {
      case (s :: t :: _) =>
        for {
          source <- nodes.find(_.id == s)
          target <- nodes.find(_.id == t)
        } yield {
          Edge(source, target)
        }
      case _ => None
    }
  }

  def processInput(input: JsValue) {
    (input.asOpt[Map[String, JsValue]]) map { obj =>
      obj.collect {
        case ("log", value) =>
          for {
            treeId <- (value \ "treeId").asOpt[Int]
            nodeObjs <- (value \ "nodes").asOpt[List[JsObject]]
            edgeList <- (value \ "edges").asOpt[List[List[Int]]]
            tree <- task.tree(treeId)
          } {
            val nodes = nodeObjs.flatMap(parseNode)
            var updatedTree = tree.addNodes(nodes)
            val edges = parseEdges( updatedTree.nodes, edgeList)
            Experiment.save(task.updateTree(updatedTree.addEdges(edges)))
          }
        case ("useBranchpoint", value) =>
        // TODO
        case ("addBranchpoint", value) =>
        // TODO
      }
    }
  }

  def createDataSetInformation(dataSetId: ObjectId) =
    DataSet.findOneById(dataSetId) match {
      case Some(dataSet) =>
        Json.obj(
          "dataSet" -> Json.obj(
            "id" -> dataSet.id,
            "resolutions" -> dataSet.supportedResolutions,
            "upperBoundary" -> dataSet.maxCoordinates))
      case _ =>
        Json.obj("error" -> "Couldn't find dataset.")
    }

  def createTaskInformation = {
    Json.obj(
      "task" -> task)
  }

  def unicastOnStart(channel: Channel[JsValue]) {
    channel.push(
      createTaskInformation ++ createDataSetInformation(task.dataSetId))
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

  def connect(taskId: String) = AuthenticatedWebSocket[JsValue]() { user =>
    request =>
      (for {
        task <- Experiment.findOneById(taskId)
      } yield (new TaskHandler(task)).openWebsocket()) getOrElse createEOFPair(Some("Couldn't find a task."))
  }

  def cometRCV(taskId: String, callback: String) = Authenticated { implicit request =>
    val (_, output) = (for {
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