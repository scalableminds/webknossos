package com.scalableminds.webknossos.datastore.helpers

import com.scalableminds.util.tools.{Box, Failure, Full}
import com.scalableminds.webknossos.datastore.datavault.VaultPath

import java.net.URI

object S3UriUtils {

  def hostBucketFromUPath(upath: UPath): Box[String] = for {
    uri <- upath.toRemoteUri
    _ <- Box.fromBool(uri.getScheme == PathSchemes.schemeS3)
    bucket <- Box(hostBucketFromUri(uri))
  } yield bucket

  def hostBucketFromUri(uri: URI): Option[String] = {
    val host = uri.getHost
    if (host == null) {
      None
    } else if (isShortStyle(uri)) { // assume host is omitted from uri, shortcut form s3://bucket/key
      Some(host)
    } else if (isVirtualHostedStyle(uri)) {
      Some(host.substring(0, host.length - ".s3.amazonaws.com".length))
    } else if (isPathStyle(uri)) {
      Some(uri.getPath.substring(1).split("/")(0))
    } else {
      None
    }
  }

  // https://bucket-name.s3.region-code.amazonaws.com/key-name
  private def isVirtualHostedStyle(uri: URI): Boolean =
    uri.getHost.endsWith(".s3.amazonaws.com")

  // https://s3.region-code.amazonaws.com/bucket-name/key-name
  private def isPathStyle(uri: URI): Boolean =
    uri.getHost.matches("s3(.[\\w\\-_]+)?.amazonaws.com") ||
      (!uri.getHost.contains("amazonaws.com") && uri.getHost.contains("."))

  // S3://bucket-name/key-name
  private def isShortStyle(uri: URI): Boolean =
    !uri.getHost.contains(".")

  def objectKeyFromUPath(upath: UPath): Box[String] = for {
    uri <- upath.toRemoteUri
    _ <- Box.fromBool(uri.getScheme == PathSchemes.schemeS3)
    objectKey <- objectKeyFromUri(uri)
  } yield objectKey

  def objectKeyFromUri(uri: URI): Box[String] =
    if (isVirtualHostedStyle(uri)) {
      Full(uri.getPath)
    } else if (isPathStyle(uri)) {
      Full(uri.getPath.substring(1).split("/").tail.mkString("/"))
    } else if (isShortStyle(uri)) {
      Full(uri.getPath.tail)
    } else Failure(s"Not a valid s3 uri: $uri")

  def objectKeyFromVaultPath(vaultPath: VaultPath): Box[String] =
    objectKeyFromUPath(vaultPath.toUPath)

  def endpointFromUPath(s3UploadBaseDir: UPath): Box[URI] =
    for {
      uri <- s3UploadBaseDir.toRemoteUri
    } yield new URI(
      "https",
      null,
      uri.getHost,
      -1,
      null,
      null,
      null
    )

  def isNonAmazonHost(uri: URI): Boolean =
    (isPathStyle(uri) && !uri.getHost.endsWith(".amazonaws.com")) || uri.getHost == "localhost"

}
