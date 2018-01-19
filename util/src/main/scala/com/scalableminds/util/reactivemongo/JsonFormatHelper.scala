/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.reactivemongo

import play.api.data.validation.ValidationError
import play.api.libs.json.Reads
import reactivemongo.bson.BSONObjectID

object JsonFormatHelper{
  def StringObjectIdReads(key: String) =
    Reads.filter[String](ValidationError("objectid.invalid", key))(BSONObjectID.parse(_).isSuccess)
}
