/*
* Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.webknossos.datastore.models

import play.api.libs.json.Json

case class ImageThumbnail(mimeType: String, value: String)

object ImageThumbnail {
  implicit val imageThumbnailFormat = Json.format[ImageThumbnail]
}
