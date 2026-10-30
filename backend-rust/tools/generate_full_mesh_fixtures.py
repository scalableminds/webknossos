"""Native-encoded Draco in HDF5/Zarr3/precomputed mesh containers (oracle generation only).
UV_CACHE_DIR=/tmp/wk-rust-reader-uv uv run --offline --with h5py==3.15.1 --with numpy==2.3.4 python backend-rust/tools/generate_full_mesh_fixtures.py
"""
from pathlib import Path
import struct,json
import h5py,numpy as np
ROOT=Path(__file__).resolve().parents[2]/'backend-rust/datastore/tests/fixtures'
OUT=ROOT/'full_mesh';OUT.mkdir(exist_ok=True)
transform=[[2.5,.5,1.,10.],[.25,.75,.5,20.],[1.,.5,4.,30.]]
def manifest(parts,origin):
    return struct.pack('<6fI',1.,1.,1.,*origin,1)+struct.pack('<f',1.)+struct.pack('<3f',0.,0.,0.)+struct.pack('<I',2)+struct.pack('<6i',0,0,0,0,0,0)+struct.pack('<2I',*[len(p) for p in parts])
floatparts=[(ROOT/'draco'/f'float_{m}.drc').read_bytes() for m in ['sequential','edgebreaker']]
m=manifest(floatparts,[10.25,-20.5,.125]);data=b''.join(floatparts);start=len(data);data+=m
attrs=dict(mesh_format='draco',lod_scale_multiplier=1.,transform=transform,hash_function='identity',n_buckets=1)
arrays={'bucket_offsets':np.array([0,1],dtype='<u8'),'buckets':np.array([[42,start,len(data)]],dtype='<u8'),'neuroglancer':np.frombuffer(data,dtype='u1')}
with h5py.File(OUT/'float.hdf5','w',libver='earliest') as f:
    for k,v in dict(attrs,artifact_schema_version=7).items():f.attrs[k]=v
    for k,v in arrays.items():f.create_dataset(k,data=v)
zarr=OUT/'zarr3';zarr.mkdir(exist_ok=True)
(zarr/'zarr.json').write_text(json.dumps(dict(zarr_format=3,node_type='group',attributes=dict(voxelytics=dict(artifact_schema_version=7,artifact_attributes=attrs)))))
for key,value in arrays.items():
    directory=zarr/key;directory.mkdir(exist_ok=True)
    header=dict(zarr_format=3,node_type='array',shape=list(value.shape),data_type='uint8' if key=='neuroglancer' else 'uint64',chunk_grid=dict(name='regular',configuration=dict(chunk_shape=list(value.shape))),chunk_key_encoding=dict(name='default',configuration=dict(separator='/')),fill_value=0,codecs=[dict(name='bytes',configuration=dict(endian='little'))],attributes={})
    (directory/'zarr.json').write_text(json.dumps(header));chunk=directory/Path('c',*['0']*value.ndim);chunk.parent.mkdir(parents=True,exist_ok=True);chunk.write_bytes(value.tobytes())
intparts=[(ROOT/'draco'/f'integer_{m}.drc').read_bytes() for m in ['sequential','edgebreaker']]
m=manifest(intparts,[0.,0.,0.]);data=b''.join(intparts);start=len(data);region=data+m
index=struct.pack('<3Q',42,start,len(m))
pc=OUT/'precomputed';pc.mkdir(exist_ok=True)
(pc/'0.shard').write_bytes(struct.pack('<2Q',len(region),len(region)+len(index))+region+index)
spec={'@type':'neuroglancer_uint64_sharded_v1','preshift_bits':0,'hash':'identity','minishard_bits':0,'shard_bits':0,'minishard_index_encoding':'raw','data_encoding':'raw'}
(pc/'info').write_text(json.dumps(dict(lod_scale_multiplier=1.,transform=sum(transform,[]),sharding=spec,vertex_quantization_bits=10)))
with h5py.File(OUT/'index.hdf5','w',libver='earliest') as f:
    for k,v in dict(n_hash_buckets=1,hash_function='identity',dtype_bucket_entries='uint16').items():f.attrs[k]=v
    f.create_dataset('hash_bucket_offsets',data=np.array([0,1],dtype='<u8'))
    f.create_dataset('hash_buckets',data=np.array([[17,0,1],[0,0,0]],dtype='<u8'))
    f.create_dataset('top_lefts',data=np.array([[0,0,0]],dtype='<u2'))
with h5py.File(OUT/'agg.hdf5','w',libver='earliest') as f:
    f.create_dataset('segment_to_agglomerate',data=np.array([0,0,42],dtype='<u8'))
