/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.reactivemongo

import play.api.libs.json.{JsObject, Json}

object AccessRestrictions{
  trait AccessRestriction

  val AllowEveryone = AllowIf(Json.obj())

  case class AllowIf(condition: JsObject) extends AccessRestriction

  case class DenyEveryone() extends AccessRestriction
}