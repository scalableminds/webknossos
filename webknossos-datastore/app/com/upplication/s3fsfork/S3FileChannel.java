package com.upplication.s3fsfork;

import com.amazonaws.services.s3.model.ObjectMetadata;
import com.amazonaws.services.s3.model.S3Object;
import org.apache.tika.Tika;

import java.io.*;
import java.nio.ByteBuffer;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.channels.ReadableByteChannel;
import java.nio.channels.WritableByteChannel;
import java.nio.file.*;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

import static java.lang.String.format;

public class S3FileChannel extends FileChannel {

    private com.upplication.s3fsfork.S3Path path;
    private Set<? extends OpenOption> options;
    private FileChannel filechannel;
    private Path tempFile;

    public S3FileChannel(S3Path path, Set<? extends OpenOption> options) throws IOException {
        this.path = path;
        this.options = Collections.unmodifiableSet(new HashSet<>(options));
        String key = path.getKey();
        boolean exists = path.getFileSystem().provider().exists(path);

        if (exists && this.options.contains(StandardOpenOption.CREATE_NEW))
            throw new FileAlreadyExistsException(format("target already exists: %s", path));
        else if (!exists && !this.options.contains(StandardOpenOption.CREATE_NEW) &&
                !this.options.contains(StandardOpenOption.CREATE))
            throw new NoSuchFileException(format("target not exists: %s", path));

        tempFile = Files.createTempFile("temp-s3-", key.replaceAll("/", "_"));
        boolean removeTempFile = true;
        try {
            if (exists) {
                try (S3Object object = path.getFileSystem()
                        .getClient()
                        .getObject(path.getFileStore().getBucket().getName(), key)) {
                    Files.copy(object.getObjectContent(), tempFile, StandardCopyOption.REPLACE_EXISTING);
                }
            }

            Set<? extends OpenOption> fileChannelOptions = new HashSet<>(this.options);
            fileChannelOptions.remove(StandardOpenOption.CREATE_NEW);
            filechannel = FileChannel.open(tempFile, fileChannelOptions);
            removeTempFile = false;
        } finally {
            if (removeTempFile) {
                Files.deleteIfExists(tempFile);
            }
        }
    }

    @Override
    public int read(ByteBuffer dst) throws IOException {
        return filechannel.read(dst);
    }

    @Override
    public long read(ByteBuffer[] dsts, int offset, int length) throws IOException {
        return filechannel.read(dsts, offset, length);
    }

    @Override
    public int write(ByteBuffer src) throws IOException {
        return filechannel.write(src);
    }

    @Override
    public long write(ByteBuffer[] srcs, int offset, int length) throws IOException {
        return filechannel.write(srcs, offset, length);
    }

    @Override
    public long position() throws IOException {
        return filechannel.position();
    }

    @Override
    public FileChannel position(long newPosition) throws IOException {
        return filechannel.position(newPosition);
    }

    @Override
    public long size() throws IOException {
        return filechannel.size();
    }

    @Override
    public FileChannel truncate(long size) throws IOException {
        return filechannel.truncate(size);
    }

    @Override
    public void force(boolean metaData) throws IOException {
        filechannel.force(metaData);
    }

    @Override
    public long transferTo(long position, long count, WritableByteChannel target) throws IOException {
        return filechannel.transferTo(position, count, target);
    }

    @Override
    public long transferFrom(ReadableByteChannel src, long position, long count) throws IOException {
        return filechannel.transferFrom(src, position, count);
    }

    @Override
    public int read(ByteBuffer dst, long position) throws IOException {
        return filechannel.read(dst, position);
    }

    @Override
    public int write(ByteBuffer src, long position) throws IOException {
        return filechannel.write(src, position);
    }

    @Override
    public MappedByteBuffer map(MapMode mode, long position, long size) throws IOException {
        return filechannel.map(mode, position, size);
    }

    @Override
    public FileLock lock(long position, long size, boolean shared) throws IOException {
        return filechannel.lock(position, size, shared);
    }

    @Override
    public FileLock tryLock(long position, long size, boolean shared) throws IOException {
        return filechannel.tryLock(position, size, shared);
    }

    @Override
    protected void implCloseChannel() throws IOException {
        super.close();
        filechannel.close();
        if (!this.options.contains(StandardOpenOption.READ)) {
            sync();
        }
        Files.deleteIfExists(tempFile);
    }

    /**
     * try to sync the temp file with the remote s3 path.
     *
     * @throws IOException if the tempFile fails to open a newInputStream
     */
    protected void sync() throws IOException {
        try (InputStream stream = new BufferedInputStream(Files.newInputStream(tempFile))) {
            ObjectMetadata metadata = new ObjectMetadata();
            metadata.setContentLength(Files.size(tempFile));
            metadata.setContentType(new Tika().detect(stream, path.getFileName().toString()));

            String bucket = path.getFileStore().name();
            String key = path.getKey();
            path.getFileSystem().getClient().putObject(bucket, key, stream, metadata);
        }
    }
}
