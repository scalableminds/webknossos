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
import software.amazon.awssdk.core.client.config.ClientOverrideConfiguration
import software.amazon.awssdk.retries.StandardRetryStrategy
import software.amazon.awssdk.http.Protocol
import software.amazon.awssdk.http.nio.netty.NettyNioAsyncHttpClient
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.s3.S3AsyncClient

import java.net.URI
import scala.concurrent.duration.DurationInt
import scala.concurrent.{ExecutionContext, Future}
import scala.jdk.DurationConverters.ScalaDurationOps
import scala.jdk.OptionConverters.RichOptional
import scala.util.{Failure as TryFailure, Success as TrySuccess}

class S3ClientPool(ws: WSClient) {

  // Key: access key id, secret key (hashed), custom endpoint
  private lazy val defaultPool: AlfuCache[(Option[String], Option[String], Option[String]), S3AsyncClient] =
    AlfuCache(
      timeToLive = 100 days,
      timeToIdle = 100 days,
      onRemovalFn = Some { (_, clientBox) =>
        clientBox.foreach(_.close())
      }
    )

  // Key: access key id, secret key (hashed), custom endpoint
  private lazy val uploadPool: AlfuCache[(Option[String], Option[String], Option[String]), S3AsyncClient] =
    AlfuCache(
      timeToLive = 100 days,
      timeToIdle = 100 days,
      onRemovalFn = Some { (_, clientBox) =>
        clientBox.foreach(_.close())
      }
    )

  def getS3Client(credentialOpt: Option[S3AccessKeyCredential], uri: URI, isForUpload: Boolean)(implicit
      ec: ExecutionContext
  ): Fox[S3AsyncClient] = {
    val credentialsProvider = getCredentialsProvider(credentialOpt)
    for {
      customEndpointOpt <- Fox.runIf(S3UriUtils.isNonAmazonHost(uri)) {
        determineProtocol(uri).map(p => new URI(s"$p://${uri.getAuthority}"))
      }
      pool = if (isForUpload) uploadPool else defaultPool
      client <- pool.getOrLoad(
        (
          credentialOpt.map(_.accessKeyId),
          credentialOpt.map(c => SCrypt.sha256Hex(c.secretAccessKey)),
          customEndpointOpt.map(_.toString)
        ),
        _ => Fox.successful(buildS3Client(credentialsProvider, customEndpointOpt, isForUpload))
      )
    } yield client
  }

  private def isHetznerEndpoint(customEndpointOpt: Option[URI]): Boolean =
    customEndpointOpt.exists(_.getHost.endsWith(".your-objectstorage.com"))

  private def buildS3Client(
      credentialsProvider: AwsCredentialsProvider,
      customEndpointOpt: Option[URI],
      isForUpload: Boolean
  ): S3AsyncClient = {
    // HTTP/2 multiplexes bucket fetches over fewer TCP connections, but AWS S3 does not support it.
    // Hetzner Object Storage (e.g. fsn1.your-objectstorage.com) does support HTTP/2.
    val protocol = if (isHetznerEndpoint(customEndpointOpt)) Protocol.HTTP2 else Protocol.HTTP1_1
    val builder =
      S3AsyncClient
        .builder()
        .credentialsProvider(credentialsProvider)
        .crossRegionAccessEnabled(true)
        // Disabling checksum calculation prevents files being stored with Content Encoding "aws-chunked".
        .requestChecksumCalculation(RequestChecksumCalculation.WHEN_REQUIRED)
        .httpClientBuilder(
          NettyNioAsyncHttpClient
            .builder()
            .protocol(protocol)
            .maxConcurrency(64)
            .tcpKeepAlive(true)
            .connectionAcquisitionTimeout((2 minutes).toJava)
        )
    val withRetryStrategy =
      if (isForUpload)
        builder.overrideConfiguration(
          ClientOverrideConfiguration
            .builder()
            .retryStrategy(StandardRetryStrategy.builder().maxAttempts(10).build())
            .build()
        )
      else builder
    customEndpointOpt match {
      case Some(customEndpoint) =>
        withRetryStrategy
          .forcePathStyle(true)
          .endpointOverride(customEndpoint)
          .region(
            AwsHostNameUtils.parseSigningRegion(customEndpoint.getAuthority, "s3").toScala.getOrElse(Region.US_EAST_1)
          )
          .build()
      case None => withRetryStrategy.region(Region.US_EAST_1).build()
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

    val protocolFuture = httpsFuture.transformWith {
      case TrySuccess(_) => Future.successful("https")
      case TryFailure(_) => Future.successful("http")
    }
    for {
      protocol <- Fox.fromFuture(protocolFuture)
    } yield protocol
  }

}
