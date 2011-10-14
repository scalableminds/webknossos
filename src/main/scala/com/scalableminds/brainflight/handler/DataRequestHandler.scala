package com.scalableminds.brainflight.handler

import com.scalableminds.brainflight.binary.{DataStore, DataModel}
import net.liftweb.http.{ InMemoryResponse, LiftResponse}

/**
 * Scalable Minds - Brainflight
 * User: tom
 * Date: 10/10/11
 * Time: 10:55 AM
 */

object DataRequestHandler {
  def apply(dataModel:DataModel,point:Tuple3[Int,Int,Int],axis:Tuple3[Int,Int,Int]):LiftResponse={
    InMemoryResponse(
      dataModel.rotateAndMove(point,axis).map(DataStore.load).toArray,
      List("Content-Type" -> "application/octet-stream"),
      List(),
      200
    )
  }
}