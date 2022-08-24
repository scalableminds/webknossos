package com.upplication.s3fsfork;

import com.amazonaws.ClientConfiguration;
import com.amazonaws.auth.AWSCredentialsProvider;
import com.amazonaws.metrics.RequestMetricCollector;
import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.AmazonS3Client;

public class AmazonS3ClientFactory extends AmazonS3Factory {

    @Override
    protected AmazonS3 createAmazonS3(AWSCredentialsProvider credentialsProvider, ClientConfiguration clientConfiguration, RequestMetricCollector requestMetricsCollector) {
        return new AmazonS3Client(credentialsProvider, clientConfiguration, requestMetricsCollector);
        /*
                return AmazonS3ClientBuilder
          .standard()
          .withCredentials(credentialsProvider)
          .withClientConfiguration(clientConfiguration)
          .withRegion(Regions.EU_WEST_1)
          .withMetricsCollector(requestMetricsCollector)
          .build();
         */
    }
}
