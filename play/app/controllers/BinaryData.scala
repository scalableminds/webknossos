package controllers

import play.api._
import play.api.mvc._
import play.api.data._

import models._
import views._

import brainflight.binary._

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 11.12.11
 * Time: 13:21
 */

import play.api.libs._

import play.api.libs.iteratee._
import Input.EOF
import play.api.libs.concurrent._

object BinaryData extends Controller with Secured {

  def echo(name: String) = WebSocket[String] { request => (in, out) =>

    Logger.info(name + " is connected!")

    out <<: in.map {
      case EOF => {
        Logger.info(name + " is disconnected. Cleaning resources")
        EOF
      }
      case el => {
        Logger.info("Got message: " + el)
        el.map("[" + name + "] " + _.reverse)
      }
    }

  }
  
  def data(modelType: String, px: Int, py: Int, pz: Int, ax: Int, ay: Int, az: Int) = Action {
    val axis = (ax, ay, az)
    val point = (px,py,pz)
    (ModelStore(modelType), axis) match {
      case (_, (0, 0, 0)) =>
        BadRequest("Axis is not allowed to be (0,0,0).")
      case (Some(m), _) =>
        Ok((m.rotateAndMove(point,axis).map(DataStore.load).toArray))
      case _ =>
        NotFound("Model not available.")
    }
  }

  def model(modelType: String) = Action {
    ModelStore(modelType) match {
      case Some(m) =>
        Ok(m.modelInformation)
      case _ =>
        NotFound("Model not available.")
    }
  }
  def polygons(modelType: String) = Action {
    ModelStore(modelType) match {
      case Some(m) =>
        Ok(json.toJson(m.polygons))
      case _ =>
        NotFound("Model not available.")
    }
  }
}