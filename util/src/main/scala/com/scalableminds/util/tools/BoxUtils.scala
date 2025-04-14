package com.scalableminds.util.tools

import net.liftweb.common.{Box, Empty, Failure, Full}
import play.api.libs.json.{JsError, JsResult, JsSuccess}

object BoxUtils {

  def jsResult2Box[T](result: JsResult[T]): Box[T] = result match {
    case JsSuccess(value, _) => Full(value)
    case JsError(e)          => Failure(s"Invalid json: $e")
  }

  def bool2Box(in: Boolean): Box[Unit] = if (in) Full(()) else Empty

}
