package backend

import com.scalableminds.webknossos.datastore.helpers.{S3UriUtils, UPath}
import org.scalatest.wordspec.AsyncWordSpec

import java.net.URI

class S3UriUtilsTestSuite extends AsyncWordSpec {

  private def uri(literal: String): URI = new URI(literal)

  "S3 uri utils" when {

    "the uri is in short style" should {

      "read bucket and object key" in {
        assert(S3UriUtils.hostBucketFromUri(uri("s3://my-bucket/dataset/color/1/.zarray")).contains("my-bucket"))
        assert(
          S3UriUtils
            .objectKeyFromUri(uri("s3://my-bucket/dataset/color/1/.zarray"))
            .contains("dataset/color/1/.zarray")
        )
      }

      "read a key with a single segment" in {
        assert(S3UriUtils.hostBucketFromUri(uri("s3://my-bucket/key")).contains("my-bucket"))
        assert(S3UriUtils.objectKeyFromUri(uri("s3://my-bucket/key")).contains("key"))
      }
    }

    "the uri is in virtual hosted style" should {

      "read bucket and object key" in {
        val virtualHosted = uri("https://my-bucket.s3.amazonaws.com/dataset/color/1/.zarray")
        assert(S3UriUtils.hostBucketFromUri(virtualHosted).contains("my-bucket"))
        // Note: unlike the other two styles, the object key keeps its leading slash here
        assert(S3UriUtils.objectKeyFromUri(virtualHosted).contains("/dataset/color/1/.zarray"))
      }

      "not read a bucket from a region-qualified virtual hosted uri" in {
        // Pinning current behavior: only the region-less ".s3.amazonaws.com" suffix is recognised as
        // virtual hosted style, so "bucket.s3.<region>.amazonaws.com" matches no style at all.
        val regional = uri("https://my-bucket.s3.us-west-2.amazonaws.com/dataset/color")
        assert(S3UriUtils.hostBucketFromUri(regional).isEmpty)
        assert(S3UriUtils.objectKeyFromUri(regional).isEmpty)
      }
    }

    "the uri is in path style" should {

      "read bucket and object key from a region-qualified host" in {
        val pathStyle = uri("https://s3.us-west-2.amazonaws.com/my-bucket/dataset/color/1/.zarray")
        assert(S3UriUtils.hostBucketFromUri(pathStyle).contains("my-bucket"))
        assert(S3UriUtils.objectKeyFromUri(pathStyle).contains("dataset/color/1/.zarray"))
      }

      "read bucket and object key from a region-less host" in {
        val pathStyle = uri("https://s3.amazonaws.com/my-bucket/dataset/color")
        assert(S3UriUtils.hostBucketFromUri(pathStyle).contains("my-bucket"))
        assert(S3UriUtils.objectKeyFromUri(pathStyle).contains("dataset/color"))
      }

      "read an empty object key when only a bucket is stated" in {
        val bucketOnly = uri("https://s3.amazonaws.com/my-bucket")
        assert(S3UriUtils.hostBucketFromUri(bucketOnly).contains("my-bucket"))
        assert(S3UriUtils.objectKeyFromUri(bucketOnly).contains(""))
      }
    }

    "the uri points at a non-amazon endpoint" should {

      "read bucket and object key in path style" in {
        val minio = uri("https://minio.example.com/my-bucket/dataset/color/1/.zarray")
        assert(S3UriUtils.hostBucketFromUri(minio).contains("my-bucket"))
        assert(S3UriUtils.objectKeyFromUri(minio).contains("dataset/color/1/.zarray"))
        assert(S3UriUtils.isNonAmazonHost(minio))
      }

      "recognise an amazon host as an amazon host" in {
        assert(!S3UriUtils.isNonAmazonHost(uri("https://s3.us-west-2.amazonaws.com/my-bucket/key")))
        assert(!S3UriUtils.isNonAmazonHost(uri("https://my-bucket.s3.amazonaws.com/key")))
        // Short style is not path style, so it is not classified as a non-amazon host either
        assert(!S3UriUtils.isNonAmazonHost(uri("s3://my-bucket/key")))
      }

      "recognise localhost as a non-amazon host" in {
        val local = uri("http://localhost:9000/my-bucket/dataset")
        assert(S3UriUtils.isNonAmazonHost(local))
        // Pinning current behavior: a dot-free host is treated as short style, so the host itself
        // becomes the bucket and the whole path becomes the object key.
        assert(S3UriUtils.hostBucketFromUri(local).contains("localhost"))
        assert(S3UriUtils.objectKeyFromUri(local).contains("my-bucket/dataset"))
      }
    }

    "the bucket name contains dots" should {

      "classify a short style uri as path style" in {
        // Pinning current behavior: isShortStyle only matches dot-free hosts, so a dotted bucket in
        // short form falls through to the path style branch and the first path segment becomes the bucket.
        val dottedBucket = uri("s3://my.bucket.name/dataset/color")
        assert(S3UriUtils.hostBucketFromUri(dottedBucket).contains("dataset"))
        assert(S3UriUtils.objectKeyFromUri(dottedBucket).contains("color"))
      }
    }

    "the uri has no host at all" should {
      "yield no bucket" in {
        assert(S3UriUtils.hostBucketFromUri(uri("s3:///dataset/color")).isEmpty)
        assert(S3UriUtils.hostBucketFromUri(uri("/dataset/color")).isEmpty)
      }
    }

    "reading from a UPath" should {

      "read bucket and object key for an s3 upath" in {
        val upath = UPath.fromStringUnsafe("s3://my-bucket/dataset/color")
        assert(S3UriUtils.hostBucketFromUPath(upath).contains("my-bucket"))
        assert(S3UriUtils.objectKeyFromUPath(upath).contains("dataset/color"))
      }

      "reject a upath whose scheme is not s3" in {
        val httpsUPath = UPath.fromStringUnsafe("https://my-bucket.s3.amazonaws.com/dataset/color")
        assert(S3UriUtils.hostBucketFromUPath(httpsUPath).isEmpty)
        assert(S3UriUtils.objectKeyFromUPath(httpsUPath).isEmpty)
        val gsUPath = UPath.fromStringUnsafe("gs://my-bucket/dataset/color")
        assert(S3UriUtils.hostBucketFromUPath(gsUPath).isEmpty)
        assert(S3UriUtils.objectKeyFromUPath(gsUPath).isEmpty)
      }

      "reject a local upath" in {
        val localUPath = UPath.fromStringUnsafe("/binaryData/organization/dataset")
        assert(S3UriUtils.hostBucketFromUPath(localUPath).isEmpty)
        assert(S3UriUtils.objectKeyFromUPath(localUPath).isEmpty)
      }
    }

    "building an endpoint from a UPath" should {

      "force https and drop the path" in {
        val endpoint =
          S3UriUtils.endpointFromUPath(UPath.fromStringUnsafe("s3://s3.us-west-2.amazonaws.com/my-bucket/prefix"))
        assert(endpoint.map(_.toString).contains("https://s3.us-west-2.amazonaws.com"))
      }

      "preserve the port" in {
        val endpoint = S3UriUtils.endpointFromUPath(UPath.fromStringUnsafe("s3://localhost:9000/my-bucket/prefix"))
        assert(endpoint.map(_.toString).contains("https://localhost:9000"))
      }

      "keep https for a https upath" in {
        val endpoint =
          S3UriUtils.endpointFromUPath(UPath.fromStringUnsafe("https://minio.example.com:9000/my-bucket"))
        assert(endpoint.map(_.toString).contains("https://minio.example.com:9000"))
      }

      "reject a local upath" in
        assert(S3UriUtils.endpointFromUPath(UPath.fromStringUnsafe("/binaryData/organization")).isEmpty)
    }
  }

}
