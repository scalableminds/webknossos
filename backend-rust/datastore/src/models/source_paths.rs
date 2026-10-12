//! DSRemoteWebknossosClient datasource/root/real-path report JSON.
use super::{
    DataSource, DataSourceId, JsResult, UPath,
    json::{Fields, read_bool, read_list, read_string},
};
use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataSourceWithRootPathInfo {
    pub data_source: DataSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_real_path: Option<String>,
}
impl DataSourceWithRootPathInfo {
    pub fn from_json(v: &Value) -> JsResult<Self> {
        let mut f = Fields::new(v);
        let data_source = f.req("dataSource", DataSource::from_json);
        let root_path = f.opt("rootPath", read_string);
        let root_real_path = f.opt("rootRealPath", read_string);
        f.finish()?;
        Ok(Self {
            data_source: data_source?,
            root_path: root_path?,
            root_real_path: root_real_path?,
        })
    }
}
super::json::deserialize_via_from_json!(DataSourceWithRootPathInfo);

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealPathInfo {
    pub path: UPath,
    pub real_path: UPath,
    pub has_local_data: bool,
}
impl RealPathInfo {
    pub fn from_json(v: &Value) -> JsResult<Self> {
        let mut f = Fields::new(v);
        let path = f.req("path", UPath::from_json);
        let real_path = f.req("realPath", UPath::from_json);
        let has_local_data = f.req("hasLocalData", read_bool);
        f.finish()?;
        Ok(Self {
            path: path?,
            real_path: real_path?,
            has_local_data: has_local_data?,
        })
    }
}
super::json::deserialize_via_from_json!(RealPathInfo);

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataSourcePathInfo {
    pub data_source_id: DataSourceId,
    pub mag_path_infos: Vec<RealPathInfo>,
    pub attachment_path_infos: Vec<RealPathInfo>,
}
impl DataSourcePathInfo {
    pub fn is_empty(&self) -> bool {
        self.mag_path_infos.is_empty() && self.attachment_path_infos.is_empty()
    }
    pub fn from_json(v: &Value) -> JsResult<Self> {
        let mut f = Fields::new(v);
        let data_source_id = f.req("dataSourceId", DataSourceId::from_json);
        let mag_path_infos = f.req("magPathInfos", |v| read_list(v, RealPathInfo::from_json));
        let attachment_path_infos = f.req("attachmentPathInfos", |v| {
            read_list(v, RealPathInfo::from_json)
        });
        f.finish()?;
        Ok(Self {
            data_source_id: data_source_id?,
            mag_path_infos: mag_path_infos?,
            attachment_path_infos: attachment_path_infos?,
        })
    }
}
super::json::deserialize_via_from_json!(DataSourcePathInfo);
