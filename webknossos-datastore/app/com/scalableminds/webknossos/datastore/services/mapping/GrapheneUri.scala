package com.scalableminds.webknossos.datastore.services.mapping

import com.scalableminds.util.box.{Box, Failure, Full}

/** CAVE names a graph with a neuroglancer url, `graphene://https://<host>/segmentation/table/<table>`. Neuroglancer
  * links may add `middleauth+` before `https` to say that the server needs a CAVE token.
  */
object GrapheneUri {
  private val prefix = "graphene://"
  private val authPrefix = "middleauth+"
  private val tablePath = "/segmentation/table/"
  private val apiTablePath = "/segmentation/api/v1/table/"

  def isGraphene(uri: String): Boolean = uri.startsWith(prefix)

  // The url of the graph's segmentation service, e.g. https://<host>/segmentation/table/<table>.
  def withoutPrefixes(uri: String): String = uri.stripPrefix(prefix).stripPrefix(authPrefix).stripSuffix("/")

  def tableName(uri: String): String = withoutPrefixes(uri).split("/").last

  // The PCG API url that PCG attachments point to, e.g. https://<host>/segmentation/api/v1/table/<table>.
  def pcgApiUrl(uri: String): Box[String] = {
    val url = withoutPrefixes(uri)
    if (url.contains(apiTablePath)) Full(url)
    else if (url.contains(tablePath)) Full(url.replace(tablePath, apiTablePath))
    else Failure(s"Expected a graphene url like graphene://https://<host>/segmentation/table/<table>, got $uri")
  }
}
