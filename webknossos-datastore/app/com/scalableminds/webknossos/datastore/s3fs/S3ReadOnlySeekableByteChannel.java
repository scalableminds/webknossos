package com.scalableminds.webknossos.datastore.s3fs;

import com.amazonaws.services.s3.model.GetObjectRequest;
import com.amazonaws.services.s3.model.S3Object;
import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.channels.Channels;
import java.nio.channels.NonWritableChannelException;
import java.nio.channels.ReadableByteChannel;
import java.nio.channels.SeekableByteChannel;
import java.nio.file.OpenOption;
import java.nio.file.ReadOnlyFileSystemException;
import java.nio.file.StandardOpenOption;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

import static java.lang.String.format;

public class S3ReadOnlySeekableByteChannel implements SeekableByteChannel {

    private static final int DEFAULT_BUFFER_SIZE = 64000;

    private S3Path path;
    private Set<? extends OpenOption> options;
    private long length;
    private ExtBufferedInputStream bufferedStream;
    private ReadableByteChannel rbc;
    private long position = 0;

    /**
     * Open or creates a file, returning a seekable byte channel
     *
     * @param path    the path open or create
     * @param options options specifying how the file is opened
     * @throws IOException if an I/O error occurs
     */
    public S3ReadOnlySeekableByteChannel(S3Path path, Set<? extends OpenOption> options) throws IOException {
        this.path = path;
        this.options = Collections.unmodifiableSet(new HashSet<>(options));

        String key = path.getKey();
        //boolean exists = path.getFileSystem().provider().exists(path);

        //if (!exists) {
        //    throw new NoSuchFileException(format("target not exists: %s", path));
        //} else if (
        if (
            this.options.contains(StandardOpenOption.WRITE) ||
            this.options.contains(StandardOpenOption.CREATE) ||
            this.options.contains(StandardOpenOption.CREATE_NEW) ||
            this.options.contains(StandardOpenOption.APPEND)
        ) {
            throw new ReadOnlyFileSystemException();
        }


        System.out.println("Determining length...");
        this.length = 10 ;
/*            path
                .getFileSystem()
                .getClient()
                .getObjectMetadata(
                    path
                        .getFileStore()
                        .name(),
                    key
                )
                .getContentLength();*/

        System.out.println("Opening Stream...");
        openStreamAt(0);
    }

    private void openStreamAt(long position) throws IOException {
        if (rbc != null) {
            rbc.close();
        }

        GetObjectRequest rangeObjectRequest =
            new GetObjectRequest(
                path.getFileStore().name(),
                path.getKey()
            )
            .withRange(position);


        System.out.println("Get object...");
        S3Object s3Object =
            path
                .getFileSystem()
                .getClient()
                .getObject(rangeObjectRequest);


        System.out.println("Get object content...");
        bufferedStream =
            new ExtBufferedInputStream(
                s3Object.getObjectContent(),
                DEFAULT_BUFFER_SIZE
            );


        System.out.println("Wrap in stream...");
        rbc = Channels.newChannel(bufferedStream);
        this.position = position;
    }

    public boolean isOpen() {
        return rbc.isOpen();
    }

    public long position() { return position; }

    public SeekableByteChannel position(long targetPosition)
        throws IOException
    {
        long offset = targetPosition - position();
        if (offset > 0 && offset < bufferedStream.getBytesInBufferAvailable()) {
            long skipped = bufferedStream.skip(offset);
            if (skipped != offset) {
                // shouldn't happen since we are within the buffer
                throw new IOException("Could not seek to " + targetPosition);
            }
            position += offset;
        } else if (offset != 0) {
            openStreamAt(targetPosition);
        }
        return this;
    }

    public int read(ByteBuffer dst) throws IOException {
        int n = rbc.read(dst);
        if (n > 0) {
            position += n;
        }
        return n;
    }

    public SeekableByteChannel truncate(long size) {
        throw new NonWritableChannelException();
    }

    public int write (ByteBuffer src) {
        throw new NonWritableChannelException();
    }

    public long size() {
        return length;
    }

    public void close() throws IOException {
        rbc.close();
    }

    private class ExtBufferedInputStream extends BufferedInputStream {
        private ExtBufferedInputStream(final InputStream inputStream, final int size) {
            super(inputStream, size);
        }

        /** Returns the number of bytes that can be read from the buffer without reading more into the buffer. */
        int getBytesInBufferAvailable() {
            if (this.count == this.pos) return 0;
            else return this.buf.length - this.pos;
        }
    }
}
