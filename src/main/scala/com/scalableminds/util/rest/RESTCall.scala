/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.rest

import play.api.libs.json.{Json, JsValue}
import java.util.UUID

case class RESTCall(
                     method: String,
                     path: String,
                     headers: Map[String, Seq[String]],
                     queryStrings: Map[String, String],
                     body: JsValue,
                     uuid: String = UUID.randomUUID().toString)

object RESTCall{
  implicit val restCallFormat = Json.format[RESTCall]
}


