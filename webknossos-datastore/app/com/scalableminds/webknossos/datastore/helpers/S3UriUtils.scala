package com.scalableminds.webknossos.datastore.helpers

import com.scalableminds.util.Msg
import com.scalableminds.util.box.{Box, Failure, Full}
import com.scalableminds.webknossos.datastore.datavault.VaultPath

import java.net.URI

object S3UriUtils {

  sealed private trait S3UriStyle

  // s3://bucket-name/key-name (uri host is the bucket)
  private case object ShortStyle extends S3UriStyle

  // https://bucket-name.s3.region-code.amazonaws.com/key-name (the bucket is a prefix of the host)
  private case class VirtualHostedStyle(bucket: String) extends S3UriStyle

  // https://s3.region-code.amazonaws.com/bucket-name/key-name (the host is an endpoint,
  // the bucket is the first path segment)
  private case object PathStyle extends S3UriStyle

  // Matches bucket-name.s3.amazonaws.com, bucket-name.s3.us-west-2.amazonaws.com,
  // bucket-name.s3-us-west-2.amazonaws.com and bucket-name.s3.dualstack.us-west-2.amazonaws.com
  private val virtualHostedStyleHostRegex = """^(.+?)\.s3([.-][\w.-]+)?\.amazonaws\.com$""".r

  // Matches s3.amazonaws.com, s3.us-west-2.amazonaws.com, s3-us-west-2.amazonaws.com
  private val amazonEndpointHostRegex = """^s3([.-][\w.-]+)?\.amazonaws\.com$""".r

  // DNS host names cannot exceed this length. Rejecting longer protects against quadratic regex expansion.
  private val maxHostLength = 253

  private def styleOf(uri: URI): Option[S3UriStyle] =
    Option(uri.getHost).filter(_.nonEmpty).filter(_.length <= maxHostLength).map {
      case virtualHostedStyleHostRegex(bucket, _) => VirtualHostedStyle(bucket)
      case host if isEndpointHost(uri, host)      => PathStyle
      case _                                      => ShortStyle
    }

  /** Telling an endpoint host apart from a bucket name can only be done heuristically, since the host slot of an s3://
    * uri is used for both (s3://bucket-name/key vs. s3://my-minio.example.com/bucket-name/key). A host is read as an
    * endpoint if it is an amazon s3 endpoint, if a port is stated (bucket names cannot contain one), if it is
    * localhost, or if it contains a dot. Note that this leaves a bucket name containing dots indistinguishable from an
    * endpoint host; such a host is read as an endpoint.
    */
  private def isEndpointHost(uri: URI, host: String): Boolean =
    amazonEndpointHostRegex.matches(host) || uri.getPort >= 0 || host == "localhost" || host.contains(".")

  private def pathWithoutLeadingSlash(uri: URI): String =
    Option(uri.getPath).getOrElse("").stripPrefix("/")

  // Split the path into its first segment (the bucket, for path style uris) and the remaining key.
  // A trailing slash is part of the key, since it is significant when the key is used as a listing prefix.
  private def firstPathSegmentAndRest(uri: URI): (Option[String], String) = {
    val path = pathWithoutLeadingSlash(uri)
    val separatorIndex = path.indexOf('/')
    if (separatorIndex < 0)
      (Some(path).filter(_.nonEmpty), "")
    else
      (Some(path.take(separatorIndex)).filter(_.nonEmpty), path.drop(separatorIndex + 1))
  }

  def hostBucketFromUPath(upath: UPath): Box[String] = for {
    uri <- upath.toRemoteUri
    _ <- checkSchemeIsS3(uri)
    bucket <- Box.fromOption(hostBucketFromUri(uri))
  } yield bucket

  def hostBucketFromUri(uri: URI): Option[String] =
    styleOf(uri).flatMap {
      case ShortStyle                 => Option(uri.getHost)
      case VirtualHostedStyle(bucket) => Some(bucket)
      case PathStyle                  => firstPathSegmentAndRest(uri)._1
    }

  def objectKeyFromUPath(upath: UPath): Box[String] = for {
    uri <- upath.toRemoteUri
    _ <- checkSchemeIsS3(uri)
    objectKey <- objectKeyFromUri(uri)
  } yield objectKey

  def objectKeyFromUri(uri: URI): Box[String] =
    styleOf(uri) match {
      case Some(ShortStyle) | Some(VirtualHostedStyle(_)) => Full(pathWithoutLeadingSlash(uri))
      case Some(PathStyle)                                => Full(firstPathSegmentAndRest(uri)._2)
      case None                                           => Failure(s"Not a valid s3 uri: $uri")
    }

  def objectKeyFromVaultPath(vaultPath: VaultPath): Box[String] =
    objectKeyFromUPath(vaultPath.toUPath)

  def endpointFromUPath(s3UploadBaseDir: UPath): Box[URI] =
    for {
      uri <- s3UploadBaseDir.toRemoteUri
    } yield new URI(
      "https",
      null,
      uri.getHost,
      uri.getPort,
      null,
      null,
      null
    )

  def isNonAmazonHost(uri: URI): Boolean =
    styleOf(uri).contains(PathStyle) && !uri.getHost.endsWith(".amazonaws.com")

  private def checkSchemeIsS3(uri: URI): Box[Unit] =
    Box
      .fromBool(uri.getScheme == PathSchemes.schemeS3) ?~> Msg.UPath.schemaMismatch(uri.getScheme, PathSchemes.schemeS3)
}
