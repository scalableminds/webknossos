/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.json

import net.liftweb.common.{Box, Empty, Failure, Full}
import play.api.i18n.Messages
import play.api.libs.json._

object JsonUtils {

  def jsError2HumanReadable(js: JsError)(implicit messages: Messages): String = {
    js.errors.map {
      case (path, errors) =>
        val errorStr = errors.map(m => Messages(m.message)).mkString(", ")
        s"Error at json path '$path': $errorStr."
    }.mkString("\n")
  }

  implicit def boxFormat[T: Format]: Format[Box[T]] = new Format[Box[T]]{
    override def reads(json: JsValue): JsResult[Box[T]] = {
      (json \ "status").validate[String].flatMap {
        case "Full" => (json \ "value").validate[T].map(Full(_))
        case "Empty" => JsSuccess(Empty)
        case "Failure" => (json \ "value").validate[String].map(Failure(_))
        case _ => JsError("invalid status")
      }
    }

    override def writes(o: Box[T]): JsValue = o match {
      case Full(t) => Json.obj("status" -> "Full", "value" -> Json.toJson(t))
      case Empty => Json.obj("status" -> "Empty")
      case f: Failure => Json.obj("status" -> "Failure", "value" -> f.msg)
    }
  }
}
