package com.scalableminds.util.xml

object XMLUtils {
  import xml.Text
  implicit def optStrToOptText(opt: Option[String]) = opt.map(Text.apply)
}
