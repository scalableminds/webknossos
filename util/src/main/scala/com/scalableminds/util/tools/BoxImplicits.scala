package com.scalableminds.util.tools

import net.liftweb.common.{Box, Failure, Full}
import play.api.libs.json.{JsError, JsResult, JsSuccess}

trait BoxImplicits {

  implicit def option2Box[T](in: Option[T]): Box[T] = Box(in)

  implicit def box2Option[T](in: Box[T]): Option[T] = in match {
    case Full(t) => Some(t)
    case _       => None
  }

  implicit def jsResult2Box[T](result: JsResult[T]): Box[T] = result match {
    case JsSuccess(value, _) => Full(value)
    case JsError(e)          => Failure(s"Invalid json: $e")
  }
}

object BoxImplicits extends BoxImplicits
