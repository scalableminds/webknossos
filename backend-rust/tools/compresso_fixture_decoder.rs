// Standalone fixture oracle; no production dependency.
mod error {
    #[derive(Debug)] pub struct DsError(pub String);
    pub type DsResult<T> = Result<T,DsError>;
    impl DsError {pub fn failure(message:impl Into<String>)->Self {Self(message.into())}}
}
#[path="../datastore/src/datareaders/precomputed/compresso.rs"]
mod compresso;
fn main() {
    let args:Vec<String>=std::env::args().collect();
    let input=std::fs::read(&args[1]).unwrap();
    match compresso::decode(&input,300*1024*1024) {
        Ok(bytes)=>std::fs::write(&args[2],bytes).unwrap(),
        Err(error)=>{eprintln!("{}",error.0);std::process::exit(1);}
    }
}
