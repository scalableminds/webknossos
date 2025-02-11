package com.scalableminds.util.tools

import com.scalableminds.util.tools.{Box, Empty, Failure, Full}
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

  implicit def combineErrors(boxes: List[Box[?]]): Option[List[String]] = {
    val failures = boxes.collect { case f: Failure => f }
    if (failures.isEmpty) None else Some(failures.map(_.msg))
  }
}

object BoxImplicits extends BoxImplicits
