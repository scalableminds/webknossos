package com.scalableminds.webknossos.datastore.s3fs;

import java.io.IOException;
import java.nio.file.FileStore;
import java.nio.file.attribute.FileAttributeView;
import java.nio.file.attribute.FileStoreAttributeView;

import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.model.Bucket;
import com.amazonaws.services.s3.model.Owner;

public class S3FileStore extends FileStore implements Comparable<S3FileStore> {

    private S3FileSystem fileSystem;
    private String name;

    public S3FileStore(S3FileSystem s3FileSystem, String name) {
        this.fileSystem = s3FileSystem;
        this.name = name;
    }

    @Override
    public String name() {
        return name;
    }

    @Override
    public String type() {
        return "S3Bucket";
    }

    @Override
    public boolean isReadOnly() {
        return false;
    }

    @Override
    public long getTotalSpace() throws IOException {
        return Long.MAX_VALUE;
    }

    @Override
    public long getUsableSpace() throws IOException {
        return Long.MAX_VALUE;
    }

    @Override
    public long getUnallocatedSpace() throws IOException {
        return Long.MAX_VALUE;
    }

    @Override
    public boolean supportsFileAttributeView(Class<? extends FileAttributeView> type) {
        return false;
    }

    @Override
    public boolean supportsFileAttributeView(String attributeViewName) {
        return false;
    }

    @SuppressWarnings("unchecked")
    @Override
    public <V extends FileStoreAttributeView> V getFileStoreAttributeView(Class<V> type) {
        if (type != S3FileStoreAttributeView.class)
            throw new IllegalArgumentException("FileStoreAttributeView of type '" + type.getName() + "' is not supported.");
        Bucket buck = getBucket();
        Owner owner = buck.getOwner();
        return (V) new S3FileStoreAttributeView(buck.getCreationDate(), buck.getName(), owner.getId(), owner.getDisplayName());
    }

    @Override
    public Object getAttribute(String attribute) throws IOException {
        return getFileStoreAttributeView(S3FileStoreAttributeView.class).getAttribute(attribute);
    }

    public S3FileSystem getFileSystem() {
        return fileSystem;
    }

    public Bucket getBucket() {
        return getBucket(name);
    }

    private Bucket getBucket(String bucketName) {
        for (Bucket buck : getClient().listBuckets())
            if (buck.getName().equals(bucketName))
                return buck;
        return null;
    }

    public S3Path getRootDirectory() {
        return new S3Path(fileSystem, "/" + this.name());
    }

    private AmazonS3 getClient() {
        return fileSystem.getClient();
    }

    public Owner getOwner() {
        Bucket buck = getBucket();
        if (buck != null)
            return buck.getOwner();
        return fileSystem.getClient().getS3AccountOwner();
    }

    @Override
    public int compareTo(S3FileStore o) {
        if (this == o)
            return 0;
        return o.name().compareTo(name);
    }

    @Override
    public int hashCode() {
        final int prime = 31;
        int result = 1;
        result = prime * result + ((fileSystem == null) ? 0 : fileSystem.hashCode());
        result = prime * result + ((name == null) ? 0 : name.hashCode());
        return result;
    }


    @Override
    public boolean equals(Object obj) {
        if (this == obj)
            return true;
        if (obj == null)
            return false;
        if (!(obj instanceof S3FileStore))
            return false;
        S3FileStore other = (S3FileStore) obj;

        if (fileSystem == null) {
            if (other.fileSystem != null)
                return false;
        } else if (!fileSystem.equals(other.fileSystem))
            return false;
        if (name == null) {
            if (other.name != null)
                return false;
        } else if (!name.equals(other.name))
            return false;
        return true;
    }
}
