/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.xml

object XMLUtils {
  import xml.Text
  implicit def optStrToOptText(opt: Option[String]) = opt.map(Text.apply)
}
