package com.scalableminds.webknossos.datastore.storage

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.security.SCrypt
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.helpers.S3UriUtils
import play.api.libs.ws.WSClient
import software.amazon.awssdk.auth.credentials.{
  AnonymousCredentialsProvider,
  AwsCredentialsProvider,
  EnvironmentVariableCredentialsProvider
}
import software.amazon.awssdk.awscore.util.AwsHostNameUtils
import software.amazon.awssdk.core.checksums.RequestChecksumCalculation
import software.amazon.awssdk.http.nio.netty.NettyNioAsyncHttpClient
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.s3.S3AsyncClient

import scala.util.{Failure => TryFailure, Success => TrySuccess}
import java.net.URI
import scala.concurrent.{ExecutionContext, Future}
import scala.concurrent.duration.DurationInt
import scala.jdk.DurationConverters.ScalaDurationOps
import scala.jdk.OptionConverters.RichOptional

class S3ClientPool(ws: WSClient) {

  // Key: access key id, secret key (hashed), custom endpoint
  private lazy val defaultPool: AlfuCache[(Option[String], Option[String], Option[String]), S3AsyncClient] =
    AlfuCache(timeToLive = 100 days, timeToIdle = 100 days)

  // Key: access key id, secret key (hashed), custom endpoint
  private lazy val uploadPool: AlfuCache[(Option[String], Option[String], Option[String]), S3AsyncClient] =
    AlfuCache(timeToLive = 100 days, timeToIdle = 100 days)

  def getS3Client(credentialOpt: Option[S3AccessKeyCredential], uri: URI, isForUpload: Boolean)(
      implicit ec: ExecutionContext): Fox[S3AsyncClient] = {
    val credentialsProvider = getCredentialsProvider(credentialOpt)
    for {
      customEndpointOpt <- Fox.runIf(S3UriUtils.isNonAmazonHost(uri)) {
        determineProtocol(uri).map(p => new URI(s"$p://${uri.getAuthority}"))
      }
      pool = if (isForUpload) uploadPool else defaultPool
      client <- pool.getOrLoad(
        (credentialOpt.map(_.accessKeyId),
         credentialOpt.map(c => SCrypt.sha256Hex(c.secretAccessKey)),
         customEndpointOpt.map(_.toString)),
        _ => {
          Fox.successful(buildS3Client(credentialsProvider, customEndpointOpt))
        }
      )
    } yield client
  }

  private def buildS3Client(credentialsProvider: AwsCredentialsProvider,
                            customEndpointOpt: Option[URI]): S3AsyncClient = {
    val basic =
      S3AsyncClient
        .builder()
        .credentialsProvider(credentialsProvider)
        .crossRegionAccessEnabled(true)
        // Disabling checksum calculation prevents files being stored with Content Encoding "aws-chunked".
        .requestChecksumCalculation(RequestChecksumCalculation.WHEN_REQUIRED)
        .httpClientBuilder(NettyNioAsyncHttpClient.builder().connectionAcquisitionTimeout((2 minutes).toJava))
    customEndpointOpt match {
      case Some(customEndpoint) =>
        basic
          .forcePathStyle(true)
          .endpointOverride(customEndpoint)
          .region(
            AwsHostNameUtils.parseSigningRegion(customEndpoint.getAuthority, "s3").toScala.getOrElse(Region.US_EAST_1))
          .build()
      case None => basic.region(Region.US_EAST_1).build()
    }
  }

  private def getCredentialsProvider(credentialOpt: Option[S3AccessKeyCredential]): AwsCredentialsProvider =
    credentialOpt match {
      case Some(s3AccessKeyCredential: S3AccessKeyCredential) => s3AccessKeyCredential.toCredentialsProvider
      case None if sys.env.contains("AWS_ACCESS_KEY_ID") || sys.env.contains("AWS_ACCESS_KEY") =>
        EnvironmentVariableCredentialsProvider.create()
      case None =>
        AnonymousCredentialsProvider.create()
    }

  private def determineProtocol(uri: URI)(implicit ec: ExecutionContext): Fox[String] = {
    // If the endpoint supports HTTPS, use it. Otherwise, use HTTP.
    val httpsUri = new URI("https", uri.getAuthority, "", "", "")
    val httpsFuture = ws.url(httpsUri.toString).get()

    val protocolFuture = httpsFuture.transformWith({
      case TrySuccess(_) => Future.successful("https")
      case TryFailure(_) => Future.successful("http")
    })
    for {
      protocol <- Fox.fromFuture(protocolFuture)
    } yield protocol
  }

}
