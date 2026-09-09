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
          S3UriUtils.objectKeyFromUri(uri("s3://my-bucket/dataset/color/1/.zarray")).contains("dataset/color/1/.zarray")
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
        assert(S3UriUtils.objectKeyFromUri(virtualHosted).contains("dataset/color/1/.zarray"))
      }

      "read bucket and object key from a region-qualified host" in {
        val regional = uri("https://my-bucket.s3.us-west-2.amazonaws.com/dataset/color")
        assert(S3UriUtils.hostBucketFromUri(regional).contains("my-bucket"))
        assert(S3UriUtils.objectKeyFromUri(regional).contains("dataset/color"))
      }

      "read bucket and object key from the legacy dash form and from a dualstack host" in {
        val dashed = uri("https://my-bucket.s3-us-west-2.amazonaws.com/dataset/color")
        assert(S3UriUtils.hostBucketFromUri(dashed).contains("my-bucket"))
        assert(S3UriUtils.objectKeyFromUri(dashed).contains("dataset/color"))
        val dualstack = uri("https://my-bucket.s3.dualstack.us-west-2.amazonaws.com/dataset/color")
        assert(S3UriUtils.hostBucketFromUri(dualstack).contains("my-bucket"))
        assert(S3UriUtils.objectKeyFromUri(dualstack).contains("dataset/color"))
      }

      "read a bucket name containing dots" in {
        val dottedBucket = uri("https://my.bucket.name.s3.us-west-2.amazonaws.com/dataset/color")
        assert(S3UriUtils.hostBucketFromUri(dottedBucket).contains("my.bucket.name"))
        assert(S3UriUtils.objectKeyFromUri(dottedBucket).contains("dataset/color"))
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

      "read bucket and object key from localhost" in {
        val local = uri("s3://localhost:9000/my-bucket/dataset")
        assert(S3UriUtils.isNonAmazonHost(local))
        assert(S3UriUtils.hostBucketFromUri(local).contains("my-bucket"))
        assert(S3UriUtils.objectKeyFromUri(local).contains("dataset"))
      }

      "read a dot-free endpoint host that states a port as an endpoint" in {
        // Bucket names cannot contain a port, so a port disambiguates an endpoint from a bucket
        val kubernetesService = uri("s3://minio:9000/my-bucket/dataset/color")
        assert(S3UriUtils.isNonAmazonHost(kubernetesService))
        assert(S3UriUtils.hostBucketFromUri(kubernetesService).contains("my-bucket"))
        assert(S3UriUtils.objectKeyFromUri(kubernetesService).contains("dataset/color"))
      }
    }

    "the bucket name contains dots" should {

      "still classify a short style uri as path style" in {
        // A dotted bucket name is indistinguishable from an endpoint host, the endpoint reading wins here.
        // Such buckets can be addressed in virtual hosted style instead, see above.
        val dottedBucket = uri("s3://my.bucket.name/dataset/color")
        assert(S3UriUtils.hostBucketFromUri(dottedBucket).contains("dataset"))
        assert(S3UriUtils.objectKeyFromUri(dottedBucket).contains("color"))
      }
    }

    "the uri has no host at all" should {
      "yield no bucket and no object key" in {
        assert(S3UriUtils.hostBucketFromUri(uri("s3:///dataset/color")).isEmpty)
        assert(S3UriUtils.hostBucketFromUri(uri("/dataset/color")).isEmpty)
        assert(S3UriUtils.objectKeyFromUri(uri("s3:///dataset/color")).isEmpty)
      }
    }

    "the key has a trailing slash" should {
      "keep it, since it is significant as a listing prefix" in {
        assert(S3UriUtils.objectKeyFromUri(uri("s3://my-bucket/dataset/color/")).contains("dataset/color/"))
        assert(
          S3UriUtils
            .objectKeyFromUri(uri("https://s3.amazonaws.com/my-bucket/dataset/color/"))
            .contains("dataset/color/")
        )
        assert(
          S3UriUtils
            .objectKeyFromUri(uri("https://my-bucket.s3.amazonaws.com/dataset/color/"))
            .contains("dataset/color/")
        )
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
