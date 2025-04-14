package com.scalableminds.util.tools

import net.liftweb.common.{Box, Empty, Failure, Full}
import play.api.libs.json.{JsError, JsResult, JsSuccess}

trait BoxImplicits {

  def option2Box[T](in: Option[T]): Box[T] = Box(in)

  def jsResult2Box[T](result: JsResult[T]): Box[T] = result match {
    case JsSuccess(value, _) => Full(value)
    case JsError(e)          => Failure(s"Invalid json: $e")
  }

  def bool2Box(in: Boolean): Box[Unit] = if (in) Full(()) else Empty

  def assertNoFailure(boxes: Seq[Box[_]]): Box[Unit] = {
    val firstFailure = boxes.find {
      case _: Failure => true
      case _          => false
    }
    firstFailure match {
      case Some(failure) => Failure(s"At least one failure contained in list of ${boxes.length} boxes: $failure")
      case None          => Full(())
    }
  }

}

object BoxImplicits extends BoxImplicits
