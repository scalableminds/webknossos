package com.scalableminds.brainflight.handler

import net.liftweb.http._
import scala.Predef._
import net.liftweb.common.Full
import com.scalableminds.brainflight.binary.{CubeModel, ModelStore}

/**
 * Scalable Minds - Brainflight
 * User: tmbo
 * Date: 10/10/11
 * Time: 4:29 AM
 */


object RequestHandler{
  def serve : LiftRules.DispatchPF = {
    // got a request for binary image data
    // should look like: http://localhost/requestData/cube?px=25&py=0&pz=25&ax=0&ay=0&az=0
    // parameters starting with p define the request point, the ones starting with a define the request axis
    case Req("requestData" :: modelType :: Nil, _ , GetRequest) => () => {
      for {
        px <- S.param("px")  ?~ "You missed to send your request points x."
        py <- S.param("py")  ?~ "You missed to send your request points y."
        pz <- S.param("pz")  ?~ "You missed to send your request points z."

        ax <- S.param("ax")  ?~ "You missed to send your axis x."
        ay <- S.param("ay")  ?~ "You missed to send your axis y."
        az <- S.param("az")  ?~ "You missed to send your axis z."
      } yield {
        try {
          val axis = (ax.toInt, ay.toInt,az.toInt)
          (ModelStore(modelType),axis) match {
            case (_,(0,0,0)) =>
              net.liftweb.http.NotAcceptableResponse("Axis is not allowed to be (0,0,0).")
            case (Some(m),_) =>
              DataRequestHandler(
                m,
                (px.toInt,py.toInt,pz.toInt),
                axis
              )
            case _ =>
              NotFoundResponse("Model not available.")
          }
        }catch{
          case x:NumberFormatException => NotFoundResponse("Params aren't valid integers.")
        }
      }
    }
    // got a request for a models data
    // should look like: http://localhost/requestModel/cube
    case Req("requestModel" :: modelType :: Nil, _ , GetRequest) => () => {
      ModelStore(modelType) match {
        case Some(m) => Full(InMemoryResponse(m.modelInformation,
                              List("Content-Type" -> "application/octet-stream"),
                              List(),
                              200
                         ))
        case _ => Full(NotFoundResponse("Model not available."))
      }

    }
  }

}