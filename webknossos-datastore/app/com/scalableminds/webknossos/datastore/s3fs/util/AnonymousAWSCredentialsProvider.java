package com.scalableminds.webknossos.datastore.s3fs.util;

import com.amazonaws.auth.AWSCredentials;
import com.amazonaws.auth.AWSCredentialsProvider;
import com.amazonaws.auth.AnonymousAWSCredentials;

public class AnonymousAWSCredentialsProvider implements AWSCredentialsProvider {

  @Override
  public AWSCredentials getCredentials() {
    return new AnonymousAWSCredentials();
  }

  @Override
  public void refresh() {

  }
}
