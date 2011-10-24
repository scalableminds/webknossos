package com.scalableminds.brainflight.handler

import scala.Predef._
import net.liftweb.common.Full
import com.scalableminds.brainflight.binary.ModelStore
import net.liftweb.http._
import rest.RestHelper

/**
 * Scalable Minds - Brainflight
 * User: tmbo
 * Date: 10/10/11
 * Time: 4:29 AM
 */


object RequestHandler extends RestHelper{
  serve{
    // got a request for binary image data
    // should look like: http://localhost/requestData/cube?px=25&py=0&pz=25&ax=0&ay=0&az=0
    // parameters starting with p define the request point, the ones starting with a define the request axis
    case Req("data" :: modelType :: Nil, _ , _) => {
      for {
        px <- S.param("px")  ?~ "You missed to send your request points x (e.q. 'px=5')." ~> 400
        py <- S.param("py")  ?~ "You missed to send your request points y (e.q. 'py=3')." ~> 400
        pz <- S.param("pz")  ?~ "You missed to send your request points z (e.q. 'pz=1')." ~> 400

        ax <- S.param("ax")  ?~ "You missed to send your axis x (e.q. 'ax=5')." ~> 400
        ay <- S.param("ay")  ?~ "You missed to send your axis y (e.q. 'ay=5')." ~> 400
        az <- S.param("az")  ?~ "You missed to send your axis z (e.q. 'az=5')." ~> 400
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
    case Req("model" :: modelType :: Nil, _ , GetRequest) => {
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