/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.tools

import org.apache.commons.lang3.StringUtils

object TextUtils extends TextUtils

trait TextUtils {
  val searchList = Array("Ä", "ä", "Ö", "ö", "Ü", "ü", "ß")
  val replaceList = Array("Ae", "ae", "Oe", "oe", "Ue", "ue", "sz")

  def normalize(s: String) = {
    if (s == null)
      s
    else {
      StringUtils.replaceEachRepeatedly(s, searchList, replaceList)
    }
  }
}