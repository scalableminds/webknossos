package com.scalableminds.webknossos.datastore.s3fs;

import com.amazonaws.ClientConfiguration;
import com.amazonaws.Protocol;
import com.amazonaws.auth.AWSCredentialsProvider;
import com.amazonaws.auth.AWSStaticCredentialsProvider;
import com.amazonaws.auth.BasicAWSCredentials;
import com.amazonaws.client.builder.AwsClientBuilder;
import com.amazonaws.regions.Regions;
import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.AmazonS3Client;
import com.amazonaws.services.s3.AmazonS3ClientBuilder;
import com.amazonaws.services.s3.S3ClientOptions;
import com.scalableminds.webknossos.datastore.s3fs.util.AnonymousAWSCredentialsProvider;

import java.net.URI;
import java.util.Properties;


/**
 * Factory base class to create a new AmazonS3 instance.
 */
public class AmazonS3Factory {

    public static final String ACCESS_KEY = "s3fs_access_key";
    public static final String SECRET_KEY = "s3fs_secret_key";
    public static final String REQUEST_METRIC_COLLECTOR_CLASS = "s3fs_request_metric_collector_class";
    public static final String CONNECTION_TIMEOUT = "s3fs_connection_timeout";
    public static final String MAX_CONNECTIONS = "s3fs_max_connections";
    public static final String MAX_ERROR_RETRY = "s3fs_max_retry_error";
    public static final String PROTOCOL = "s3fs_protocol";
    public static final String PROXY_DOMAIN = "s3fs_proxy_domain";
    public static final String PROXY_HOST = "s3fs_proxy_host";
    public static final String PROXY_PASSWORD = "s3fs_proxy_password";
    public static final String PROXY_PORT = "s3fs_proxy_port";
    public static final String PROXY_USERNAME = "s3fs_proxy_username";
    public static final String PROXY_WORKSTATION = "s3fs_proxy_workstation";
    public static final String SOCKET_SEND_BUFFER_SIZE_HINT = "s3fs_socket_send_buffer_size_hint";
    public static final String SOCKET_RECEIVE_BUFFER_SIZE_HINT = "s3fs_socket_receive_buffer_size_hint";
    public static final String SOCKET_TIMEOUT = "s3fs_socket_timeout";
    public static final String USER_AGENT = "s3fs_user_agent";
    public static final String SIGNER_OVERRIDE = "s3fs_signer_override";
    public static final String PATH_STYLE_ACCESS = "s3fs_path_style_access";

    /**
     * Build a new Amazon S3 instance with the URI and the properties provided
     * @param uri URI mandatory
     * @param props Properties with the credentials and others options
     * @return AmazonS3
     */
    public AmazonS3 getAmazonS3Client(URI uri, Properties props) {
        return AmazonS3ClientBuilder
            .standard()
            .withCredentials(getCredentialsProvider(props))
            .withClientConfiguration(getClientConfiguration(props))
            .withEndpointConfiguration(getEndpointConfiguration(uri))
            .build();
    }

    protected AwsClientBuilder.EndpointConfiguration getEndpointConfiguration(URI uri) {
        String endpoint = uri.getHost();
        if (uri.getPort() != -1)
            endpoint = uri.getHost() + ':' + uri.getPort();
        return new AwsClientBuilder.EndpointConfiguration(endpoint, Regions.DEFAULT_REGION.toString());
    }

    protected AWSCredentialsProvider getCredentialsProvider(Properties props) {
        if (props.getProperty(ACCESS_KEY) == null && props.getProperty(SECRET_KEY) == null) {
            return new AnonymousAWSCredentialsProvider();
        }
        return new AWSStaticCredentialsProvider(getAWSCredentials(props));
    }

    protected S3ClientOptions getClientOptions(Properties props) {
        S3ClientOptions.Builder builder = S3ClientOptions.builder();
        if (props.getProperty(PATH_STYLE_ACCESS) != null &&
                Boolean.parseBoolean(props.getProperty(PATH_STYLE_ACCESS)))
            builder.setPathStyleAccess(true);

        return builder.build();
    }

    protected ClientConfiguration getClientConfiguration(Properties props) {
        ClientConfiguration clientConfiguration = new ClientConfiguration();
        if (props.getProperty(CONNECTION_TIMEOUT) != null)
            clientConfiguration.setConnectionTimeout(Integer.parseInt(props.getProperty(CONNECTION_TIMEOUT)));
        if (props.getProperty(MAX_CONNECTIONS) != null)
            clientConfiguration.setMaxConnections(Integer.parseInt(props.getProperty(MAX_CONNECTIONS)));
        if (props.getProperty(MAX_ERROR_RETRY) != null)
            clientConfiguration.setMaxErrorRetry(Integer.parseInt(props.getProperty(MAX_ERROR_RETRY)));
        if (props.getProperty(PROTOCOL) != null)
            clientConfiguration.setProtocol(Protocol.valueOf(props.getProperty(PROTOCOL)));
        if (props.getProperty(PROXY_DOMAIN) != null)
            clientConfiguration.setProxyDomain(props.getProperty(PROXY_DOMAIN));
        if (props.getProperty(PROXY_HOST) != null)
            clientConfiguration.setProxyHost(props.getProperty(PROXY_HOST));
        if (props.getProperty(PROXY_PASSWORD) != null)
            clientConfiguration.setProxyPassword(props.getProperty(PROXY_PASSWORD));
        if (props.getProperty(PROXY_PORT) != null)
            clientConfiguration.setProxyPort(Integer.parseInt(props.getProperty(PROXY_PORT)));
        if (props.getProperty(PROXY_USERNAME) != null)
            clientConfiguration.setProxyUsername(props.getProperty(PROXY_USERNAME));
        if (props.getProperty(PROXY_WORKSTATION) != null)
            clientConfiguration.setProxyWorkstation(props.getProperty(PROXY_WORKSTATION));
        int socketSendBufferSizeHint = 0;
        if (props.getProperty(SOCKET_SEND_BUFFER_SIZE_HINT) != null)
            socketSendBufferSizeHint = Integer.parseInt(props.getProperty(SOCKET_SEND_BUFFER_SIZE_HINT));
        int socketReceiveBufferSizeHint = 0;
        if (props.getProperty(SOCKET_RECEIVE_BUFFER_SIZE_HINT) != null)
            socketReceiveBufferSizeHint = Integer.parseInt(props.getProperty(SOCKET_RECEIVE_BUFFER_SIZE_HINT));
        clientConfiguration.setSocketBufferSizeHints(socketSendBufferSizeHint, socketReceiveBufferSizeHint);
        if (props.getProperty(SOCKET_TIMEOUT) != null)
            clientConfiguration.setSocketTimeout(Integer.parseInt(props.getProperty(SOCKET_TIMEOUT)));
        if (props.getProperty(USER_AGENT) != null)
            clientConfiguration.setUserAgentPrefix(props.getProperty(USER_AGENT));
        if (props.getProperty(SIGNER_OVERRIDE) != null)
            clientConfiguration.setSignerOverride(props.getProperty(SIGNER_OVERRIDE));
        return clientConfiguration;
    }

    protected BasicAWSCredentials getAWSCredentials(Properties props) {
        return new BasicAWSCredentials(props.getProperty(ACCESS_KEY), props.getProperty(SECRET_KEY));
    }
}
