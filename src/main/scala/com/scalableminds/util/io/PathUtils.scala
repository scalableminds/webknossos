/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.io

import scalax.file.{PathMatcher, Path}

object PathUtils extends PathUtils

trait PathUtils {
  def listDirectories(p: Path) =
    if (p.isDirectory) p.children(PathMatcher.IsDirectory).toList
    else Nil

  def ensureDirectory(path: Path): Path = {
    if (!path.exists || !path.isDirectory)
      path.createDirectory(createParents = true, failIfExists = false)
    path
  }
}
