use notify_rust::{Notification, Timeout};
use std::env;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

const DEFAULT_APP_NAME: &str = "Soma";
const DEFAULT_TIMEOUT_SECONDS: u64 = 300;

fn main() {
    match run(env::args().skip(1).collect()) {
        Ok(()) => {}
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

fn run(args: Vec<String>) -> Result<(), String> {
    let request = BrokerRequest::parse(args)?;
    let mut notification = Notification::new();
    notification
        .appname(&request.app_name)
        .summary(&request.summary)
        .body(&request.body)
        .timeout(Timeout::Never);

    for action in &request.actions {
        notification.action(&action.key, &action.label);
    }

    let handle = notification
        .show()
        .map_err(|error| format!("notification_broker_show_failed: {error}"))?;
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        handle.wait_for_action(|action| {
            let _ = sender.send(action.to_owned());
        });
    });

    match receiver.recv_timeout(Duration::from_secs(request.timeout_seconds)) {
        Ok(action) if request.actions.iter().any(|entry| entry.key == action) => {
            println!("{action}");
        }
        Ok(_)
        | Err(mpsc::RecvTimeoutError::Timeout)
        | Err(mpsc::RecvTimeoutError::Disconnected) => {}
    }

    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
struct BrokerRequest {
    summary: String,
    body: String,
    actions: Vec<Action>,
    timeout_seconds: u64,
    app_name: String,
}

impl BrokerRequest {
    fn parse(args: Vec<String>) -> Result<Self, String> {
        let mut summary = String::new();
        let mut body = String::new();
        let mut actions = Vec::new();
        let mut timeout_seconds = DEFAULT_TIMEOUT_SECONDS;
        let mut app_name = DEFAULT_APP_NAME.to_owned();
        let mut index = 0;

        while index < args.len() {
            match args[index].as_str() {
                "--summary" => {
                    index += 1;
                    summary = required_value(&args, index, "--summary")?;
                }
                "--body" => {
                    index += 1;
                    body = required_value(&args, index, "--body")?;
                }
                "--action" => {
                    index += 1;
                    actions.push(parse_action(&required_value(&args, index, "--action")?)?);
                }
                "--timeout-seconds" => {
                    index += 1;
                    let value = required_value(&args, index, "--timeout-seconds")?;
                    timeout_seconds = value
                        .parse::<u64>()
                        .map_err(|_| "--timeout-seconds must be a positive integer".to_owned())?;
                    if timeout_seconds == 0 {
                        return Err("--timeout-seconds must be greater than zero".to_owned());
                    }
                }
                "--app-name" => {
                    index += 1;
                    app_name = required_value(&args, index, "--app-name")?;
                }
                "--help" | "-h" => {
                    return Err(usage());
                }
                other => {
                    return Err(format!("unknown argument: {other}\n{}", usage()));
                }
            }
            index += 1;
        }

        if summary.trim().is_empty() {
            return Err("--summary is required".to_owned());
        }
        if body.trim().is_empty() {
            return Err("--body is required".to_owned());
        }
        if actions.is_empty() {
            return Err("at least one --action key=Label is required".to_owned());
        }

        Ok(Self {
            summary,
            body,
            actions,
            timeout_seconds,
            app_name,
        })
    }
}

#[derive(Debug, PartialEq, Eq)]
struct Action {
    key: String,
    label: String,
}

fn required_value(args: &[String], index: usize, flag: &str) -> Result<String, String> {
    args.get(index)
        .filter(|value| !value.is_empty())
        .cloned()
        .ok_or_else(|| format!("{flag} requires a value"))
}

fn parse_action(value: &str) -> Result<Action, String> {
    let Some((key, label)) = value.split_once('=') else {
        return Err("--action must use key=Label".to_owned());
    };
    let key = key.trim();
    let label = label.trim();
    if key.is_empty() || label.is_empty() {
        return Err("--action key and label must be non-empty".to_owned());
    }
    if !key
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("--action key must contain only ASCII letters, numbers, _ or -".to_owned());
    }
    Ok(Action {
        key: key.to_owned(),
        label: label.to_owned(),
    })
}

fn usage() -> String {
    "usage: soma-notification-broker --summary text --body text --action approve=Approve --action deny=Deny [--timeout-seconds 300]".to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_required_notification_arguments() {
        let request = BrokerRequest::parse(vec![
            "--summary".to_owned(),
            "Soma".to_owned(),
            "--body".to_owned(),
            "Approve?".to_owned(),
            "--action".to_owned(),
            "approve=Approve".to_owned(),
            "--action".to_owned(),
            "deny=Deny".to_owned(),
            "--timeout-seconds".to_owned(),
            "30".to_owned(),
        ])
        .expect("parse request");

        assert_eq!(request.summary, "Soma");
        assert_eq!(request.body, "Approve?");
        assert_eq!(request.timeout_seconds, 30);
        assert_eq!(
            request.actions,
            vec![
                Action {
                    key: "approve".to_owned(),
                    label: "Approve".to_owned(),
                },
                Action {
                    key: "deny".to_owned(),
                    label: "Deny".to_owned(),
                },
            ]
        );
    }

    #[test]
    fn rejects_malformed_actions() {
        assert!(BrokerRequest::parse(vec![
            "--summary".to_owned(),
            "Soma".to_owned(),
            "--body".to_owned(),
            "Approve?".to_owned(),
            "--action".to_owned(),
            "approve".to_owned(),
        ])
        .is_err());

        assert!(BrokerRequest::parse(vec![
            "--summary".to_owned(),
            "Soma".to_owned(),
            "--body".to_owned(),
            "Approve?".to_owned(),
            "--action".to_owned(),
            "bad key=Approve".to_owned(),
        ])
        .is_err());
    }
}
