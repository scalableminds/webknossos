"""Mesh-file golden inputs: h5py3.15.1/numpy2.3.4 (runtime has neither dependency)."""
from pathlib import Path
import struct,json,gzip,shutil
import numpy as np
import h5py
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'backend-rust/datastore/tests/fixtures/meshes'
OUT.mkdir(parents=True,exist_ok=True)
def manifest(sizes=(4,2,3)):
    b=struct.pack('<6fI',32.125,64.5,8.75,1.125,2.25,3.5,2)
    b+=struct.pack('<2f',1.,2.25)
    b+=struct.pack('<6f',.1,.2,.3,4.5,5.5,6.5)
    b+=struct.pack('<2I',2,1)
    b+=struct.pack('<6i',0,1,2,3,4,5)+struct.pack('<2I',*sizes[:2])
    b+=struct.pack('<3i',6,7,8)+struct.pack('<I',sizes[2])
    return b
data=manifest();(OUT/'manifest.bin').write_bytes(data)
transform=[[2.,.5,1.,10.],[.25,3.,.75,20.],[1.,.5,4.,30.]]
attrs=dict(mesh_format='draco',lod_scale_multiplier=.75,transform=transform,hash_function='identity',n_buckets=2)
ids=[2,4,2**64-1]
payload=bytearray();rows=[]
for id,chunk in zip(ids,[b'ABCDEFGHI',b'abcdefghi',b'123456789']):
    payload+=chunk;start=len(payload);payload+=data;rows.append([id,start,len(payload)])
arrays={'bucket_offsets':np.array([0,2,3],dtype='<u8'),'buckets':np.array(rows,dtype='<u8'),'neuroglancer':np.frombuffer(payload,dtype='u1')}
for name,encoding in [('local','draco'),('gzip','draco+gzip')]:
    with h5py.File(OUT/f'{name}.hdf5','w',libver='earliest') as f:
        for key,value in dict(attrs,mesh_format=encoding,artifact_schema_version=7).items():
            if name=='local' and key in ['n_buckets','artifact_schema_version']:value=np.uint32(value)
            if name=='local' and key in ['transform','lod_scale_multiplier']:value=np.array(value,dtype=np.float32)
            f.attrs[key]=value
        local_arrays=arrays
        if name=='gzip':
            compressed=bytearray();compressed_rows=[]
            for id,chunk in zip(ids,[b'ABCDEFGHI',b'abcdefghi',b'123456789']):
                parts=[gzip.compress(chunk[:4],mtime=0),gzip.compress(chunk[4:6],mtime=0),gzip.compress(chunk[6:],mtime=0)]
                compressed+=b''.join(parts);start=len(compressed);compressed+=manifest(tuple(map(len,parts)));compressed_rows.append([id,start,len(compressed)])
            local_arrays=dict(arrays,buckets=np.array(compressed_rows,dtype='<u8'),neuroglancer=np.frombuffer(compressed,dtype='u1'))
        for key,value in local_arrays.items():f.create_dataset(key,data=value)
zarr=OUT/'zarr3';zarr.mkdir(exist_ok=True)
(zarr/'zarr.json').write_text(json.dumps(dict(zarr_format=3,node_type='group',attributes=dict(voxelytics=dict(artifact_schema_version=7,artifact_attributes=attrs)))))
for key,value in arrays.items():
    directory=zarr/key;directory.mkdir(exist_ok=True)
    dtype='uint8' if key=='neuroglancer' else 'uint64'
    header=dict(zarr_format=3,node_type='array',shape=list(value.shape),data_type=dtype,chunk_grid=dict(name='regular',configuration=dict(chunk_shape=list(value.shape))),chunk_key_encoding=dict(name='default',configuration=dict(separator='/')),fill_value=0,codecs=[dict(name='bytes',configuration=dict(endian='little'))],attributes={})
    (directory/'zarr.json').write_text(json.dumps(header))
    chunk=directory/Path('c',*['0']*value.ndim);chunk.parent.mkdir(parents=True,exist_ok=True);chunk.write_bytes(value.tobytes())
for name,compressed in [('precomputed',False),('precomputed_gzip',True)]:
    root=OUT/name;root.mkdir(exist_ok=True)
    region=bytearray();offsets=[];sizes=[]
    for chunk in [b'ABCDEFGHI',b'abcdefghi',b'123456789']:
        region+=chunk;offsets.append(len(region));part=gzip.compress(data,mtime=0) if compressed else data;region+=part;sizes.append(len(part))
    deltas=[offsets[0]]+[offsets[i]-(offsets[i-1]+sizes[i-1]) for i in range(1,3)]
    index=struct.pack('<9Q',2,2,2**64-5,*deltas,*sizes)
    if compressed:index=gzip.compress(index,mtime=0)
    (root/'0.shard').write_bytes(struct.pack('<2Q',len(region),len(region)+len(index))+region+index)
    spec={'@type':'neuroglancer_uint64_sharded_v1','preshift_bits':0,'hash':'identity','minishard_bits':0,'shard_bits':0,'minishard_index_encoding':'gzip' if compressed else 'raw','data_encoding':'gzip' if compressed else 'raw'}
    (root/'info').write_text(json.dumps(dict(lod_scale_multiplier=.75,transform=sum(transform,[]),sharding=spec,vertex_quantization_bits=10)))
real=ROOT/'binaryData/sample_organization/test-agglomerate-file/segmentation/meshes/meshfile_1-1-1_agglomerate_view_70.hdf5'
shutil.copyfile(real,OUT/'real.hdf5')
with h5py.File(real) as f:
    raw=f['neuroglancer'][:].tobytes();(OUT/'real_payload.bin').write_bytes(raw)
    queries=[]
    for id,start,end in f['buckets'][:3]:
        id,start,end=map(int,(id,start,end));(OUT/f'real_manifest_{id}.bin').write_bytes(raw[start:end]);queries.append(dict(id=id,start=start,end=end))
    (OUT/'real_attributes.json').write_text(json.dumps(dict(version=int(f.attrs['artifact_schema_version']),mapping=f.attrs['mapping_name'],transform=f.attrs['transform'].tolist(),multiplier=float(f.attrs['lod_scale_multiplier']),queries=queries)))
