package com.scalableminds.webknossos.datastore.s3fs;

import java.io.IOException;
import java.nio.file.FileStore;
import java.nio.file.FileSystem;
import java.nio.file.Path;
import java.nio.file.PathMatcher;
import java.nio.file.WatchService;
import java.nio.file.attribute.UserPrincipalLookupService;
import java.util.Set;

import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.model.Bucket;
import com.google.common.collect.ImmutableList;
import com.google.common.collect.ImmutableSet;

/**
 * S3FileSystem with a concrete client configured and ready to use.
 *
 * @see AmazonS3 configured by {@link AmazonS3Factory}
 */
public class S3FileSystem extends FileSystem implements Comparable<S3FileSystem> {

    private final S3FileSystemProvider provider;
    private final String key;
    private final AmazonS3 client;
    private int cache;
    private final String bucket;

    public S3FileSystem(S3FileSystemProvider provider, String key, AmazonS3 client, String bucket) {
        this.provider = provider;
        this.key = key;
        this.client = client;
        this.cache = 60000; // 1 minute cache for the s3Path
        this.bucket = bucket;
    }

    @Override
    public S3FileSystemProvider provider() {
        return provider;
    }

    public String getKey() {
        return key;
    }

    public String getBucket() {
        return bucket;
    }

    public Boolean hasBucket() {
        return bucket != null;
    }

    @Override
    public void close() throws IOException {
        this.provider.close(this);
    }

    @Override
    public boolean isOpen() {
        return this.provider.isOpen(this);
    }

    @Override
    public boolean isReadOnly() {
        return false;
    }

    @Override
    public String getSeparator() {
        return S3Path.PATH_SEPARATOR;
    }

    @Override
    public Iterable<Path> getRootDirectories() {
        ImmutableList.Builder<Path> builder = ImmutableList.builder();
        for (FileStore fileStore : getFileStores()) {
            builder.add(((S3FileStore) fileStore).getRootDirectory());
        }
        return builder.build();
    }

    @Override
    public Iterable<FileStore> getFileStores() {
        ImmutableList.Builder<FileStore> builder = ImmutableList.builder();
        for (Bucket bucket : client.listBuckets()) {
            builder.add(new S3FileStore(this, bucket.getName()));
        }
        return builder.build();
    }

    @Override
    public Set<String> supportedFileAttributeViews() {
        return ImmutableSet.of("basic", "posix");
    }

    @Override
    public S3Path getPath(String first, String... more) {

        if (hasBucket() && first.startsWith("/")) {
          first = "/" + this.bucket + first;
        }
        if (more.length == 0) {
            return new S3Path(this, first);
        }

        return new S3Path(this, first, more);
    }

    @Override
    public PathMatcher getPathMatcher(String syntaxAndPattern) {
        throw new UnsupportedOperationException();
    }

    @Override
    public UserPrincipalLookupService getUserPrincipalLookupService() {
        throw new UnsupportedOperationException();
    }

    @Override
    public WatchService newWatchService() throws IOException {
        throw new UnsupportedOperationException();
    }

    public AmazonS3 getClient() {
        return client;
    }

    public String[] key2Parts(String keyParts) {
        String[] parts = keyParts.split(S3Path.PATH_SEPARATOR);
        String[] split = new String[parts.length];
        int i = 0;
        for (String part : parts) {
            split[i++] = part;
        }
        return split;
    }

    @Override
    public int hashCode() {
        final int prime = 31;
        int result = 1;
        result = prime * result;
        result = prime * result + ((key == null) ? 0 : key.hashCode());
        return result;
    }

    @Override
    public boolean equals(Object obj) {
        if (this == obj)
            return true;
        if (obj == null)
            return false;
        if (!(obj instanceof S3FileSystem))
            return false;
        S3FileSystem other = (S3FileSystem) obj;
        if (key == null) {
            if (other.key != null)
                return false;
        } else if (!key.equals(other.key))
            return false;
        return true;
    }

    @Override
    public int compareTo(S3FileSystem o) {
        return key.compareTo(o.getKey());
    }

    public int getCache() {
        return cache;
    }
}
