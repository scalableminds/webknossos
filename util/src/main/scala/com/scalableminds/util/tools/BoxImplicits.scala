package com.scalableminds.util.tools

import net.liftweb.common.{Box, Empty, Failure, Full}
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

  def bool2Box(in: Boolean): Box[Unit] = if (in) Full(()) else Empty

  implicit def combineErrors(boxes: List[Box[_]]): Option[List[String]] = {
    val failures = boxes.collect { case f: Failure => f }
    if (failures.isEmpty) None else Some(failures.map(_.msg))
  }

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
