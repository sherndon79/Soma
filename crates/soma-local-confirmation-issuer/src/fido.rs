use crate::{IssuerError, RawAssertion};
use libloading::Library;
use std::ffi::{c_char, c_int, c_void, CString};
use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::Path;
use std::ptr::NonNull;
use std::slice;

const FIDO_OK: c_int = 0;
const COSE_ES256: c_int = -7;
const FIDO_OPT_FALSE: c_int = 1;
const FIDO_OPT_TRUE: c_int = 2;
const FIDO_DISABLE_U2F_FALLBACK: c_int = 0x02;
const LIBFIDO2_PATH: &str = "/usr/lib/x86_64-linux-gnu/libfido2.so.1";

type Dev = c_void;
type Assert = c_void;
type Cred = c_void;

pub struct FidoApi {
    _library: Library,
    dev_new: unsafe extern "C" fn() -> *mut Dev,
    dev_free: unsafe extern "C" fn(*mut *mut Dev),
    dev_open: unsafe extern "C" fn(*mut Dev, *const c_char) -> c_int,
    dev_close: unsafe extern "C" fn(*mut Dev),
    dev_force_fido2: unsafe extern "C" fn(*mut Dev),
    dev_is_fido2: unsafe extern "C" fn(*const Dev) -> bool,
    dev_get_assert: unsafe extern "C" fn(*mut Dev, *mut Assert, *const c_char) -> c_int,
    dev_make_cred: unsafe extern "C" fn(*mut Dev, *mut Cred, *const c_char) -> c_int,
    assert_new: unsafe extern "C" fn() -> *mut Assert,
    assert_free: unsafe extern "C" fn(*mut *mut Assert),
    assert_set_clientdata_hash: unsafe extern "C" fn(*mut Assert, *const u8, usize) -> c_int,
    assert_set_rp: unsafe extern "C" fn(*mut Assert, *const c_char) -> c_int,
    assert_allow_cred: unsafe extern "C" fn(*mut Assert, *const u8, usize) -> c_int,
    assert_set_up: unsafe extern "C" fn(*mut Assert, c_int) -> c_int,
    assert_set_uv: unsafe extern "C" fn(*mut Assert, c_int) -> c_int,
    assert_count: unsafe extern "C" fn(*const Assert) -> usize,
    assert_authdata_raw_ptr: unsafe extern "C" fn(*const Assert, usize) -> *const u8,
    assert_authdata_raw_len: unsafe extern "C" fn(*const Assert, usize) -> usize,
    assert_sig_ptr: unsafe extern "C" fn(*const Assert, usize) -> *const u8,
    assert_sig_len: unsafe extern "C" fn(*const Assert, usize) -> usize,
    assert_id_ptr: unsafe extern "C" fn(*const Assert, usize) -> *const u8,
    assert_id_len: unsafe extern "C" fn(*const Assert, usize) -> usize,
    cred_new: unsafe extern "C" fn() -> *mut Cred,
    cred_free: unsafe extern "C" fn(*mut *mut Cred),
    cred_set_clientdata_hash: unsafe extern "C" fn(*mut Cred, *const u8, usize) -> c_int,
    cred_set_rp: unsafe extern "C" fn(*mut Cred, *const c_char, *const c_char) -> c_int,
    cred_set_user: unsafe extern "C" fn(
        *mut Cred,
        *const u8,
        usize,
        *const c_char,
        *const c_char,
        *const c_char,
    ) -> c_int,
    cred_set_type: unsafe extern "C" fn(*mut Cred, c_int) -> c_int,
    cred_set_rk: unsafe extern "C" fn(*mut Cred, c_int) -> c_int,
    cred_set_uv: unsafe extern "C" fn(*mut Cred, c_int) -> c_int,
    cred_set_fmt: unsafe extern "C" fn(*mut Cred, *const c_char) -> c_int,
    cred_verify: unsafe extern "C" fn(*const Cred) -> c_int,
    cred_fmt: unsafe extern "C" fn(*const Cred) -> *const c_char,
    cred_x5c_ptr: unsafe extern "C" fn(*const Cred) -> *const u8,
    cred_x5c_len: unsafe extern "C" fn(*const Cred) -> usize,
    cred_x5c_list_count: unsafe extern "C" fn(*const Cred) -> usize,
    cred_x5c_list_ptr: unsafe extern "C" fn(*const Cred, usize) -> *const u8,
    cred_x5c_list_len: unsafe extern "C" fn(*const Cred, usize) -> usize,
    cred_id_ptr: unsafe extern "C" fn(*const Cred) -> *const u8,
    cred_id_len: unsafe extern "C" fn(*const Cred) -> usize,
    cred_pubkey_ptr: unsafe extern "C" fn(*const Cred) -> *const u8,
    cred_pubkey_len: unsafe extern "C" fn(*const Cred) -> usize,
    cred_aaguid_ptr: unsafe extern "C" fn(*const Cred) -> *const u8,
    cred_aaguid_len: unsafe extern "C" fn(*const Cred) -> usize,
    cred_flags: unsafe extern "C" fn(*const Cred) -> u8,
    cred_type: unsafe extern "C" fn(*const Cred) -> c_int,
}

impl FidoApi {
    pub fn load() -> Result<Self, IssuerError> {
        assert_trusted_library(Path::new(LIBFIDO2_PATH))?;
        let library = unsafe { Library::new(LIBFIDO2_PATH) }
            .map_err(|_| IssuerError::new("lca_hardware_backend_unavailable"))?;
        macro_rules! symbol {
            ($name:literal, $ty:ty) => {{
                let value = unsafe { library.get::<$ty>(concat!($name, "\0").as_bytes()) }
                    .map_err(|_| IssuerError::new("lca_hardware_backend_unavailable"))?;
                *value
            }};
        }
        let init = symbol!("fido_init", unsafe extern "C" fn(c_int));
        unsafe { init(FIDO_DISABLE_U2F_FALLBACK) };
        Ok(Self {
            dev_new: symbol!("fido_dev_new", unsafe extern "C" fn() -> *mut Dev),
            dev_free: symbol!("fido_dev_free", unsafe extern "C" fn(*mut *mut Dev)),
            dev_open: symbol!(
                "fido_dev_open",
                unsafe extern "C" fn(*mut Dev, *const c_char) -> c_int
            ),
            dev_close: symbol!("fido_dev_close", unsafe extern "C" fn(*mut Dev)),
            dev_force_fido2: symbol!("fido_dev_force_fido2", unsafe extern "C" fn(*mut Dev)),
            dev_is_fido2: symbol!(
                "fido_dev_is_fido2",
                unsafe extern "C" fn(*const Dev) -> bool
            ),
            dev_get_assert: symbol!(
                "fido_dev_get_assert",
                unsafe extern "C" fn(*mut Dev, *mut Assert, *const c_char) -> c_int
            ),
            dev_make_cred: symbol!(
                "fido_dev_make_cred",
                unsafe extern "C" fn(*mut Dev, *mut Cred, *const c_char) -> c_int
            ),
            assert_new: symbol!("fido_assert_new", unsafe extern "C" fn() -> *mut Assert),
            assert_free: symbol!("fido_assert_free", unsafe extern "C" fn(*mut *mut Assert)),
            assert_set_clientdata_hash: symbol!(
                "fido_assert_set_clientdata_hash",
                unsafe extern "C" fn(*mut Assert, *const u8, usize) -> c_int
            ),
            assert_set_rp: symbol!(
                "fido_assert_set_rp",
                unsafe extern "C" fn(*mut Assert, *const c_char) -> c_int
            ),
            assert_allow_cred: symbol!(
                "fido_assert_allow_cred",
                unsafe extern "C" fn(*mut Assert, *const u8, usize) -> c_int
            ),
            assert_set_up: symbol!(
                "fido_assert_set_up",
                unsafe extern "C" fn(*mut Assert, c_int) -> c_int
            ),
            assert_set_uv: symbol!(
                "fido_assert_set_uv",
                unsafe extern "C" fn(*mut Assert, c_int) -> c_int
            ),
            assert_count: symbol!(
                "fido_assert_count",
                unsafe extern "C" fn(*const Assert) -> usize
            ),
            assert_authdata_raw_ptr: symbol!(
                "fido_assert_authdata_raw_ptr",
                unsafe extern "C" fn(*const Assert, usize) -> *const u8
            ),
            assert_authdata_raw_len: symbol!(
                "fido_assert_authdata_raw_len",
                unsafe extern "C" fn(*const Assert, usize) -> usize
            ),
            assert_sig_ptr: symbol!(
                "fido_assert_sig_ptr",
                unsafe extern "C" fn(*const Assert, usize) -> *const u8
            ),
            assert_sig_len: symbol!(
                "fido_assert_sig_len",
                unsafe extern "C" fn(*const Assert, usize) -> usize
            ),
            assert_id_ptr: symbol!(
                "fido_assert_id_ptr",
                unsafe extern "C" fn(*const Assert, usize) -> *const u8
            ),
            assert_id_len: symbol!(
                "fido_assert_id_len",
                unsafe extern "C" fn(*const Assert, usize) -> usize
            ),
            cred_new: symbol!("fido_cred_new", unsafe extern "C" fn() -> *mut Cred),
            cred_free: symbol!("fido_cred_free", unsafe extern "C" fn(*mut *mut Cred)),
            cred_set_clientdata_hash: symbol!(
                "fido_cred_set_clientdata_hash",
                unsafe extern "C" fn(*mut Cred, *const u8, usize) -> c_int
            ),
            cred_set_rp: symbol!(
                "fido_cred_set_rp",
                unsafe extern "C" fn(*mut Cred, *const c_char, *const c_char) -> c_int
            ),
            cred_set_user: symbol!(
                "fido_cred_set_user",
                unsafe extern "C" fn(
                    *mut Cred,
                    *const u8,
                    usize,
                    *const c_char,
                    *const c_char,
                    *const c_char,
                ) -> c_int
            ),
            cred_set_type: symbol!(
                "fido_cred_set_type",
                unsafe extern "C" fn(*mut Cred, c_int) -> c_int
            ),
            cred_set_rk: symbol!(
                "fido_cred_set_rk",
                unsafe extern "C" fn(*mut Cred, c_int) -> c_int
            ),
            cred_set_uv: symbol!(
                "fido_cred_set_uv",
                unsafe extern "C" fn(*mut Cred, c_int) -> c_int
            ),
            cred_set_fmt: symbol!(
                "fido_cred_set_fmt",
                unsafe extern "C" fn(*mut Cred, *const c_char) -> c_int
            ),
            cred_verify: symbol!(
                "fido_cred_verify",
                unsafe extern "C" fn(*const Cred) -> c_int
            ),
            cred_fmt: symbol!(
                "fido_cred_fmt",
                unsafe extern "C" fn(*const Cred) -> *const c_char
            ),
            cred_x5c_ptr: symbol!(
                "fido_cred_x5c_ptr",
                unsafe extern "C" fn(*const Cred) -> *const u8
            ),
            cred_x5c_len: symbol!(
                "fido_cred_x5c_len",
                unsafe extern "C" fn(*const Cred) -> usize
            ),
            cred_x5c_list_count: symbol!(
                "fido_cred_x5c_list_count",
                unsafe extern "C" fn(*const Cred) -> usize
            ),
            cred_x5c_list_ptr: symbol!(
                "fido_cred_x5c_list_ptr",
                unsafe extern "C" fn(*const Cred, usize) -> *const u8
            ),
            cred_x5c_list_len: symbol!(
                "fido_cred_x5c_list_len",
                unsafe extern "C" fn(*const Cred, usize) -> usize
            ),
            cred_id_ptr: symbol!(
                "fido_cred_id_ptr",
                unsafe extern "C" fn(*const Cred) -> *const u8
            ),
            cred_id_len: symbol!(
                "fido_cred_id_len",
                unsafe extern "C" fn(*const Cred) -> usize
            ),
            cred_pubkey_ptr: symbol!(
                "fido_cred_pubkey_ptr",
                unsafe extern "C" fn(*const Cred) -> *const u8
            ),
            cred_pubkey_len: symbol!(
                "fido_cred_pubkey_len",
                unsafe extern "C" fn(*const Cred) -> usize
            ),
            cred_aaguid_ptr: symbol!(
                "fido_cred_aaguid_ptr",
                unsafe extern "C" fn(*const Cred) -> *const u8
            ),
            cred_aaguid_len: symbol!(
                "fido_cred_aaguid_len",
                unsafe extern "C" fn(*const Cred) -> usize
            ),
            cred_flags: symbol!("fido_cred_flags", unsafe extern "C" fn(*const Cred) -> u8),
            cred_type: symbol!("fido_cred_type", unsafe extern "C" fn(*const Cred) -> c_int),
            _library: library,
        })
    }

    pub fn get_assertion(
        &self,
        device_path: &Path,
        challenge_hash: [u8; 32],
        rp_id: &str,
        credential_id: &[u8],
        require_uv: bool,
    ) -> Result<RawAssertion, IssuerError> {
        let device = DeviceHandle::open(self, device_path)?;
        let assertion = AssertHandle::new(self)?;
        let rp_id =
            CString::new(rp_id).map_err(|_| IssuerError::new("lca_hardware_request_invalid"))?;
        check(unsafe {
            (self.assert_set_clientdata_hash)(
                assertion.pointer.as_ptr(),
                challenge_hash.as_ptr(),
                challenge_hash.len(),
            )
        })?;
        check(unsafe { (self.assert_set_rp)(assertion.pointer.as_ptr(), rp_id.as_ptr()) })?;
        check(unsafe {
            (self.assert_allow_cred)(
                assertion.pointer.as_ptr(),
                credential_id.as_ptr(),
                credential_id.len(),
            )
        })?;
        check(unsafe { (self.assert_set_up)(assertion.pointer.as_ptr(), FIDO_OPT_TRUE) })?;
        check(unsafe {
            (self.assert_set_uv)(
                assertion.pointer.as_ptr(),
                if require_uv {
                    FIDO_OPT_TRUE
                } else {
                    FIDO_OPT_FALSE
                },
            )
        })?;
        check(unsafe {
            (self.dev_get_assert)(
                device.pointer.as_ptr(),
                assertion.pointer.as_ptr(),
                std::ptr::null(),
            )
        })?;
        if unsafe { (self.assert_count)(assertion.pointer.as_ptr()) } != 1 {
            return Err(IssuerError::new("lca_hardware_response_invalid"));
        }
        let id = unsafe {
            copy_blob(
                (self.assert_id_ptr)(assertion.pointer.as_ptr(), 0),
                (self.assert_id_len)(assertion.pointer.as_ptr(), 0),
                1024,
            )
        }?;
        if id != credential_id {
            return Err(IssuerError::new("lca_hardware_response_invalid"));
        }
        let authenticator_data = unsafe {
            copy_blob(
                (self.assert_authdata_raw_ptr)(assertion.pointer.as_ptr(), 0),
                (self.assert_authdata_raw_len)(assertion.pointer.as_ptr(), 0),
                4096,
            )
        }?;
        let signature_der = unsafe {
            copy_blob(
                (self.assert_sig_ptr)(assertion.pointer.as_ptr(), 0),
                (self.assert_sig_len)(assertion.pointer.as_ptr(), 0),
                1024,
            )
        }?;
        Ok(RawAssertion {
            credential_id: hex::encode(id),
            authenticator_data,
            signature_der,
        })
    }

    pub fn make_es256_credential(
        &self,
        device_path: &Path,
        challenge_hash: [u8; 32],
        rp_id: &str,
        user_id: &[u8],
    ) -> Result<CreatedCredential, IssuerError> {
        let device = DeviceHandle::open(self, device_path)?;
        let credential = CredHandle::new(self)?;
        let rp_id =
            CString::new(rp_id).map_err(|_| IssuerError::new("lca_enrollment_request_invalid"))?;
        let rp_name = CString::new("Soma local confirmation").unwrap();
        let user_name = CString::new("soma-lca").unwrap();
        let display_name = CString::new("Soma LCA").unwrap();
        let packed = CString::new("packed").unwrap();
        check(unsafe {
            (self.cred_set_clientdata_hash)(
                credential.pointer.as_ptr(),
                challenge_hash.as_ptr(),
                challenge_hash.len(),
            )
        })?;
        check(unsafe {
            (self.cred_set_rp)(
                credential.pointer.as_ptr(),
                rp_id.as_ptr(),
                rp_name.as_ptr(),
            )
        })?;
        check(unsafe {
            (self.cred_set_user)(
                credential.pointer.as_ptr(),
                user_id.as_ptr(),
                user_id.len(),
                user_name.as_ptr(),
                display_name.as_ptr(),
                std::ptr::null(),
            )
        })?;
        check(unsafe { (self.cred_set_type)(credential.pointer.as_ptr(), COSE_ES256) })?;
        check(unsafe { (self.cred_set_rk)(credential.pointer.as_ptr(), FIDO_OPT_FALSE) })?;
        check(unsafe { (self.cred_set_uv)(credential.pointer.as_ptr(), FIDO_OPT_FALSE) })?;
        check(unsafe { (self.cred_set_fmt)(credential.pointer.as_ptr(), packed.as_ptr()) })?;
        check(unsafe {
            (self.dev_make_cred)(
                device.pointer.as_ptr(),
                credential.pointer.as_ptr(),
                std::ptr::null(),
            )
        })?;
        check(unsafe { (self.cred_verify)(credential.pointer.as_ptr()) })?;
        let format_ptr = unsafe { (self.cred_fmt)(credential.pointer.as_ptr()) };
        if format_ptr.is_null()
            || unsafe { std::ffi::CStr::from_ptr(format_ptr) }.to_bytes() != b"packed"
            || unsafe { (self.cred_type)(credential.pointer.as_ptr()) } != COSE_ES256
        {
            return Err(IssuerError::new("lca_attestation_invalid"));
        }
        let certificate = unsafe {
            copy_blob(
                (self.cred_x5c_ptr)(credential.pointer.as_ptr()),
                (self.cred_x5c_len)(credential.pointer.as_ptr()),
                16 * 1024,
            )
        }?;
        let chain_count = unsafe { (self.cred_x5c_list_count)(credential.pointer.as_ptr()) };
        if chain_count == 0 || chain_count > 8 {
            return Err(IssuerError::new("lca_attestation_invalid"));
        }
        let mut certificate_chain = Vec::with_capacity(chain_count);
        for index in 0..chain_count {
            certificate_chain.push(unsafe {
                copy_blob(
                    (self.cred_x5c_list_ptr)(credential.pointer.as_ptr(), index),
                    (self.cred_x5c_list_len)(credential.pointer.as_ptr(), index),
                    16 * 1024,
                )
            }?);
        }
        if certificate_chain[0] != certificate {
            return Err(IssuerError::new("lca_attestation_invalid"));
        }
        Ok(CreatedCredential {
            certificate_chain,
            credential_id: unsafe {
                copy_blob(
                    (self.cred_id_ptr)(credential.pointer.as_ptr()),
                    (self.cred_id_len)(credential.pointer.as_ptr()),
                    1024,
                )
            }?,
            public_key: unsafe {
                copy_blob(
                    (self.cred_pubkey_ptr)(credential.pointer.as_ptr()),
                    (self.cred_pubkey_len)(credential.pointer.as_ptr()),
                    1024,
                )
            }?,
            aaguid: unsafe {
                copy_blob(
                    (self.cred_aaguid_ptr)(credential.pointer.as_ptr()),
                    (self.cred_aaguid_len)(credential.pointer.as_ptr()),
                    16,
                )
            }?,
            flags: unsafe { (self.cred_flags)(credential.pointer.as_ptr()) },
        })
    }
}

fn assert_trusted_library(path: &Path) -> Result<(), IssuerError> {
    let link = fs::symlink_metadata(path)
        .map_err(|_| IssuerError::new("lca_hardware_backend_unavailable"))?;
    let target_path =
        fs::canonicalize(path).map_err(|_| IssuerError::new("lca_hardware_backend_unavailable"))?;
    let target = fs::metadata(&target_path)
        .map_err(|_| IssuerError::new("lca_hardware_backend_unavailable"))?;
    let parent = fs::metadata(
        path.parent()
            .ok_or_else(|| IssuerError::new("lca_hardware_backend_unavailable"))?,
    )
    .map_err(|_| IssuerError::new("lca_hardware_backend_unavailable"))?;
    if link.uid() != 0
        || !target.is_file()
        || target.uid() != 0
        || target.mode() & 0o022 != 0
        || !parent.is_dir()
        || parent.uid() != 0
        || parent.mode() & 0o022 != 0
        || target_path.parent() != path.parent()
    {
        return Err(IssuerError::new("lca_hardware_backend_unavailable"));
    }
    Ok(())
}

pub struct CreatedCredential {
    pub certificate_chain: Vec<Vec<u8>>,
    pub credential_id: Vec<u8>,
    pub public_key: Vec<u8>,
    pub aaguid: Vec<u8>,
    pub flags: u8,
}

struct DeviceHandle<'a> {
    api: &'a FidoApi,
    pointer: NonNull<Dev>,
}

impl<'a> DeviceHandle<'a> {
    fn open(api: &'a FidoApi, path: &Path) -> Result<Self, IssuerError> {
        let pointer = NonNull::new(unsafe { (api.dev_new)() })
            .ok_or_else(|| IssuerError::new("lca_hardware_backend_unavailable"))?;
        let path = CString::new(
            path.to_str()
                .ok_or_else(|| IssuerError::new("lca_device_configuration_invalid"))?,
        )
        .map_err(|_| IssuerError::new("lca_device_configuration_invalid"))?;
        if unsafe { (api.dev_open)(pointer.as_ptr(), path.as_ptr()) } != FIDO_OK {
            let mut raw = pointer.as_ptr();
            unsafe { (api.dev_free)(&mut raw) };
            return Err(IssuerError::new("lca_hardware_backend_unavailable"));
        }
        unsafe { (api.dev_force_fido2)(pointer.as_ptr()) };
        if !unsafe { (api.dev_is_fido2)(pointer.as_ptr()) } {
            unsafe { (api.dev_close)(pointer.as_ptr()) };
            let mut raw = pointer.as_ptr();
            unsafe { (api.dev_free)(&mut raw) };
            return Err(IssuerError::new("lca_hardware_backend_unavailable"));
        }
        Ok(Self { api, pointer })
    }
}

impl Drop for DeviceHandle<'_> {
    fn drop(&mut self) {
        unsafe { (self.api.dev_close)(self.pointer.as_ptr()) };
        let mut pointer = self.pointer.as_ptr();
        unsafe { (self.api.dev_free)(&mut pointer) };
    }
}

struct AssertHandle<'a> {
    api: &'a FidoApi,
    pointer: NonNull<Assert>,
}

impl<'a> AssertHandle<'a> {
    fn new(api: &'a FidoApi) -> Result<Self, IssuerError> {
        Ok(Self {
            api,
            pointer: NonNull::new(unsafe { (api.assert_new)() })
                .ok_or_else(|| IssuerError::new("lca_hardware_backend_unavailable"))?,
        })
    }
}

impl Drop for AssertHandle<'_> {
    fn drop(&mut self) {
        let mut pointer = self.pointer.as_ptr();
        unsafe { (self.api.assert_free)(&mut pointer) };
    }
}

struct CredHandle<'a> {
    api: &'a FidoApi,
    pointer: NonNull<Cred>,
}

impl<'a> CredHandle<'a> {
    fn new(api: &'a FidoApi) -> Result<Self, IssuerError> {
        Ok(Self {
            api,
            pointer: NonNull::new(unsafe { (api.cred_new)() })
                .ok_or_else(|| IssuerError::new("lca_hardware_backend_unavailable"))?,
        })
    }
}

impl Drop for CredHandle<'_> {
    fn drop(&mut self) {
        let mut pointer = self.pointer.as_ptr();
        unsafe { (self.api.cred_free)(&mut pointer) };
    }
}

fn check(result: c_int) -> Result<(), IssuerError> {
    if result == FIDO_OK {
        Ok(())
    } else {
        Err(IssuerError::new("lca_hardware_ceremony_failed"))
    }
}

unsafe fn copy_blob(
    pointer: *const u8,
    length: usize,
    maximum: usize,
) -> Result<Vec<u8>, IssuerError> {
    if pointer.is_null() || length == 0 || length > maximum {
        return Err(IssuerError::new("lca_hardware_response_invalid"));
    }
    Ok(unsafe { slice::from_raw_parts(pointer, length) }.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_library_has_the_complete_narrow_abi() {
        FidoApi::load().unwrap();
    }
}
