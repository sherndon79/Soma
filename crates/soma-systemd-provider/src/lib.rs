use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub const DEFINITION_DIGEST_SCHEMA: &str = "soma.systemd.effective-definition.v1";
pub const CLOSURE_SCHEMA: &str = "soma.systemd.affected-closure.v1";

pub const DEFINITION_PROPERTIES: &[&str] = &[
    "AmbientCapabilities",
    "BusName",
    "CapabilityBoundingSet",
    "DynamicUser",
    "Environment",
    "EnvironmentFiles",
    "ExecCondition",
    "ExecStart",
    "ExecStartPost",
    "ExecStartPre",
    "ExecStop",
    "ExecStopPost",
    "Group",
    "NoNewPrivileges",
    "PrivateDevices",
    "PrivateIPC",
    "PrivateMounts",
    "PrivateNetwork",
    "PrivatePIDs",
    "PrivateTmp",
    "PrivateUsers",
    "ProtectClock",
    "ProtectControlGroups",
    "ProtectHome",
    "ProtectHostname",
    "ProtectKernelLogs",
    "ProtectKernelModules",
    "ProtectKernelTunables",
    "ProtectProc",
    "ProtectSystem",
    "Restart",
    "RootDirectory",
    "RootImage",
    "Type",
    "User",
    "WorkingDirectory",
];

pub const CLOSURE_PROPERTIES: &[&str] = &[
    "BindsTo",
    "BoundBy",
    "ConsistsOf",
    "PartOf",
    "PropagatesReloadTo",
    "PropagatesStopTo",
    "ReloadPropagatedFrom",
    "RequiredBy",
    "Requires",
    "Requisite",
    "RequisiteOf",
    "StopPropagatedFrom",
    "TriggeredBy",
    "Triggers",
];

pub const AFFECTED_REVERSE_PROPERTIES: &[&str] = &[
    "BoundBy",
    "ConsistsOf",
    "PropagatesReloadTo",
    "PropagatesStopTo",
    "ReloadPropagatedFrom",
    "RequiredBy",
    "RequisiteOf",
    "StopPropagatedFrom",
    "TriggeredBy",
];

#[derive(Debug, Clone, Deserialize)]
pub struct Inventory {
    pub schema_version: u32,
    pub activation_status: String,
    #[serde(default)]
    pub restart_enabled: bool,
    #[serde(default)]
    pub controlled_testing: bool,
    pub units: Vec<InventoryUnit>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct InventoryUnit {
    pub inventory_id: String,
    pub unit_name: String,
}

impl Inventory {
    pub fn resolve(&self, inventory_id: &str) -> Result<&InventoryUnit, ProviderError> {
        if self.schema_version != 1 || self.activation_status != "disabled" {
            return Err(ProviderError::new(
                "provider_inventory_non_authorizing",
                false,
            ));
        }
        let mut matches = self
            .units
            .iter()
            .filter(|unit| unit.inventory_id == inventory_id);
        let unit = matches
            .next()
            .ok_or_else(|| ProviderError::new("service_unit_not_allowlisted", false))?;
        if matches.next().is_some()
            || !valid_inventory_id(&unit.inventory_id)
            || !valid_unit_name(&unit.unit_name)
        {
            return Err(ProviderError::new("provider_inventory_invalid", false));
        }
        Ok(unit)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub request_id: String,
    pub method: Method,
    pub inventory_id: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Method {
    StatusRead,
    RestartInspect,
    RestartApply,
}

#[derive(Debug, Clone, Serialize)]
pub struct Response {
    pub request_id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<ProviderResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorResult>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ErrorResult {
    pub code: String,
    pub ambiguous: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProviderResult {
    pub load_state: String,
    pub active_state: String,
    pub sub_state: String,
    pub unit_file_state_class: String,
    pub can_restart: bool,
    pub restart_policy_class: String,
    pub state_changed_at_bucket: String,
    pub healthy: bool,
    pub unit_definition_digest: String,
    pub definition_digest_schema: String,
    pub affected_closure: String,
    pub closure_schema: String,
    pub invocation_id: String,
    pub activation_timestamp_monotonic: u64,
    pub dispatch_status: String,
}

#[derive(Debug, Clone, Default)]
pub struct UnitSnapshot {
    pub load_state: String,
    pub active_state: String,
    pub sub_state: String,
    pub unit_file_state: String,
    pub can_start: bool,
    pub invocation_id: Vec<u8>,
    pub active_enter_timestamp_monotonic: u64,
    pub definition_properties: BTreeMap<String, String>,
    pub fragment_contents: Vec<u8>,
    pub drop_in_contents: BTreeMap<String, Vec<u8>>,
    pub closure_properties: BTreeMap<String, Vec<String>>,
    pub socket_activated: bool,
    pub dbus_activated: bool,
}

#[derive(Debug, Clone)]
pub struct ProviderError {
    pub code: &'static str,
    pub ambiguous: bool,
}

impl ProviderError {
    pub fn new(code: &'static str, ambiguous: bool) -> Self {
        Self { code, ambiguous }
    }
}

pub trait SystemdSource {
    fn inspect(&self, unit_name: &str) -> Result<UnitSnapshot, ProviderError>;
    fn restart(&self, unit_name: &str) -> Result<(), ProviderError>;
}

pub fn execute<S: SystemdSource>(inventory: &Inventory, request: &Request, source: &S) -> Response {
    let result = execute_inner(inventory, request, source);
    match result {
        Ok(result) => Response {
            request_id: bounded_request_id(&request.request_id),
            ok: true,
            result: Some(result),
            error: None,
        },
        Err(error) => Response {
            request_id: bounded_request_id(&request.request_id),
            ok: false,
            result: None,
            error: Some(ErrorResult {
                code: error.code.to_string(),
                ambiguous: error.ambiguous,
            }),
        },
    }
}

fn execute_inner<S: SystemdSource>(
    inventory: &Inventory,
    request: &Request,
    source: &S,
) -> Result<ProviderResult, ProviderError> {
    if request.request_id.is_empty() || request.request_id.len() > 128 {
        return Err(ProviderError::new("provider_request_invalid", false));
    }
    let unit = inventory.resolve(&request.inventory_id)?;
    if request.method == Method::RestartApply
        && (!inventory.restart_enabled || !inventory.controlled_testing)
    {
        return Err(ProviderError::new(
            "service_restart_provider_refused",
            false,
        ));
    }
    let before = source.inspect(&unit.unit_name)?;
    validate_snapshot(&before)?;

    match request.method {
        Method::StatusRead | Method::RestartInspect => {
            result_from_snapshot(&before, "not_dispatched")
        }
        Method::RestartApply => {
            if before.active_state != "active" || before.sub_state != "running" {
                return Err(ProviderError::new(
                    "service_restart_prestate_unsupported",
                    false,
                ));
            }
            source.restart(&unit.unit_name)?;
            let after = source.inspect(&unit.unit_name).map_err(after_dispatch)?;
            validate_snapshot(&after).map_err(after_dispatch)?;
            result_from_snapshot(&after, "dispatched").map_err(after_dispatch)
        }
    }
}

pub fn result_from_snapshot(
    snapshot: &UnitSnapshot,
    dispatch_status: &str,
) -> Result<ProviderResult, ProviderError> {
    Ok(ProviderResult {
        load_state: enum_value(&snapshot.load_state, &["loaded", "not-found", "masked"]),
        active_state: enum_value(
            &snapshot.active_state,
            &[
                "active",
                "inactive",
                "failed",
                "activating",
                "deactivating",
                "reloading",
            ],
        ),
        sub_state: enum_value(
            &snapshot.sub_state,
            &["running", "dead", "failed", "start", "stop", "reload"],
        ),
        unit_file_state_class: enum_value(
            &snapshot.unit_file_state,
            &["enabled", "disabled", "static", "masked", "transient"],
        ),
        can_restart: snapshot.can_start,
        restart_policy_class: if snapshot.can_start {
            "allowed_with_confirmation".to_string()
        } else {
            "unsupported".to_string()
        },
        state_changed_at_bucket: "unknown".to_string(),
        healthy: snapshot.load_state == "loaded"
            && snapshot.active_state == "active"
            && snapshot.sub_state == "running",
        unit_definition_digest: effective_definition_digest(snapshot)?,
        definition_digest_schema: DEFINITION_DIGEST_SCHEMA.to_string(),
        affected_closure: affected_closure(snapshot)?,
        closure_schema: CLOSURE_SCHEMA.to_string(),
        invocation_id: hex::encode(&snapshot.invocation_id),
        activation_timestamp_monotonic: snapshot.active_enter_timestamp_monotonic,
        dispatch_status: dispatch_status.to_string(),
    })
}

pub fn effective_definition_digest(snapshot: &UnitSnapshot) -> Result<String, ProviderError> {
    for property in DEFINITION_PROPERTIES {
        if !snapshot.definition_properties.contains_key(*property) {
            return Err(ProviderError::new(
                "service_unit_definition_unsupported",
                false,
            ));
        }
    }
    let mut hasher = Sha256::new();
    hash_field(&mut hasher, "schema", DEFINITION_DIGEST_SCHEMA.as_bytes());
    hash_field(&mut hasher, "fragment", &snapshot.fragment_contents);
    for (name, contents) in &snapshot.drop_in_contents {
        hash_field(&mut hasher, &format!("dropin:{name}"), contents);
    }
    for property in DEFINITION_PROPERTIES {
        hash_field(
            &mut hasher,
            &format!("property:{property}"),
            snapshot.definition_properties[*property].as_bytes(),
        );
    }
    hash_field(
        &mut hasher,
        "socket_activated",
        if snapshot.socket_activated {
            b"true"
        } else {
            b"false"
        },
    );
    hash_field(
        &mut hasher,
        "dbus_activated",
        if snapshot.dbus_activated {
            b"true"
        } else {
            b"false"
        },
    );
    Ok(hex::encode(hasher.finalize()))
}

pub fn affected_closure(snapshot: &UnitSnapshot) -> Result<String, ProviderError> {
    if snapshot.socket_activated || snapshot.dbus_activated {
        return Err(ProviderError::new(
            "service_unit_activation_unsupported",
            false,
        ));
    }
    for property in CLOSURE_PROPERTIES {
        if !snapshot.closure_properties.contains_key(*property) {
            return Err(ProviderError::new(
                "service_unit_dependency_closure_unsafe",
                false,
            ));
        }
    }
    for property in AFFECTED_REVERSE_PROPERTIES {
        let values = snapshot
            .closure_properties
            .get(*property)
            .ok_or_else(|| ProviderError::new("service_unit_dependency_closure_unsafe", false))?;
        if !values.is_empty() {
            return Err(ProviderError::new(
                "service_unit_dependency_closure_unsafe",
                false,
            ));
        }
    }
    Ok("target_only".to_string())
}

fn validate_snapshot(snapshot: &UnitSnapshot) -> Result<(), ProviderError> {
    if snapshot.load_state != "loaded" {
        return Err(ProviderError::new("service_status_unavailable", false));
    }
    effective_definition_digest(snapshot)?;
    affected_closure(snapshot)?;
    Ok(())
}

fn after_dispatch(mut error: ProviderError) -> ProviderError {
    error.ambiguous = true;
    error
}

fn hash_field(hasher: &mut Sha256, name: &str, value: &[u8]) {
    hasher.update((name.len() as u64).to_be_bytes());
    hasher.update(name.as_bytes());
    hasher.update((value.len() as u64).to_be_bytes());
    hasher.update(value);
}

fn enum_value(value: &str, allowed: &[&str]) -> String {
    if allowed.contains(&value) {
        value.replace('-', "_")
    } else {
        "unknown".to_string()
    }
}

fn bounded_request_id(value: &str) -> String {
    value.chars().take(128).collect()
}

fn valid_inventory_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn valid_unit_name(value: &str) -> bool {
    value.ends_with(".service")
        && !value.contains('@')
        && value.len() <= 256
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    struct FakeSource {
        snapshot: UnitSnapshot,
        restarts: Cell<u32>,
    }

    struct PostDispatchInspectFailure {
        inspections: Cell<u32>,
        restarts: Cell<u32>,
    }

    impl SystemdSource for PostDispatchInspectFailure {
        fn inspect(&self, _unit_name: &str) -> Result<UnitSnapshot, ProviderError> {
            let count = self.inspections.get();
            self.inspections.set(count + 1);
            if count == 0 {
                Ok(safe_snapshot())
            } else {
                Err(ProviderError::new("service_status_unavailable", false))
            }
        }

        fn restart(&self, _unit_name: &str) -> Result<(), ProviderError> {
            self.restarts.set(self.restarts.get() + 1);
            Ok(())
        }
    }

    impl SystemdSource for FakeSource {
        fn inspect(&self, _unit_name: &str) -> Result<UnitSnapshot, ProviderError> {
            Ok(self.snapshot.clone())
        }

        fn restart(&self, _unit_name: &str) -> Result<(), ProviderError> {
            self.restarts.set(self.restarts.get() + 1);
            Ok(())
        }
    }

    #[test]
    fn privilege_only_definition_change_changes_digest() {
        let first = safe_snapshot();
        let mut second = first.clone();
        second
            .definition_properties
            .insert("User".to_string(), "soma-lab-user".to_string());
        assert_ne!(
            effective_definition_digest(&first).unwrap(),
            effective_definition_digest(&second).unwrap()
        );
    }

    #[test]
    fn environment_file_directive_is_hashed_without_file_contents() {
        let mut first = safe_snapshot();
        first.definition_properties.insert(
            "EnvironmentFiles".to_string(),
            "-/run/secrets/alpha".to_string(),
        );
        let mut second = first.clone();
        second.definition_properties.insert(
            "EnvironmentFiles".to_string(),
            "-/run/secrets/beta".to_string(),
        );
        assert_ne!(
            effective_definition_digest(&first).unwrap(),
            effective_definition_digest(&second).unwrap()
        );
    }

    #[test]
    fn nonempty_reverse_relation_refuses_target_only_closure() {
        let mut snapshot = safe_snapshot();
        snapshot
            .closure_properties
            .insert("BoundBy".to_string(), vec!["other.service".to_string()]);
        assert_eq!(
            affected_closure(&snapshot).unwrap_err().code,
            "service_unit_dependency_closure_unsafe"
        );
    }

    #[test]
    fn ordinary_forward_requires_does_not_expand_restart_affected_set() {
        let mut snapshot = safe_snapshot();
        snapshot
            .closure_properties
            .insert("Requires".to_string(), vec!["system.slice".to_string()]);
        assert_eq!(affected_closure(&snapshot).unwrap(), "target_only");
    }

    #[test]
    fn inactive_restart_refuses_before_dispatch() {
        let mut snapshot = safe_snapshot();
        snapshot.active_state = "inactive".to_string();
        snapshot.sub_state = "dead".to_string();
        let source = FakeSource {
            snapshot,
            restarts: Cell::new(0),
        };
        let response = execute(&inventory(), &request(Method::RestartApply), &source);
        assert!(!response.ok);
        assert_eq!(
            response.error.unwrap().code,
            "service_restart_prestate_unsupported"
        );
        assert_eq!(source.restarts.get(), 0);
    }

    #[test]
    fn provider_response_contains_no_raw_identity_or_content() {
        let source = FakeSource {
            snapshot: safe_snapshot(),
            restarts: Cell::new(0),
        };
        let serialized = serde_json::to_string(&execute(
            &inventory(),
            &request(Method::StatusRead),
            &source,
        ))
        .unwrap();
        for forbidden in [
            "soma-lab-restart-proof.service",
            "/usr/bin/sleep",
            "CANARY_SECRET",
            "FragmentPath",
            "EnvironmentFile",
        ] {
            assert!(!serialized.contains(forbidden));
        }
    }

    fn inventory() -> Inventory {
        Inventory {
            schema_version: 1,
            activation_status: "disabled".to_string(),
            restart_enabled: true,
            controlled_testing: true,
            units: vec![InventoryUnit {
                inventory_id: "lab-proof".to_string(),
                unit_name: "soma-lab-restart-proof.service".to_string(),
            }],
        }
    }

    #[test]
    fn disabled_inventory_refuses_restart_before_inspection_or_dispatch() {
        let mut inventory = inventory();
        inventory.restart_enabled = false;
        let source = FakeSource {
            snapshot: safe_snapshot(),
            restarts: Cell::new(0),
        };
        let response = execute(&inventory, &request(Method::RestartApply), &source);
        assert!(!response.ok);
        assert_eq!(
            response.error.unwrap().code,
            "service_restart_provider_refused"
        );
        assert_eq!(source.restarts.get(), 0);
    }

    #[test]
    fn post_dispatch_inspection_failure_is_always_ambiguous() {
        let source = PostDispatchInspectFailure {
            inspections: Cell::new(0),
            restarts: Cell::new(0),
        };
        let response = execute(&inventory(), &request(Method::RestartApply), &source);
        assert!(!response.ok);
        let error = response.error.unwrap();
        assert_eq!(error.code, "service_status_unavailable");
        assert!(error.ambiguous);
        assert_eq!(source.restarts.get(), 1);
    }

    fn request(method: Method) -> Request {
        Request {
            request_id: "request-1".to_string(),
            method,
            inventory_id: "lab-proof".to_string(),
        }
    }

    fn safe_snapshot() -> UnitSnapshot {
        let definition_properties = DEFINITION_PROPERTIES
            .iter()
            .map(|property| ((*property).to_string(), String::new()))
            .collect();
        let closure_properties = CLOSURE_PROPERTIES
            .iter()
            .map(|property| ((*property).to_string(), Vec::new()))
            .collect();
        UnitSnapshot {
            load_state: "loaded".to_string(),
            active_state: "active".to_string(),
            sub_state: "running".to_string(),
            unit_file_state: "enabled".to_string(),
            can_start: true,
            invocation_id: vec![1; 16],
            active_enter_timestamp_monotonic: 42,
            definition_properties,
            fragment_contents: b"[Service]\nExecStart=/usr/bin/sleep infinity\n".to_vec(),
            drop_in_contents: BTreeMap::new(),
            closure_properties,
            socket_activated: false,
            dbus_activated: false,
        }
    }
}
