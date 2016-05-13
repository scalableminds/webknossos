/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.json

import play.api.i18n.Messages
import play.api.libs.json.JsError

object JsonUtils {
  def jsError2HumanReadable(js: JsError)(implicit messages: Messages): String = {
    js.errors.map {
      case (path, errors) =>
        val errorStr = errors.map(m => Messages(m.message)).mkString(", ")
        s"Error at json path '$path': $errorStr."
    }.mkString("\n")
  }
}
