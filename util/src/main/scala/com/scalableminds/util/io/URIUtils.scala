package com.scalableminds.util.io

import java.net.URI

object URIUtils extends URIUtils

trait URIUtils {

  def isSubpath(parentUri: URI, subUri: URI): Boolean = {
    // Compare scheme and authority
    if (parentUri.getScheme != subUri.getScheme ||
        parentUri.getAuthority != subUri.getAuthority) return false

    // Normalize paths
    val configPath = parentUri.getPath.stripSuffix("/")
    val targetPath = subUri.getPath.stripSuffix("/")

    // Ensure target path starts with the configured path followed by "/" or is exactly the same
    targetPath == configPath || targetPath.startsWith(configPath + "/")
  }
}
