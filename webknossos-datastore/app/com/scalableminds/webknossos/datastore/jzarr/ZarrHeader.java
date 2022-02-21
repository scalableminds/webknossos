/*
 *
 * MIT License
 *
 * Copyright (c) 2020. Brockmann Consult GmbH (info@brockmann-consult.de)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 */
package com.scalableminds.webknossos.datastore.jzarr;

import com.fasterxml.jackson.core.*;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializerProvider;
import com.fasterxml.jackson.databind.deser.std.StdDeserializer;
import com.fasterxml.jackson.databind.module.SimpleModule;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.ser.std.StdSerializer;

import java.io.IOException;
import java.nio.ByteOrder;
import java.util.HashMap;
import java.util.Map;
import java.util.stream.StreamSupport;

public class ZarrHeader {

    private final int[] chunks;
    private final Compressor compressor;
    private final String dimension_separator;
    private final String dtype;
    private final Number fill_value;
    private final String filters = null;
    private final String order = "C";
    private final int[] shape;
    private final int zarr_format = 2;

    public ZarrHeader(int[] shape, int[] chunks, String dtype, ByteOrder byteOrder, Number fill_value, Compressor compressor, String dimension_separator) {
        this.chunks = chunks;
        if (compressor == null || CompressorFactory.nullCompressor.equals(compressor)) {
            this.compressor = null;
        } else {
            this.compressor = compressor;
        }

        final int numBytes = Integer.parseInt(dtype.replaceAll("\\D", ""));

        if (numBytes > 1) {
            this.dtype = translateByteOrder(byteOrder) + dtype;
        } else {
            this.dtype = "|" + dtype;
        }
        this.fill_value = fill_value;
        this.shape = shape;
        this.dimension_separator = dimension_separator;
    }

    public int[] getChunks() {
        return chunks;
    }

    public Compressor getCompressor() {
        return compressor;
    }

    public String getDtype() {
        return dtype;
    }

    public DataType getRawDataType() {
        return getRawDataType(dtype);
    }

    private static DataType getRawDataType(String dtype) {
        dtype = dtype.replace(">", "");
        dtype = dtype.replace("<", "");
        dtype = dtype.replace("|", "");
        return DataType.valueOf(dtype);
    }

    public ByteOrder getByteOrder() {
        return getByteOrder(this.dtype);
    }

    private static ByteOrder getByteOrder(String dtype) {
        if (dtype.startsWith(">")) {
            return ByteOrder.BIG_ENDIAN;
        } else if (dtype.startsWith("<")) {
            return ByteOrder.LITTLE_ENDIAN;
        } else if (dtype.startsWith("|")) {
            return ByteOrder.nativeOrder();
        }
        return ByteOrder.BIG_ENDIAN;
    }

    private String translateByteOrder(ByteOrder order) {
        if (order == null) {
            order = ByteOrder.nativeOrder();
        }
        if (ByteOrder.BIG_ENDIAN.equals(order)) {
            return ">";
        }
        return "<";
    }

    public Number getFill_value() {
        return fill_value;
    }

    public int[] getShape() {
        return shape;
    }

    public String getDimension_separator() {
        return dimension_separator;
    }

    public DimensionSeparator getDimensionSeparator() {
        String separator = this.dimension_separator;
        for (DimensionSeparator sep : DimensionSeparator.values()) {
            if (sep.getSeparatorChar().equals(separator)) {
                return sep;
            }
        }
        return null;
    }

    static class ZarrHeaderSerializer extends StdSerializer<ZarrHeader> {

        protected ZarrHeaderSerializer() {
            super(ZarrHeader.class);
        }

        @Override
        public void serialize(ZarrHeader value, JsonGenerator gen, SerializerProvider provider) throws IOException {
            gen.writeStartObject();
            gen.writeObjectField("chunks", value.getChunks());
            gen.writeFieldName("compressor");
            gen.writeObject(value.getCompressor());
            gen.writeStringField("dtype", value.getDtype());
            gen.writeObjectField("fill_value", value.getFill_value());
            gen.writeObjectField("filters", value.filters);
            gen.writeObjectField("order", value.order);
            gen.writeObjectField("shape", value.getShape());
            gen.writeStringField("dimension_separator", value.getDimension_separator());
            gen.writeNumberField("zarr_format", value.zarr_format);
            gen.writeEndObject();
        }
    }

    static class ZarrHeaderDeSerializer extends StdDeserializer<ZarrHeader> {

        protected ZarrHeaderDeSerializer() {
            super(ZarrHeader.class);
        }

        @Override
        public ZarrHeader deserialize(JsonParser p, DeserializationContext ctxt) throws IOException {
            ObjectCodec codec = p.getCodec();
            TreeNode root = codec.readTree(p);
            int[] shape = StreamSupport.stream(((ArrayNode) root.path("shape")).spliterator(), false).mapToInt(JsonNode::asInt).toArray();
            int[] chunks = StreamSupport.stream(((ArrayNode) root.path("chunks")).spliterator(), false).mapToInt(JsonNode::asInt).toArray();
            String dtype = ((JsonNode) root.path("dtype")).asText();
            JsonNode fillValueNode = (JsonNode) root.path("fill_value");
            final Number fill;
            if (fillValueNode.isLong()) {
                fill = fillValueNode.longValue();
            } else if (fillValueNode.isFloat()) {
                fill = fillValueNode.floatValue();
            } else {
                fill = fillValueNode.asDouble();
            }

            Map<String, Object> compBean = codec.readValue(root.path("compressor").traverse(codec), HashMap.class);
            Compressor compressor;
            if (compBean == null) {
                compressor = CompressorFactory.nullCompressor;
            } else {
                compressor = CompressorFactory.create(compBean);
            }
            final JsonNode separatorNode = (JsonNode) root.path("dimension_separator");
            String dimension_separator = null;
            if (separatorNode != null) {
                dimension_separator = separatorNode.asText();
            }
            return new ZarrHeader(shape, chunks, getRawDataType(dtype).toString(), getByteOrder(dtype), fill, compressor, dimension_separator);
        }

    }

    static void register(ObjectMapper objectMapper) {
        SimpleModule simpleModule = new SimpleModule();
        simpleModule.addSerializer(ZarrHeader.class, new ZarrHeaderSerializer());
        simpleModule.addDeserializer(ZarrHeader.class, new ZarrHeaderDeSerializer());

        objectMapper.registerModules(simpleModule);
    }
}
