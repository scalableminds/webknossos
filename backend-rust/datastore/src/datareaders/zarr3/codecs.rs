//! zarrs plugins backed by the already oracle-verified pure Rust datastore compressors.
use crate::compression::{CompressionSetting, Compressor};
use crate::datareaders::CHUNK_SIZE_LIMIT_BYTES;
use serde_json::Value;
use std::{borrow::Cow, sync::Arc};
use zarrs::{
    array::codec::api::{
        BytesToBytesCodecTraits, Codec, CodecError, CodecMetadataOptions, CodecOptions,
        CodecPluginV3, CodecTraits, CodecTraitsV3, PartialDecoderCapability,
        PartialEncoderCapability, RecommendedConcurrency,
    },
    array::{ArrayBytesRaw, BytesRepresentation},
    metadata::{Configuration, v3::MetadataV3},
    plugin::{PluginCreateError, ZarrVersion},
};

#[derive(Debug)]
struct PureCodec {
    name: &'static str,
    compressor: Compressor,
    configuration: Configuration,
}
impl zarrs::plugin::ExtensionName for PureCodec {
    fn name(&self, version: ZarrVersion) -> Option<Cow<'static, str>> {
        (version == ZarrVersion::V3).then_some(Cow::Borrowed(self.name))
    }
}
impl CodecTraits for PureCodec {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
    fn configuration(&self, _: ZarrVersion, _: &CodecMetadataOptions) -> Option<Configuration> {
        Some(self.configuration.clone())
    }
    fn partial_decoder_capability(&self) -> PartialDecoderCapability {
        PartialDecoderCapability {
            partial_read: false,
            partial_decode: false,
        }
    }
    fn partial_encoder_capability(&self) -> PartialEncoderCapability {
        PartialEncoderCapability {
            partial_encode: false,
        }
    }
}
#[async_trait::async_trait]
impl BytesToBytesCodecTraits for PureCodec {
    fn into_dyn(self: Arc<Self>) -> Arc<dyn BytesToBytesCodecTraits> {
        self
    }
    fn recommended_concurrency(
        &self,
        _: &BytesRepresentation,
    ) -> Result<RecommendedConcurrency, CodecError> {
        Ok(RecommendedConcurrency::new_maximum(1))
    }
    fn encode<'a>(
        &self,
        bytes: ArrayBytesRaw<'a>,
        _: &CodecOptions,
    ) -> Result<ArrayBytesRaw<'a>, CodecError> {
        self.compressor
            .compress(&bytes)
            .map(Cow::Owned)
            .map_err(|e| CodecError::Other(e.to_string()))
    }
    fn decode<'a>(
        &self,
        bytes: ArrayBytesRaw<'a>,
        _: &BytesRepresentation,
        _: &CodecOptions,
    ) -> Result<ArrayBytesRaw<'a>, CodecError> {
        self.compressor
            .decompress(&bytes, Some(CHUNK_SIZE_LIMIT_BYTES as usize))
            .map(Cow::Owned)
            .map_err(|e| CodecError::Other(e.to_string()))
    }
    fn encoded_representation(&self, _: &BytesRepresentation) -> BytesRepresentation {
        BytesRepresentation::UnboundedSize
    }
}
fn create(name: &'static str, metadata: &MetadataV3) -> Result<Codec, PluginCreateError> {
    let conf: Value = metadata.to_typed_configuration()?;
    let integer = |key: &str, default: i32| -> Result<i32, PluginCreateError> {
        match conf.get(key) {
            None => Ok(default),
            Some(v) => v
                .as_i64()
                .and_then(|n| i32::try_from(n).ok())
                .ok_or_else(|| PluginCreateError::Other(format!("Invalid {name} {key}"))),
        }
    };
    let compressor = match name {
        "gzip" => Compressor::from_zarr3_gzip(integer("level", 5)?),
        "zstd" => {
            let checksum = match conf.get("checksum") {
                None => false,
                Some(v) => v
                    .as_bool()
                    .ok_or_else(|| PluginCreateError::Other("Invalid zstd checksum".into()))?,
            };
            Ok(Compressor::from_zarr3_zstd(integer("level", 0)?, checksum))
        }
        "blosc" => {
            let cname = conf
                .get("cname")
                .and_then(Value::as_str)
                .ok_or_else(|| PluginCreateError::Other("Missing blosc cname".into()))?;
            let shuffle = conf
                .get("shuffle")
                .and_then(CompressionSetting::from_json)
                .ok_or_else(|| PluginCreateError::Other("Missing blosc shuffle".into()))?;
            Compressor::from_zarr3_blosc(
                cname,
                integer("clevel", 5)?,
                &shuffle,
                Some(integer("typesize", 0)?),
                integer("blocksize", 0)?,
            )
        }
        _ => unreachable!(),
    }
    .map_err(|e| PluginCreateError::Other(e.to_string()))?;
    let configuration =
        serde_json::from_value(conf).map_err(|e| PluginCreateError::Other(e.to_string()))?;
    Ok(Codec::BytesToBytes(Arc::new(PureCodec {
        name,
        compressor,
        configuration,
    })))
}
macro_rules! register {
    ($marker:ident, $name:literal) => {
        struct $marker;
        zarrs::plugin::impl_extension_aliases!($marker, v3: $name);
        inventory::submit! { CodecPluginV3::new::<$marker>() }
        impl CodecTraitsV3 for $marker {
            fn create(metadata: &MetadataV3) -> Result<Codec, PluginCreateError> { create($name, metadata) }
        }
    }
}
register!(PureGzip, "gzip");
register!(PureZstd, "zstd");
register!(PureBlosc, "blosc");
