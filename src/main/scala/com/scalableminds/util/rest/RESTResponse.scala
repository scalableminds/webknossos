/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.rest

import play.api.libs.json.{JsValue, Json}

case class RESTResponse(uuid: String, status: String, path: String, headers: Map[String, String], body: JsValue)

object RESTResponse {
  implicit val restResponseReads = Json.reads[RESTResponse]
}