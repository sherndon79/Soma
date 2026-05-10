use std::collections::{HashSet, VecDeque};
use std::env;
use std::path::Path;
use std::process::{Command, ExitCode};

const MAX_APPLICATIONS: usize = 64;
const MAX_ROOT_CHILD_REFS: usize = 8;
const MAX_ROOT_CHILD_METADATA: usize = 4;
const MAX_TRAVERSAL_DEPTH: usize = 4;
const MAX_TRAVERSAL_NODES: usize = 256;
const MAX_TRAVERSAL_CHILDREN_PER_NODE: usize = 32;

fn main() -> ExitCode {
    let mut args = env::args().skip(1);
    match args.next().as_deref() {
        Some("inspect-environment") => {
            println!("{}", inspect_environment_json());
            ExitCode::SUCCESS
        }
        Some("inspect-atspi") => match AtspiLimits::parse(args) {
            Ok(limits) => {
                println!("{}", inspect_atspi_json(limits));
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("{error}");
                ExitCode::from(2)
            }
        },
        Some("inspect-focus") => {
            println!("{}", inspect_focus_json());
            ExitCode::SUCCESS
        }
        Some("inspect-atspi-traversal") => match TraversalArgs::parse(args) {
            Ok(args) => {
                println!("{}", inspect_atspi_traversal_json(&args));
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("{error}");
                ExitCode::from(2)
            }
        },
        Some("help") | Some("--help") | None => {
            eprintln!("usage: soma-desktop-broker inspect-environment|inspect-atspi|inspect-focus|inspect-atspi-traversal");
            ExitCode::SUCCESS
        }
        Some(command) => {
            eprintln!("unknown command: {command}");
            ExitCode::from(2)
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct TraversalArgs {
    root_service: String,
    root_path: String,
    max_depth: usize,
    max_nodes: usize,
    max_children_per_node: usize,
}

impl TraversalArgs {
    fn parse<I>(args: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = String>,
    {
        let mut root_service = None;
        let mut root_path = None;
        let mut max_depth = None;
        let mut max_nodes = None;
        let mut max_children_per_node = None;
        let mut args = args.into_iter();
        while let Some(flag) = args.next() {
            let value = args
                .next()
                .ok_or_else(|| format!("{flag} requires a value"))?;
            match flag.as_str() {
                "--root-service" => root_service = Some(parse_non_empty_string(&flag, &value)?),
                "--root-path" => root_path = Some(parse_non_empty_string(&flag, &value)?),
                "--max-depth" => {
                    max_depth = Some(parse_limit(&flag, &value, 1, MAX_TRAVERSAL_DEPTH)?);
                }
                "--max-nodes" => {
                    max_nodes = Some(parse_limit(&flag, &value, 1, MAX_TRAVERSAL_NODES)?);
                }
                "--max-children-per-node" => {
                    max_children_per_node = Some(parse_limit(
                        &flag,
                        &value,
                        1,
                        MAX_TRAVERSAL_CHILDREN_PER_NODE,
                    )?);
                }
                _ => return Err(format!("unknown inspect-atspi-traversal option: {flag}")),
            }
        }
        Ok(Self {
            root_service: root_service.ok_or("--root-service is required")?,
            root_path: root_path.ok_or("--root-path is required")?,
            max_depth: max_depth.ok_or("--max-depth is required")?,
            max_nodes: max_nodes.ok_or("--max-nodes is required")?,
            max_children_per_node: max_children_per_node
                .ok_or("--max-children-per-node is required")?,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct AtspiLimits {
    max_applications: usize,
    max_root_child_refs: usize,
    max_root_child_metadata: usize,
}

impl Default for AtspiLimits {
    fn default() -> Self {
        Self {
            max_applications: MAX_APPLICATIONS,
            max_root_child_refs: MAX_ROOT_CHILD_REFS,
            max_root_child_metadata: MAX_ROOT_CHILD_METADATA,
        }
    }
}

impl AtspiLimits {
    fn parse<I>(args: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = String>,
    {
        let mut limits = Self::default();
        let mut args = args.into_iter();
        while let Some(flag) = args.next() {
            let value = args
                .next()
                .ok_or_else(|| format!("{flag} requires a value"))?;
            match flag.as_str() {
                "--max-applications" => {
                    limits.max_applications = parse_limit(&flag, &value, 1, MAX_APPLICATIONS)?;
                }
                "--max-root-child-refs" => {
                    limits.max_root_child_refs =
                        parse_limit(&flag, &value, 0, MAX_ROOT_CHILD_REFS)?;
                }
                "--max-root-child-metadata" => {
                    limits.max_root_child_metadata =
                        parse_limit(&flag, &value, 0, MAX_ROOT_CHILD_METADATA)?;
                }
                _ => return Err(format!("unknown inspect-atspi option: {flag}")),
            }
        }
        Ok(limits)
    }
}

fn parse_limit(flag: &str, value: &str, minimum: usize, maximum: usize) -> Result<usize, String> {
    let parsed = value
        .parse::<usize>()
        .map_err(|_| format!("{flag} must be an integer from {minimum} to {maximum}"))?;
    if parsed < minimum || parsed > maximum {
        return Err(format!(
            "{flag} must be an integer from {minimum} to {maximum}"
        ));
    }
    Ok(parsed)
}

fn parse_non_empty_string(flag: &str, value: &str) -> Result<String, String> {
    if value.is_empty() {
        return Err(format!("{flag} must be a non-empty string"));
    }
    Ok(value.to_string())
}

fn inspect_focus_json() -> String {
    let desktop_session = env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
    let session_type = env::var("XDG_SESSION_TYPE").unwrap_or_default();
    let dbus_session_bus_available = env::var("DBUS_SESSION_BUS_ADDRESS").is_ok();

    if !command_exists("busctl") {
        return focus_unavailable_json(&desktop_session, &session_type, "busctl_not_found");
    }

    let Some(address) = get_atspi_bus_address() else {
        return focus_unavailable_json(
            &desktop_session,
            &session_type,
            "atspi_bus_address_unavailable",
        );
    };

    let list_output = Command::new("busctl")
        .args(["--address", &address, "list", "--no-legend", "--no-pager"])
        .output();
    let Ok(list_output) = list_output else {
        return focus_unavailable_json(
            &desktop_session,
            &session_type,
            "atspi_bus_list_command_failed",
        );
    };
    if !list_output.status.success() {
        return focus_unavailable_json(
            &desktop_session,
            &session_type,
            "atspi_bus_list_unavailable",
        );
    }

    let list_stdout = String::from_utf8_lossy(&list_output.stdout);
    for application in parse_atspi_bus_list(&list_stdout, MAX_APPLICATIONS) {
        if application.registry || !application.service.starts_with(':') {
            continue;
        }
        if let Ok(focused_object) =
            inspect_focused_object_for_application(&address, &application.service)
        {
            return focused_object_json(
                &desktop_session,
                &session_type,
                dbus_session_bus_available,
                &focused_object,
            );
        }
    }

    focus_unavailable_json(
        &desktop_session,
        &session_type,
        "active_descendant_unavailable",
    )
}

fn focus_unavailable_json(
    desktop_session: &str,
    session_type: &str,
    unavailable_reason: &str,
) -> String {
    format!(
        concat!(
            "{{",
            "\"mode\":\"read_only_focused_object_probe\",",
            "\"broker_source\":\"rust_helper\",",
            "\"platform\":\"{}\",",
            "\"release\":\"{}\",",
            "\"desktop_session\":\"{}\",",
            "\"session_type\":\"{}\",",
            "\"focus_available\":false,",
            "\"focused_object\":null,",
            "\"unavailable_reason\":\"{}\",",
            "\"text_content_included\":false,",
            "\"withheld_fields\":[\"name\",\"description\",\"text\",\"states\",\"actions\"]",
            "}}"
        ),
        json_escape(env::consts::OS),
        json_escape(&kernel_release()),
        json_escape(desktop_session),
        json_escape(session_type),
        json_escape(unavailable_reason),
    )
}

fn inspect_environment_json() -> String {
    let desktop_session = env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
    let session_type = env::var("XDG_SESSION_TYPE").unwrap_or_default();
    let wayland_display_present = env::var("WAYLAND_DISPLAY").is_ok();
    let x11_display_present = env::var("DISPLAY").is_ok();
    let dbus_session_bus_available = env::var("DBUS_SESSION_BUS_ADDRESS").is_ok();
    let gdbus = command_exists("gdbus");
    let busctl = command_exists("busctl");
    let qdbus = command_exists("qdbus");
    let wtype = command_exists("wtype");
    let ydotool = command_exists("ydotool");
    let atspi_likely_available =
        dbus_session_bus_available && (wayland_display_present || x11_display_present);
    let desktop_lower = desktop_session.to_lowercase();
    let kde_kwin = desktop_lower.contains("kde") && (qdbus || busctl);

    format!(
        concat!(
            "{{",
            "\"mode\":\"read_only_environment_probe\",",
            "\"broker_source\":\"rust_helper\",",
            "\"platform\":\"{}\",",
            "\"release\":\"{}\",",
            "\"desktop_session\":\"{}\",",
            "\"session_type\":\"{}\",",
            "\"wayland_display_present\":{},",
            "\"x11_display_present\":{},",
            "\"dbus_session_bus_available\":{},",
            "\"atspi_likely_available\":{},",
            "\"candidate_adapters\":{{",
            "\"atspi_dbus\":{},",
            "\"kde_kwin\":{},",
            "\"xdg_desktop_portal\":{},",
            "\"wayland_keyboard_input\":{},",
            "\"uinput_input\":{}",
            "}},",
            "\"commands\":{{",
            "\"gdbus\":{},",
            "\"busctl\":{},",
            "\"qdbus\":{},",
            "\"wtype\":{},",
            "\"ydotool\":{}",
            "}},",
            "\"tree\":null,",
            "\"tree_available\":false",
            "}}"
        ),
        json_escape(env::consts::OS),
        json_escape(&kernel_release()),
        json_escape(&desktop_session),
        json_escape(&session_type),
        wayland_display_present,
        x11_display_present,
        dbus_session_bus_available,
        atspi_likely_available,
        gdbus || busctl,
        kde_kwin,
        dbus_session_bus_available,
        wtype,
        ydotool,
        gdbus,
        busctl,
        qdbus,
        wtype,
        ydotool,
    )
}

fn inspect_atspi_json(limits: AtspiLimits) -> String {
    let desktop_session = env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
    let session_type = env::var("XDG_SESSION_TYPE").unwrap_or_default();
    let dbus_session_bus_available = env::var("DBUS_SESSION_BUS_ADDRESS").is_ok();

    if !command_exists("busctl") {
        return atspi_unavailable_json(
            &desktop_session,
            &session_type,
            dbus_session_bus_available,
            "busctl_not_found",
            "",
        );
    }

    let Some(address) = get_atspi_bus_address() else {
        return atspi_unavailable_json(
            &desktop_session,
            &session_type,
            dbus_session_bus_available,
            "atspi_bus_address_unavailable",
            "",
        );
    };

    let list_output = Command::new("busctl")
        .args(["--address", &address, "list", "--no-legend", "--no-pager"])
        .output();
    let list_output = match list_output {
        Ok(output) if output.status.success() => output,
        Ok(output) => {
            return atspi_unavailable_json(
                &desktop_session,
                &session_type,
                dbus_session_bus_available,
                "atspi_bus_list_unavailable",
                &command_error(&output),
            );
        }
        Err(error) => {
            return atspi_unavailable_json(
                &desktop_session,
                &session_type,
                dbus_session_bus_available,
                "atspi_bus_list_command_failed",
                &error.to_string(),
            );
        }
    };

    let list_stdout = String::from_utf8_lossy(&list_output.stdout);
    let applications = parse_atspi_bus_list(&list_stdout, limits.max_applications)
        .into_iter()
        .map(|application| application.with_root_object(&address, limits))
        .collect::<Vec<_>>();
    let root_object_count = applications
        .iter()
        .filter(|application| application.root_object_available())
        .count();
    let applications_json = applications
        .iter()
        .map(|application| application.to_json())
        .collect::<Vec<_>>()
        .join(",");

    format!(
        concat!(
            "{{",
            "\"mode\":\"read_only_atspi_probe\",",
            "\"broker_source\":\"rust_helper\",",
            "\"platform\":\"{}\",",
            "\"release\":\"{}\",",
            "\"desktop_session\":\"{}\",",
            "\"session_type\":\"{}\",",
            "\"dbus_session_bus_available\":{},",
            "\"atspi_likely_available\":true,",
            "\"atspi_bus_address_available\":true,",
            "\"application_count\":{},",
            "\"root_object_available_count\":{},",
            "\"window_count\":0,",
            "\"tree\":{{",
            "\"applications\":[{}],",
            "\"windows\":[],",
            "\"bounded\":true,",
            "\"text_content_included\":false",
            "}},",
            "\"tree_available\":true",
            "}}"
        ),
        json_escape(env::consts::OS),
        json_escape(&kernel_release()),
        json_escape(&desktop_session),
        json_escape(&session_type),
        dbus_session_bus_available,
        applications.len(),
        root_object_count,
        applications_json,
    )
}

fn atspi_unavailable_json(
    desktop_session: &str,
    session_type: &str,
    dbus_session_bus_available: bool,
    unavailable_reason: &str,
    diagnostic: &str,
) -> String {
    format!(
        concat!(
            "{{",
            "\"mode\":\"read_only_atspi_probe\",",
            "\"broker_source\":\"rust_helper\",",
            "\"platform\":\"{}\",",
            "\"release\":\"{}\",",
            "\"desktop_session\":\"{}\",",
            "\"session_type\":\"{}\",",
            "\"dbus_session_bus_available\":{},",
            "\"atspi_likely_available\":{},",
            "\"atspi_bus_address_available\":false,",
            "\"application_count\":0,",
            "\"root_object_available_count\":0,",
            "\"window_count\":0,",
            "\"tree\":null,",
            "\"tree_available\":false,",
            "\"unavailable_reason\":\"{}\",",
            "\"diagnostic\":\"{}\"",
            "}}"
        ),
        json_escape(env::consts::OS),
        json_escape(&kernel_release()),
        json_escape(desktop_session),
        json_escape(session_type),
        dbus_session_bus_available,
        dbus_session_bus_available,
        json_escape(unavailable_reason),
        json_escape(diagnostic),
    )
}

fn kernel_release() -> String {
    Command::new("uname")
        .arg("-r")
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|release| release.trim().to_string())
        .unwrap_or_default()
}

fn command_exists(name: &str) -> bool {
    env::var_os("PATH")
        .map(|paths| {
            env::split_paths(&paths).any(|directory| Path::new(&directory).join(name).is_file())
        })
        .unwrap_or(false)
}

struct AtspiApplication {
    service: String,
    pid: Option<u32>,
    process: String,
    registry: bool,
    root_object: Option<AtspiRootObject>,
    root_object_error: Option<String>,
}

impl AtspiApplication {
    fn with_root_object(mut self, address: &str, limits: AtspiLimits) -> Self {
        if !self.service.starts_with(':') {
            return self;
        }

        match inspect_root_object(address, &self.service, limits) {
            Ok(root_object) => {
                self.root_object = Some(root_object);
            }
            Err(error) => {
                self.root_object_error = Some(error);
            }
        }
        self
    }

    fn root_object_available(&self) -> bool {
        self.root_object.is_some()
    }

    fn to_json(&self) -> String {
        let root_object_json = self
            .root_object
            .as_ref()
            .map(|root_object| root_object.to_json())
            .unwrap_or_else(|| "null".to_string());
        let root_object_error_json = self
            .root_object_error
            .as_ref()
            .map(|error| format!("\"{}\"", json_escape(error)))
            .unwrap_or_else(|| "null".to_string());

        format!(
            concat!(
                "{{",
                "\"service\":\"{}\",",
                "\"pid\":{},",
                "\"process\":\"{}\",",
                "\"registry\":{},",
                "\"root_object\":{},",
                "\"root_object_error\":{}",
                "}}"
            ),
            json_escape(&self.service),
            self.pid
                .map(|pid| pid.to_string())
                .unwrap_or_else(|| "null".to_string()),
            json_escape(&self.process),
            self.registry,
            root_object_json,
            root_object_error_json,
        )
    }
}

struct AtspiRootObject {
    name: String,
    role: String,
    child_count: i32,
    children_sample: Vec<AtspiObjectRef>,
    child_metadata_sample: Vec<AtspiChildMetadata>,
}

impl AtspiRootObject {
    fn to_json(&self) -> String {
        let children_json = self
            .children_sample
            .iter()
            .map(|child| child.to_json())
            .collect::<Vec<_>>()
            .join(",");
        let child_metadata_json = self
            .child_metadata_sample
            .iter()
            .map(|child| child.to_json())
            .collect::<Vec<_>>()
            .join(",");
        format!(
            concat!(
                "{{",
                "\"path\":\"/org/a11y/atspi/accessible/root\",",
                "\"name\":\"{}\",",
                "\"role\":\"{}\",",
                "\"child_count\":{},",
                "\"children_sample\":[{}],",
                "\"child_metadata_sample\":[{}]",
                "}}"
            ),
            json_escape(&self.name),
            json_escape(&self.role),
            self.child_count,
            children_json,
            child_metadata_json,
        )
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct AtspiObjectRef {
    service: String,
    path: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct AtspiTraversalLimits {
    max_depth: usize,
    max_nodes: usize,
    max_children_per_node: usize,
}

impl From<&TraversalArgs> for AtspiTraversalLimits {
    fn from(args: &TraversalArgs) -> Self {
        Self {
            max_depth: args.max_depth,
            max_nodes: args.max_nodes,
            max_children_per_node: args.max_children_per_node,
        }
    }
}

struct AtspiTraversalResult {
    root: AtspiObjectRef,
    nodes: Vec<AtspiTraversalNode>,
    limits: AtspiTraversalLimits,
    truncated: bool,
    unavailable_reason: Option<String>,
}

impl AtspiTraversalResult {
    #[allow(dead_code)]
    fn unavailable(
        root: AtspiObjectRef,
        limits: AtspiTraversalLimits,
        unavailable_reason: &str,
    ) -> Self {
        Self {
            root,
            nodes: Vec::new(),
            limits,
            truncated: false,
            unavailable_reason: Some(unavailable_reason.to_string()),
        }
    }

    fn to_json(&self) -> String {
        let nodes_json = self
            .nodes
            .iter()
            .map(|node| node.to_json())
            .collect::<Vec<_>>()
            .join(",");
        let unavailable_reason_json = self
            .unavailable_reason
            .as_ref()
            .map(|reason| format!("\"unavailable_reason\":\"{}\",", json_escape(reason)))
            .unwrap_or_default();
        format!(
            concat!(
                "{{",
                "\"root\":{},",
                "\"nodes\":[{}],",
                "\"limits\":{{",
                "\"max_depth\":{},",
                "\"max_nodes\":{},",
                "\"max_children_per_node\":{}",
                "}},",
                "\"truncated\":{},",
                "{}",
                "\"text_content_included\":false,",
                "\"withheld_fields\":[\"name\",\"description\",\"text\",\"states\",\"actions\"]",
                "}}"
            ),
            self.root.to_json(),
            nodes_json,
            self.limits.max_depth,
            self.limits.max_nodes,
            self.limits.max_children_per_node,
            self.truncated,
            unavailable_reason_json,
        )
    }
}

#[derive(Clone)]
struct AtspiTraversalObservation {
    object_ref: AtspiObjectRef,
    role: String,
    child_count: i32,
    children: Vec<AtspiObjectRef>,
}

fn build_bounded_traversal<F>(
    root: AtspiObjectRef,
    limits: AtspiTraversalLimits,
    mut query: F,
) -> AtspiTraversalResult
where
    F: FnMut(&AtspiObjectRef) -> Result<AtspiTraversalObservation, String>,
{
    let mut truncated = false;
    let mut nodes = Vec::new();
    let mut queue = VecDeque::from([(root.clone(), 0usize, "n0".to_string())]);
    let mut reserved_nodes = 1usize;
    let mut next_id = 1usize;

    while let Some((object_ref, depth, id)) = queue.pop_front() {
        let observation = match query(&object_ref) {
            Ok(observation) => observation,
            Err(_) => {
                truncated = true;
                continue;
            }
        };

        let mut child_ids = Vec::new();
        if depth >= limits.max_depth {
            if !observation.children.is_empty() {
                truncated = true;
            }
        } else {
            if observation.children.len() > limits.max_children_per_node {
                truncated = true;
            }
            for child in observation
                .children
                .iter()
                .take(limits.max_children_per_node)
            {
                if reserved_nodes >= limits.max_nodes {
                    truncated = true;
                    break;
                }
                let child_id = format!("n{next_id}");
                next_id += 1;
                reserved_nodes += 1;
                child_ids.push(child_id.clone());
                queue.push_back((child.clone(), depth + 1, child_id));
            }
        }

        nodes.push(AtspiTraversalNode {
            id,
            object_ref: observation.object_ref,
            role: observation.role,
            child_count: observation.child_count,
            depth,
            children: child_ids,
        });
    }

    let included_ids = nodes
        .iter()
        .map(|node| node.id.clone())
        .collect::<HashSet<_>>();
    for node in &mut nodes {
        node.children.retain(|child| included_ids.contains(child));
    }

    AtspiTraversalResult {
        root,
        nodes,
        limits,
        truncated,
        unavailable_reason: None,
    }
}

fn inspect_atspi_traversal_json(args: &TraversalArgs) -> String {
    build_atspi_traversal_command_output(
        args,
        get_atspi_bus_address,
        |address, object_ref, max_children| {
            inspect_traversal_observation(address, object_ref, max_children)
        },
    )
}

fn build_atspi_traversal_command_output<A, Q>(
    args: &TraversalArgs,
    mut get_address: A,
    mut query: Q,
) -> String
where
    A: FnMut() -> Option<String>,
    Q: FnMut(&str, &AtspiObjectRef, usize) -> Result<AtspiTraversalObservation, String>,
{
    let root = AtspiObjectRef {
        service: args.root_service.clone(),
        path: args.root_path.clone(),
    };
    let limits = AtspiTraversalLimits::from(args);
    let Some(address) = get_address() else {
        return AtspiTraversalResult::unavailable(root, limits, "atspi_bus_address_unavailable")
            .to_json();
    };
    let result = build_bounded_traversal(root, limits, |object_ref| {
        query(&address, object_ref, limits.max_children_per_node)
    });
    result.to_json()
}

#[allow(dead_code)]
fn build_traversal_from_args<F>(args: &TraversalArgs, mut query: F) -> AtspiTraversalResult
where
    F: FnMut(&AtspiObjectRef, usize) -> Result<AtspiTraversalObservation, String>,
{
    let root = AtspiObjectRef {
        service: args.root_service.clone(),
        path: args.root_path.clone(),
    };
    let limits = AtspiTraversalLimits::from(args);
    build_bounded_traversal(root, limits, |object_ref| {
        query(object_ref, limits.max_children_per_node)
    })
}

#[allow(dead_code)]
fn inspect_traversal_observation(
    address: &str,
    object_ref: &AtspiObjectRef,
    max_children: usize,
) -> Result<AtspiTraversalObservation, String> {
    const ACCESSIBLE_INTERFACE: &str = "org.a11y.atspi.Accessible";

    let role_output = busctl_output(&[
        "--address",
        address,
        "call",
        &object_ref.service,
        &object_ref.path,
        ACCESSIBLE_INTERFACE,
        "GetRoleName",
    ])?;
    let child_count_output = busctl_output(&[
        "--address",
        address,
        "get-property",
        &object_ref.service,
        &object_ref.path,
        ACCESSIBLE_INTERFACE,
        "ChildCount",
    ])?;
    let children_output = busctl_output(&[
        "--address",
        address,
        "call",
        &object_ref.service,
        &object_ref.path,
        ACCESSIBLE_INTERFACE,
        "GetChildren",
    ])?;

    Ok(traversal_observation_from_outputs(
        object_ref,
        &role_output,
        &child_count_output,
        &children_output,
        max_children,
    ))
}

fn traversal_observation_from_outputs(
    object_ref: &AtspiObjectRef,
    role_output: &str,
    child_count_output: &str,
    children_output: &str,
    max_children: usize,
) -> AtspiTraversalObservation {
    AtspiTraversalObservation {
        object_ref: object_ref.clone(),
        role: parse_busctl_string(role_output).unwrap_or_default(),
        child_count: parse_busctl_int(child_count_output).unwrap_or(0),
        children: parse_atspi_object_refs(children_output, max_children),
    }
}

struct AtspiTraversalNode {
    id: String,
    object_ref: AtspiObjectRef,
    role: String,
    child_count: i32,
    depth: usize,
    children: Vec<String>,
}

impl AtspiTraversalNode {
    fn to_json(&self) -> String {
        let children_json = self
            .children
            .iter()
            .map(|child| format!("\"{}\"", json_escape(child)))
            .collect::<Vec<_>>()
            .join(",");
        format!(
            concat!(
                "{{",
                "\"id\":\"{}\",",
                "\"service\":\"{}\",",
                "\"path\":\"{}\",",
                "\"role\":\"{}\",",
                "\"child_count\":{},",
                "\"depth\":{},",
                "\"children\":[{}]",
                "}}"
            ),
            json_escape(&self.id),
            json_escape(&self.object_ref.service),
            json_escape(&self.object_ref.path),
            json_escape(&self.role),
            self.child_count,
            self.depth,
            children_json,
        )
    }
}

struct AtspiFocusedObject {
    object_ref: AtspiObjectRef,
    role: String,
    child_count: i32,
    application: AtspiObjectRef,
}

struct AtspiChildMetadata {
    service: String,
    path: String,
    role: String,
    child_count: i32,
}

impl AtspiChildMetadata {
    fn to_json(&self) -> String {
        format!(
            concat!(
                "{{",
                "\"service\":\"{}\",",
                "\"path\":\"{}\",",
                "\"role\":\"{}\",",
                "\"child_count\":{}",
                "}}"
            ),
            json_escape(&self.service),
            json_escape(&self.path),
            json_escape(&self.role),
            self.child_count,
        )
    }
}

impl AtspiObjectRef {
    fn to_json(&self) -> String {
        format!(
            "{{\"service\":\"{}\",\"path\":\"{}\"}}",
            json_escape(&self.service),
            json_escape(&self.path),
        )
    }
}

fn parse_atspi_bus_list(value: &str, limit: usize) -> Vec<AtspiApplication> {
    value
        .lines()
        .filter_map(parse_atspi_bus_list_line)
        .take(limit)
        .collect()
}

fn parse_atspi_bus_list_line(line: &str) -> Option<AtspiApplication> {
    let mut fields = line.split_whitespace();
    let service = fields.next()?.to_string();
    let pid = fields.next().and_then(|pid| {
        if pid == "-" {
            None
        } else {
            pid.parse::<u32>().ok()
        }
    });
    let process = fields.next().unwrap_or("").to_string();
    let registry = service == "org.a11y.atspi.Registry";

    Some(AtspiApplication {
        service,
        pid,
        process,
        registry,
        root_object: None,
        root_object_error: None,
    })
}

fn get_atspi_bus_address() -> Option<String> {
    let address_output = Command::new("busctl")
        .args([
            "--user",
            "call",
            "org.a11y.Bus",
            "/org/a11y/bus",
            "org.a11y.Bus",
            "GetAddress",
        ])
        .output()
        .ok()?;
    if !address_output.status.success() {
        return None;
    }
    parse_busctl_string(&String::from_utf8_lossy(&address_output.stdout))
}

fn inspect_root_object(
    address: &str,
    service: &str,
    limits: AtspiLimits,
) -> Result<AtspiRootObject, String> {
    const ROOT_PATH: &str = "/org/a11y/atspi/accessible/root";
    const ACCESSIBLE_INTERFACE: &str = "org.a11y.atspi.Accessible";

    let name_output = busctl_output(&[
        "--address",
        address,
        "get-property",
        service,
        ROOT_PATH,
        ACCESSIBLE_INTERFACE,
        "Name",
    ])?;
    let role_output = busctl_output(&[
        "--address",
        address,
        "call",
        service,
        ROOT_PATH,
        ACCESSIBLE_INTERFACE,
        "GetRoleName",
    ])?;
    let child_count_output = busctl_output(&[
        "--address",
        address,
        "get-property",
        service,
        ROOT_PATH,
        ACCESSIBLE_INTERFACE,
        "ChildCount",
    ])?;
    let children_output = busctl_output(&[
        "--address",
        address,
        "call",
        service,
        ROOT_PATH,
        ACCESSIBLE_INTERFACE,
        "GetChildren",
    ])
    .unwrap_or_default();

    let children_sample = parse_atspi_object_refs(&children_output, limits.max_root_child_refs);
    let child_metadata_sample = children_sample
        .iter()
        .take(limits.max_root_child_metadata)
        .filter_map(|child| inspect_child_metadata(address, child).ok())
        .collect();

    Ok(AtspiRootObject {
        name: parse_busctl_string(&name_output).unwrap_or_default(),
        role: parse_busctl_string(&role_output).unwrap_or_default(),
        child_count: parse_busctl_int(&child_count_output).unwrap_or(0),
        children_sample,
        child_metadata_sample,
    })
}

fn inspect_focused_object_for_application(
    address: &str,
    service: &str,
) -> Result<AtspiFocusedObject, String> {
    const ROOT_PATH: &str = "/org/a11y/atspi/accessible/root";
    const COLLECTION_INTERFACE: &str = "org.a11y.atspi.Collection";
    const ACCESSIBLE_INTERFACE: &str = "org.a11y.atspi.Accessible";

    let active_descendant_output = busctl_output(&[
        "--address",
        address,
        "call",
        service,
        ROOT_PATH,
        COLLECTION_INTERFACE,
        "GetActiveDescendant",
    ])?;
    let Some(object_ref) = parse_first_atspi_object_ref(&active_descendant_output) else {
        return Err("active_descendant_missing".to_string());
    };
    if object_ref.path == "/org/a11y/atspi/null" || object_ref.service.is_empty() {
        return Err("active_descendant_null".to_string());
    }

    let role_output = busctl_output(&[
        "--address",
        address,
        "call",
        &object_ref.service,
        &object_ref.path,
        ACCESSIBLE_INTERFACE,
        "GetRoleName",
    ])?;
    let child_count_output = busctl_output(&[
        "--address",
        address,
        "get-property",
        &object_ref.service,
        &object_ref.path,
        ACCESSIBLE_INTERFACE,
        "ChildCount",
    ])?;

    Ok(AtspiFocusedObject {
        object_ref,
        role: parse_busctl_string(&role_output).unwrap_or_default(),
        child_count: parse_busctl_int(&child_count_output).unwrap_or(0),
        application: AtspiObjectRef {
            service: service.to_string(),
            path: ROOT_PATH.to_string(),
        },
    })
}

fn focused_object_json(
    desktop_session: &str,
    session_type: &str,
    dbus_session_bus_available: bool,
    focused_object: &AtspiFocusedObject,
) -> String {
    format!(
        concat!(
            "{{",
            "\"mode\":\"read_only_focused_object_probe\",",
            "\"broker_source\":\"rust_helper\",",
            "\"platform\":\"{}\",",
            "\"release\":\"{}\",",
            "\"desktop_session\":\"{}\",",
            "\"session_type\":\"{}\",",
            "\"dbus_session_bus_available\":{},",
            "\"focus_available\":true,",
            "\"focused_object\":{{",
            "\"service\":\"{}\",",
            "\"path\":\"{}\",",
            "\"role\":\"{}\",",
            "\"child_count\":{},",
            "\"application\":{{",
            "\"service\":\"{}\",",
            "\"path\":\"{}\"",
            "}}",
            "}},",
            "\"text_content_included\":false,",
            "\"withheld_fields\":[\"name\",\"description\",\"text\",\"states\",\"actions\"]",
            "}}"
        ),
        json_escape(env::consts::OS),
        json_escape(&kernel_release()),
        json_escape(desktop_session),
        json_escape(session_type),
        dbus_session_bus_available,
        json_escape(&focused_object.object_ref.service),
        json_escape(&focused_object.object_ref.path),
        json_escape(&focused_object.role),
        focused_object.child_count,
        json_escape(&focused_object.application.service),
        json_escape(&focused_object.application.path),
    )
}

fn inspect_child_metadata(
    address: &str,
    child: &AtspiObjectRef,
) -> Result<AtspiChildMetadata, String> {
    const ACCESSIBLE_INTERFACE: &str = "org.a11y.atspi.Accessible";

    let role_output = busctl_output(&[
        "--address",
        address,
        "call",
        &child.service,
        &child.path,
        ACCESSIBLE_INTERFACE,
        "GetRoleName",
    ])?;
    let child_count_output = busctl_output(&[
        "--address",
        address,
        "get-property",
        &child.service,
        &child.path,
        ACCESSIBLE_INTERFACE,
        "ChildCount",
    ])?;

    Ok(AtspiChildMetadata {
        service: child.service.clone(),
        path: child.path.clone(),
        role: parse_busctl_string(&role_output).unwrap_or_default(),
        child_count: parse_busctl_int(&child_count_output).unwrap_or(0),
    })
}

fn busctl_output(args: &[&str]) -> Result<String, String> {
    let output = Command::new("busctl")
        .args(args)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(command_error(&output));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn parse_busctl_string(value: &str) -> Option<String> {
    let first_quote = value.find('"')?;
    let mut escaped = false;
    let mut result = String::new();
    for character in value[first_quote + 1..].chars() {
        if escaped {
            result.push(character);
            escaped = false;
            continue;
        }
        match character {
            '\\' => escaped = true,
            '"' => return Some(result),
            character => result.push(character),
        }
    }
    None
}

fn parse_busctl_int(value: &str) -> Option<i32> {
    value
        .split_whitespace()
        .find_map(|field| field.parse::<i32>().ok())
}

fn parse_atspi_object_refs(value: &str, limit: usize) -> Vec<AtspiObjectRef> {
    let strings = parse_quoted_strings(value);
    strings
        .chunks(2)
        .filter_map(|chunk| {
            let service = chunk.first()?;
            let path = chunk.get(1)?;
            Some(AtspiObjectRef {
                service: service.clone(),
                path: path.clone(),
            })
        })
        .take(limit)
        .collect()
}

fn parse_first_atspi_object_ref(value: &str) -> Option<AtspiObjectRef> {
    let strings = parse_quoted_strings(value);
    let service = strings.first()?;
    let path = strings.get(1)?;
    Some(AtspiObjectRef {
        service: service.clone(),
        path: path.clone(),
    })
}

fn parse_quoted_strings(value: &str) -> Vec<String> {
    let mut strings = Vec::new();
    let mut current = String::new();
    let mut in_string = false;
    let mut escaped = false;

    for character in value.chars() {
        if !in_string {
            if character == '"' {
                in_string = true;
                current.clear();
            }
            continue;
        }

        if escaped {
            current.push(character);
            escaped = false;
            continue;
        }

        match character {
            '\\' => escaped = true,
            '"' => {
                strings.push(current.clone());
                in_string = false;
            }
            character => current.push(character),
        }
    }

    strings
}

fn command_error(output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let combined = format!("{} {}", stderr.trim(), stdout.trim());
    combined.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn parses_active_descendant_object_ref() {
        let object_ref =
            parse_first_atspi_object_ref(r#"so ":1.42" "/org/a11y/atspi/accessible/7""#)
                .expect("object ref");

        assert_eq!(object_ref.service, ":1.42");
        assert_eq!(object_ref.path, "/org/a11y/atspi/accessible/7");
    }

    #[test]
    fn focused_object_json_omits_textual_fields() {
        let focused = AtspiFocusedObject {
            object_ref: AtspiObjectRef {
                service: ":1.42".to_string(),
                path: "/org/a11y/atspi/accessible/7".to_string(),
            },
            role: "frame".to_string(),
            child_count: 2,
            application: AtspiObjectRef {
                service: ":1.42".to_string(),
                path: "/org/a11y/atspi/accessible/root".to_string(),
            },
        };

        let json = focused_object_json("GNOME", "wayland", true, &focused);

        assert!(json.contains(r#""focus_available":true"#));
        assert!(json.contains(r#""role":"frame""#));
        assert!(json.contains(r#""child_count":2"#));
        assert!(json.contains(r#""text_content_included":false"#));
        assert!(!json.contains(r#""name":"#));
        assert!(!json.contains(r#""description":"#));
        assert!(!json.contains(r#""text":"#));
        assert!(!json.contains(r#""states":"#));
        assert!(!json.contains(r#""actions":"#));
    }

    #[test]
    fn traversal_result_json_emits_bounded_shape() {
        let traversal = AtspiTraversalResult {
            root: AtspiObjectRef {
                service: ":1.42".to_string(),
                path: "/org/a11y/atspi/accessible/root".to_string(),
            },
            nodes: vec![
                AtspiTraversalNode {
                    id: "n0".to_string(),
                    object_ref: AtspiObjectRef {
                        service: ":1.42".to_string(),
                        path: "/org/a11y/atspi/accessible/root".to_string(),
                    },
                    role: "application".to_string(),
                    child_count: 1,
                    depth: 0,
                    children: vec!["n1".to_string()],
                },
                AtspiTraversalNode {
                    id: "n1".to_string(),
                    object_ref: AtspiObjectRef {
                        service: ":1.42".to_string(),
                        path: "/org/a11y/atspi/accessible/1".to_string(),
                    },
                    role: "frame".to_string(),
                    child_count: 0,
                    depth: 1,
                    children: vec![],
                },
            ],
            limits: AtspiTraversalLimits {
                max_depth: 2,
                max_nodes: 64,
                max_children_per_node: 8,
            },
            truncated: false,
            unavailable_reason: None,
        };

        let json = traversal.to_json();

        assert!(
            json.contains(r#""root":{"service":":1.42","path":"/org/a11y/atspi/accessible/root"}"#)
        );
        assert!(json.contains(r#""id":"n0""#));
        assert!(json.contains(r#""role":"application""#));
        assert!(json.contains(r#""child_count":1"#));
        assert!(json.contains(r#""depth":0"#));
        assert!(json.contains(r#""children":["n1"]"#));
        assert!(
            json.contains(r#""limits":{"max_depth":2,"max_nodes":64,"max_children_per_node":8}"#)
        );
        assert!(json.contains(r#""truncated":false"#));
        assert!(json.contains(r#""text_content_included":false"#));
        assert!(
            json.contains(r#""withheld_fields":["name","description","text","states","actions"]"#)
        );
    }

    #[test]
    fn traversal_result_json_escapes_external_strings() {
        let traversal = AtspiTraversalResult {
            root: AtspiObjectRef {
                service: ":1.42".to_string(),
                path: "/root".to_string(),
            },
            nodes: vec![AtspiTraversalNode {
                id: "n\"0".to_string(),
                object_ref: AtspiObjectRef {
                    service: ":1.42".to_string(),
                    path: "/org/a11y/atspi/accessible/line\none".to_string(),
                },
                role: "frame\\dialog".to_string(),
                child_count: 0,
                depth: 0,
                children: vec!["child\tid".to_string()],
            }],
            limits: AtspiTraversalLimits {
                max_depth: 1,
                max_nodes: 1,
                max_children_per_node: 1,
            },
            truncated: true,
            unavailable_reason: None,
        };

        let json = traversal.to_json();

        assert!(json.contains(r#""id":"n\"0""#));
        assert!(json.contains(r#""path":"/org/a11y/atspi/accessible/line\none""#));
        assert!(json.contains(r#""role":"frame\\dialog""#));
        assert!(json.contains(r#""children":["child\tid"]"#));
        assert!(json.contains(r#""truncated":true"#));
    }

    #[test]
    fn traversal_result_json_omits_protected_fields() {
        let traversal = AtspiTraversalResult {
            root: AtspiObjectRef {
                service: ":1.42".to_string(),
                path: "/root".to_string(),
            },
            nodes: vec![AtspiTraversalNode {
                id: "n0".to_string(),
                object_ref: AtspiObjectRef {
                    service: ":1.42".to_string(),
                    path: "/root".to_string(),
                },
                role: "application".to_string(),
                child_count: 0,
                depth: 0,
                children: vec![],
            }],
            limits: AtspiTraversalLimits {
                max_depth: 1,
                max_nodes: 64,
                max_children_per_node: 8,
            },
            truncated: false,
            unavailable_reason: None,
        };

        let json = traversal.to_json();

        assert!(!json.contains(r#""name":"#));
        assert!(!json.contains(r#""description":"#));
        assert!(!json.contains(r#""text":"#));
        assert!(!json.contains(r#""value":"#));
        assert!(!json.contains(r#""states":"#));
        assert!(!json.contains(r#""actions":"#));
        assert!(!json.contains(r#""screenshot":"#));
        assert!(!json.contains(r#""image":"#));
        assert!(!json.contains(r#""pointer_state":"#));
        assert!(!json.contains(r#""keyboard_state":"#));
        assert!(!json.contains(r#""desktop_ref_id":"#));
    }

    #[test]
    fn traversal_unavailable_result_json_emits_zero_node_shape() {
        let traversal = AtspiTraversalResult::unavailable(
            AtspiObjectRef {
                service: ":1.42".to_string(),
                path: "/org/a11y/atspi/accessible/root".to_string(),
            },
            AtspiTraversalLimits {
                max_depth: 2,
                max_nodes: 64,
                max_children_per_node: 8,
            },
            "atspi_bus_address_unavailable",
        );

        let json = traversal.to_json();

        assert!(
            json.contains(r#""root":{"service":":1.42","path":"/org/a11y/atspi/accessible/root"}"#)
        );
        assert!(json.contains(r#""nodes":[]"#));
        assert!(
            json.contains(r#""limits":{"max_depth":2,"max_nodes":64,"max_children_per_node":8}"#)
        );
        assert!(json.contains(r#""truncated":false"#));
        assert!(json.contains(r#""unavailable_reason":"atspi_bus_address_unavailable""#));
        assert!(json.contains(r#""text_content_included":false"#));
        assert!(
            json.contains(r#""withheld_fields":["name","description","text","states","actions"]"#)
        );
    }

    #[test]
    fn traversal_unavailable_result_json_omits_protected_fields() {
        let traversal = AtspiTraversalResult::unavailable(
            AtspiObjectRef {
                service: ":1.42".to_string(),
                path: "/root".to_string(),
            },
            traversal_limits(1, 64, 8),
            "atspi_root_query_unavailable",
        );

        let json = traversal.to_json();

        assert!(!json.contains(r#""id":"#));
        assert!(!json.contains(r#""role":"#));
        assert!(!json.contains(r#""child_count":"#));
        assert!(!json.contains(r#""name":"#));
        assert!(!json.contains(r#""description":"#));
        assert!(!json.contains(r#""text":"#));
        assert!(!json.contains(r#""value":"#));
        assert!(!json.contains(r#""states":"#));
        assert!(!json.contains(r#""actions":"#));
        assert!(!json.contains(r#""screenshot":"#));
        assert!(!json.contains(r#""pointer_state":"#));
        assert!(!json.contains(r#""keyboard_state":"#));
    }

    #[test]
    fn traversal_limits_derive_from_validated_args() {
        let args = TraversalArgs {
            root_service: ":1.42".to_string(),
            root_path: "/org/a11y/atspi/accessible/root".to_string(),
            max_depth: 3,
            max_nodes: 128,
            max_children_per_node: 16,
        };

        assert_eq!(
            AtspiTraversalLimits::from(&args),
            AtspiTraversalLimits {
                max_depth: 3,
                max_nodes: 128,
                max_children_per_node: 16,
            }
        );
    }

    #[test]
    fn traversal_from_args_uses_authorized_root_limits_and_query_boundary() {
        let args = TraversalArgs {
            root_service: ":1.42".to_string(),
            root_path: "/org/a11y/atspi/accessible/root".to_string(),
            max_depth: 1,
            max_nodes: 8,
            max_children_per_node: 2,
        };
        let observations = fake_traversal_observations([
            (
                "/org/a11y/atspi/accessible/root",
                "application",
                3,
                vec!["/a", "/b", "/c"],
            ),
            ("/a", "frame", 0, vec![]),
            ("/b", "frame", 0, vec![]),
        ]);
        let mut queried = Vec::new();

        let result = build_traversal_from_args(&args, |object_ref, max_children| {
            queried.push((object_ref.clone(), max_children));
            fake_query(&observations, [])(object_ref)
        });

        assert_eq!(result.root, fake_ref("/org/a11y/atspi/accessible/root"));
        assert_eq!(result.limits, AtspiTraversalLimits::from(&args));
        assert_eq!(
            result
                .nodes
                .iter()
                .map(|node| node.object_ref.path.as_str())
                .collect::<Vec<_>>(),
            vec!["/org/a11y/atspi/accessible/root", "/a", "/b"]
        );
        assert_eq!(
            queried,
            vec![
                (fake_ref("/org/a11y/atspi/accessible/root"), 2),
                (fake_ref("/a"), 2),
                (fake_ref("/b"), 2),
            ]
        );
        assert_eq!(result.truncated, true);
    }

    #[test]
    fn traversal_command_output_success_uses_injected_query_boundary() {
        let args = TraversalArgs {
            root_service: ":1.42".to_string(),
            root_path: "/org/a11y/atspi/accessible/root".to_string(),
            max_depth: 1,
            max_nodes: 8,
            max_children_per_node: 2,
        };
        let observations = fake_traversal_observations([
            (
                "/org/a11y/atspi/accessible/root",
                "application",
                1,
                vec!["/a"],
            ),
            ("/a", "frame", 0, vec![]),
        ]);
        let mut queried = Vec::new();

        let json = build_atspi_traversal_command_output(
            &args,
            || Some("unix:path=/tmp/fake-atspi".to_string()),
            |address, object_ref, max_children| {
                queried.push((address.to_string(), object_ref.clone(), max_children));
                fake_query(&observations, [])(object_ref)
            },
        );

        assert!(
            json.contains(r#""root":{"service":":1.42","path":"/org/a11y/atspi/accessible/root"}"#)
        );
        assert!(json.contains(r#""nodes":["#));
        assert!(json.contains(r#""role":"application""#));
        assert!(json.contains(r#""children":["n1"]"#));
        assert!(
            json.contains(r#""limits":{"max_depth":1,"max_nodes":8,"max_children_per_node":2}"#)
        );
        assert!(json.contains(r#""truncated":false"#));
        assert_eq!(
            queried,
            vec![
                (
                    "unix:path=/tmp/fake-atspi".to_string(),
                    fake_ref("/org/a11y/atspi/accessible/root"),
                    2
                ),
                ("unix:path=/tmp/fake-atspi".to_string(), fake_ref("/a"), 2),
            ]
        );
        assert!(!json.contains(r#""name":"#));
        assert!(!json.contains(r#""description":"#));
        assert!(!json.contains(r#""text":"#));
        assert!(!json.contains(r#""states":"#));
        assert!(!json.contains(r#""actions":"#));
    }

    #[test]
    fn traversal_command_output_unavailable_without_bus_address_skips_query() {
        let args = TraversalArgs {
            root_service: ":1.42".to_string(),
            root_path: "/org/a11y/atspi/accessible/root".to_string(),
            max_depth: 2,
            max_nodes: 64,
            max_children_per_node: 8,
        };
        let mut queried = false;

        let json = build_atspi_traversal_command_output(
            &args,
            || None,
            |_, _, _| {
                queried = true;
                Err("should_not_query".to_string())
            },
        );

        assert!(!queried);
        assert!(
            json.contains(r#""root":{"service":":1.42","path":"/org/a11y/atspi/accessible/root"}"#)
        );
        assert!(json.contains(r#""nodes":[]"#));
        assert!(
            json.contains(r#""limits":{"max_depth":2,"max_nodes":64,"max_children_per_node":8}"#)
        );
        assert!(json.contains(r#""truncated":false"#));
        assert!(json.contains(r#""unavailable_reason":"atspi_bus_address_unavailable""#));
        assert!(json.contains(r#""text_content_included":false"#));
        assert!(!json.contains(r#""name":"#));
        assert!(!json.contains(r#""description":"#));
        assert!(!json.contains(r#""text":"#));
        assert!(!json.contains(r#""states":"#));
        assert!(!json.contains(r#""actions":"#));
    }

    #[test]
    fn bounded_traversal_visits_nodes_breadth_first() {
        let observations = fake_traversal_observations([
            ("/root", "application", 2, vec!["/a", "/b"]),
            ("/a", "frame", 1, vec!["/c"]),
            ("/b", "frame", 1, vec!["/d"]),
            ("/c", "button", 0, vec![]),
            ("/d", "entry", 0, vec![]),
        ]);

        let result = build_bounded_traversal(
            fake_ref("/root"),
            traversal_limits(2, 16, 8),
            fake_query(&observations, []),
        );

        assert_eq!(
            result
                .nodes
                .iter()
                .map(|node| node.object_ref.path.as_str())
                .collect::<Vec<_>>(),
            vec!["/root", "/a", "/b", "/c", "/d"]
        );
        assert_eq!(result.nodes[0].children, vec!["n1", "n2"]);
        assert_eq!(result.nodes[1].children, vec!["n3"]);
        assert_eq!(result.nodes[2].children, vec!["n4"]);
        assert_eq!(result.truncated, false);
    }

    #[test]
    fn bounded_traversal_depth_limit_truncates_descendants() {
        let observations = fake_traversal_observations([
            ("/root", "application", 1, vec!["/a"]),
            ("/a", "frame", 1, vec!["/c"]),
            ("/c", "button", 0, vec![]),
        ]);

        let result = build_bounded_traversal(
            fake_ref("/root"),
            traversal_limits(1, 16, 8),
            fake_query(&observations, []),
        );

        assert_eq!(
            result
                .nodes
                .iter()
                .map(|node| node.object_ref.path.as_str())
                .collect::<Vec<_>>(),
            vec!["/root", "/a"]
        );
        assert_eq!(result.nodes[1].children, Vec::<String>::new());
        assert_eq!(result.truncated, true);
    }

    #[test]
    fn bounded_traversal_node_limit_truncates_queue() {
        let observations = fake_traversal_observations([
            ("/root", "application", 3, vec!["/a", "/b", "/c"]),
            ("/a", "frame", 0, vec![]),
            ("/b", "frame", 0, vec![]),
            ("/c", "frame", 0, vec![]),
        ]);

        let result = build_bounded_traversal(
            fake_ref("/root"),
            traversal_limits(2, 2, 8),
            fake_query(&observations, []),
        );

        assert_eq!(
            result
                .nodes
                .iter()
                .map(|node| node.object_ref.path.as_str())
                .collect::<Vec<_>>(),
            vec!["/root", "/a"]
        );
        assert_eq!(result.nodes[0].children, vec!["n1"]);
        assert_eq!(result.truncated, true);
    }

    #[test]
    fn bounded_traversal_child_limit_truncates_siblings() {
        let observations = fake_traversal_observations([
            ("/root", "application", 3, vec!["/a", "/b", "/c"]),
            ("/a", "frame", 0, vec![]),
            ("/b", "frame", 0, vec![]),
            ("/c", "frame", 0, vec![]),
        ]);

        let result = build_bounded_traversal(
            fake_ref("/root"),
            traversal_limits(2, 16, 2),
            fake_query(&observations, []),
        );

        assert_eq!(
            result
                .nodes
                .iter()
                .map(|node| node.object_ref.path.as_str())
                .collect::<Vec<_>>(),
            vec!["/root", "/a", "/b"]
        );
        assert_eq!(result.nodes[0].children, vec!["n1", "n2"]);
        assert_eq!(result.truncated, true);
    }

    #[test]
    fn bounded_traversal_failed_child_query_does_not_leave_dangling_child_ids() {
        let observations = fake_traversal_observations([
            ("/root", "application", 2, vec!["/a", "/b"]),
            ("/b", "frame", 0, vec![]),
        ]);

        let result = build_bounded_traversal(
            fake_ref("/root"),
            traversal_limits(2, 16, 8),
            fake_query(&observations, ["/a"]),
        );

        let included_ids = result
            .nodes
            .iter()
            .map(|node| node.id.as_str())
            .collect::<HashSet<_>>();
        assert_eq!(
            result
                .nodes
                .iter()
                .map(|node| node.object_ref.path.as_str())
                .collect::<Vec<_>>(),
            vec!["/root", "/b"]
        );
        assert!(result
            .nodes
            .iter()
            .flat_map(|node| node.children.iter())
            .all(|child| included_ids.contains(child.as_str())));
        assert_eq!(result.nodes[0].children, vec!["n2"]);
        assert_eq!(result.truncated, true);
    }

    #[test]
    fn traversal_observation_parser_reads_only_bounded_metadata() {
        let observation = traversal_observation_from_outputs(
            &fake_ref("/root"),
            r#"s "application""#,
            "i 3",
            r#"a(so) 3 ":1.42" "/a" ":1.42" "/b" ":1.42" "/c""#,
            2,
        );

        assert_eq!(observation.object_ref, fake_ref("/root"));
        assert_eq!(observation.role, "application");
        assert_eq!(observation.child_count, 3);
        assert_eq!(observation.children, vec![fake_ref("/a"), fake_ref("/b")]);
    }

    #[test]
    fn traversal_observation_json_path_omits_protected_fields() {
        let observation = traversal_observation_from_outputs(
            &fake_ref("/root"),
            r#"s "application""#,
            "i 1",
            r#"a(so) 1 ":1.42" "/a""#,
            8,
        );
        let result = build_bounded_traversal(fake_ref("/root"), traversal_limits(1, 8, 8), |_| {
            Ok(observation.clone())
        });
        let json = result.to_json();

        assert!(json.contains(r#""role":"application""#));
        assert!(json.contains(r#""child_count":1"#));
        assert!(!json.contains(r#""name":"#));
        assert!(!json.contains(r#""description":"#));
        assert!(!json.contains(r#""text":"#));
        assert!(!json.contains(r#""states":"#));
        assert!(!json.contains(r#""actions":"#));
    }

    #[test]
    fn atspi_limits_default_to_schema_caps() {
        assert_eq!(
            AtspiLimits::parse(Vec::<String>::new()).expect("limits"),
            AtspiLimits {
                max_applications: MAX_APPLICATIONS,
                max_root_child_refs: MAX_ROOT_CHILD_REFS,
                max_root_child_metadata: MAX_ROOT_CHILD_METADATA,
            }
        );
    }

    #[test]
    fn atspi_limits_parse_helper_hints() {
        let limits = AtspiLimits::parse([
            "--max-applications".to_string(),
            "3".to_string(),
            "--max-root-child-refs".to_string(),
            "5".to_string(),
            "--max-root-child-metadata".to_string(),
            "4".to_string(),
        ])
        .expect("limits");

        assert_eq!(
            limits,
            AtspiLimits {
                max_applications: 3,
                max_root_child_refs: 5,
                max_root_child_metadata: 4,
            }
        );
    }

    #[test]
    fn atspi_limits_reject_unknown_flags() {
        let error = AtspiLimits::parse(["--include-text".to_string(), "true".to_string()])
            .expect_err("error");

        assert_eq!(error, "unknown inspect-atspi option: --include-text");
    }

    #[test]
    fn atspi_limits_reject_missing_values() {
        let error = AtspiLimits::parse(["--max-applications".to_string()]).expect_err("error");

        assert_eq!(error, "--max-applications requires a value");
    }

    #[test]
    fn atspi_limits_reject_out_of_range_values() {
        let error = AtspiLimits::parse(["--max-root-child-metadata".to_string(), "5".to_string()])
            .expect_err("error");

        assert_eq!(
            error,
            "--max-root-child-metadata must be an integer from 0 to 4"
        );
    }

    #[test]
    fn atspi_limits_reject_non_integer_values() {
        let error = AtspiLimits::parse(["--max-root-child-refs".to_string(), "many".to_string()])
            .expect_err("error");

        assert_eq!(
            error,
            "--max-root-child-refs must be an integer from 0 to 8"
        );
    }

    #[test]
    fn traversal_args_parse_authorized_root_and_limits() {
        let args = TraversalArgs::parse([
            "--root-service".to_string(),
            ":1.42".to_string(),
            "--root-path".to_string(),
            "/org/a11y/atspi/accessible/root".to_string(),
            "--max-depth".to_string(),
            "2".to_string(),
            "--max-nodes".to_string(),
            "64".to_string(),
            "--max-children-per-node".to_string(),
            "8".to_string(),
        ])
        .expect("traversal args");

        assert_eq!(
            args,
            TraversalArgs {
                root_service: ":1.42".to_string(),
                root_path: "/org/a11y/atspi/accessible/root".to_string(),
                max_depth: 2,
                max_nodes: 64,
                max_children_per_node: 8,
            }
        );
    }

    #[test]
    fn traversal_args_reject_missing_required_flags() {
        let error = TraversalArgs::parse([
            "--root-service".to_string(),
            ":1.42".to_string(),
            "--max-depth".to_string(),
            "2".to_string(),
            "--max-nodes".to_string(),
            "64".to_string(),
            "--max-children-per-node".to_string(),
            "8".to_string(),
        ])
        .expect_err("error");

        assert_eq!(error, "--root-path is required");
    }

    #[test]
    fn traversal_args_reject_unknown_flags() {
        let error = TraversalArgs::parse(["--root-ref".to_string(), "desktop-ref-1".to_string()])
            .expect_err("error");

        assert_eq!(error, "unknown inspect-atspi-traversal option: --root-ref");
    }

    #[test]
    fn traversal_args_reject_out_of_range_limits() {
        let error = TraversalArgs::parse([
            "--root-service".to_string(),
            ":1.42".to_string(),
            "--root-path".to_string(),
            "/root".to_string(),
            "--max-depth".to_string(),
            "5".to_string(),
            "--max-nodes".to_string(),
            "64".to_string(),
            "--max-children-per-node".to_string(),
            "8".to_string(),
        ])
        .expect_err("error");

        assert_eq!(error, "--max-depth must be an integer from 1 to 4");
    }

    #[test]
    fn traversal_args_reject_non_integer_limits() {
        let error = TraversalArgs::parse([
            "--root-service".to_string(),
            ":1.42".to_string(),
            "--root-path".to_string(),
            "/root".to_string(),
            "--max-depth".to_string(),
            "2".to_string(),
            "--max-nodes".to_string(),
            "many".to_string(),
            "--max-children-per-node".to_string(),
            "8".to_string(),
        ])
        .expect_err("error");

        assert_eq!(error, "--max-nodes must be an integer from 1 to 256");
    }

    #[test]
    fn traversal_args_reject_empty_root_values() {
        let error = TraversalArgs::parse([
            "--root-service".to_string(),
            "".to_string(),
            "--root-path".to_string(),
            "/root".to_string(),
            "--max-depth".to_string(),
            "2".to_string(),
            "--max-nodes".to_string(),
            "64".to_string(),
            "--max-children-per-node".to_string(),
            "8".to_string(),
        ])
        .expect_err("error");

        assert_eq!(error, "--root-service must be a non-empty string");
    }

    fn traversal_limits(
        max_depth: usize,
        max_nodes: usize,
        max_children_per_node: usize,
    ) -> AtspiTraversalLimits {
        AtspiTraversalLimits {
            max_depth,
            max_nodes,
            max_children_per_node,
        }
    }

    fn fake_ref(path: &str) -> AtspiObjectRef {
        AtspiObjectRef {
            service: ":1.42".to_string(),
            path: path.to_string(),
        }
    }

    fn fake_traversal_observations<const N: usize>(
        entries: [(&str, &str, i32, Vec<&str>); N],
    ) -> HashMap<String, AtspiTraversalObservation> {
        entries
            .into_iter()
            .map(|(path, role, child_count, children)| {
                (
                    path.to_string(),
                    AtspiTraversalObservation {
                        object_ref: fake_ref(path),
                        role: role.to_string(),
                        child_count,
                        children: children.into_iter().map(fake_ref).collect(),
                    },
                )
            })
            .collect()
    }

    fn fake_query<'a, const N: usize>(
        observations: &'a HashMap<String, AtspiTraversalObservation>,
        failures: [&'a str; N],
    ) -> impl FnMut(&AtspiObjectRef) -> Result<AtspiTraversalObservation, String> + 'a {
        move |object_ref| {
            if failures.contains(&object_ref.path.as_str()) {
                return Err("fake_query_failed".to_string());
            }
            observations
                .get(&object_ref.path)
                .cloned()
                .ok_or_else(|| "fake_missing_observation".to_string())
        }
    }
}

fn json_escape(value: &str) -> String {
    let mut escaped = String::new();
    for character in value.chars() {
        match character {
            '"' => escaped.push_str("\\\""),
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            character if character.is_control() => {
                escaped.push_str(&format!("\\u{:04x}", character as u32));
            }
            character => escaped.push(character),
        }
    }
    escaped
}
