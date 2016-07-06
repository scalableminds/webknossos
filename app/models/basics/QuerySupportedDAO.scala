/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.basics

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.Fox
import play.api.libs.json.JsObject

trait QuerySupportedDAO[T] {
  def executeUserQuery(q: JsObject, limit: Int)(implicit ctx: DBAccessContext): Fox[List[T]]
}
