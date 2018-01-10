/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.tools

import java.io.{File, FilenameFilter}

import scala.util.matching.Regex

class FileExtensionFilter(fileExtension: String) extends FilenameFilter{
  override def accept(dir: File, name: String) = name.endsWith(fileExtension)
}

class FileRegExFilter(regEx: Regex) extends FilenameFilter{
  override def accept(dir: File, name: String) = (regEx findFirstIn name).nonEmpty
}
