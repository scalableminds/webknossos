/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.reactivemongo

trait UnAuthorizedDBAccess {
  implicit val ctx: DBAccessContext = UnAuthorizedAccessContext
}

trait GlobalDBAccess {
  implicit val ctx: DBAccessContext = GlobalAccessContext
}
