//! The name to show for a session, in Rust.
//!
//! Mirrors `resolveTabLabel` in `packages/core-ui/src/sessions/session.label.ts`
//! and `sessionLabel` in `apps/companion/src/screens/tab/tab-label.helpers.ts`.
//! All three must agree: a session shown as `/control-center` in the sidebar
//! and `shell 2` in a notification is the same session, and anyone reading
//! both has to work that out for themselves.

use crate::protocol::TabSummary;

/// Last path segment of a working directory, with a leading slash.
///
///   "/Users/example/code/agent-terminal" -> "/agent-terminal"
///   "/"                                  -> "/"
pub fn cwd_basename(cwd: &str) -> String {
    let trimmed = cwd.strip_suffix('/').unwrap_or(cwd);
    let last = match trimmed.rfind('/') {
        Some(slash) => &trimmed[slash + 1..],
        None => trimmed,
    };
    if last.is_empty() {
        "/".to_string()
    } else {
        format!("/{last}")
    }
}

/// A name the user typed is always kept. Otherwise the directory stands in
/// for it, so an unnamed session reads as where it is rather than as the
/// order it happened to be created in. The stored label is the fallback for
/// a session whose directory is not known yet, which is what a tree loaded
/// from disk looks like before the first shell-integration event.
pub fn session_label(tab: &TabSummary, live_cwd: Option<&str>) -> String {
    if tab.user_renamed {
        return tab.label.clone();
    }
    let cwd = live_cwd
        .or(tab.cwd.as_deref())
        .or(tab.last_cwd.as_deref())
        .filter(|c| !c.is_empty());
    match cwd {
        Some(cwd) => cwd_basename(cwd),
        None => tab.label.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tab(label: &str) -> TabSummary {
        TabSummary {
            tab_id: "p1:t1".to_string(),
            label: label.to_string(),
            ..Default::default()
        }
    }

    // The cases the TS helpers pin, so the three implementations cannot
    // drift apart silently.
    #[test]
    fn cwd_basename_matches_the_helpers_it_mirrors() {
        assert_eq!(cwd_basename("/Users/example/code/agent-terminal"), "/agent-terminal");
        assert_eq!(cwd_basename("/Users/example"), "/example");
        assert_eq!(cwd_basename("/"), "/");
    }

    #[test]
    fn cwd_basename_ignores_a_trailing_slash() {
        assert_eq!(cwd_basename("/Users/example/code/"), "/code");
    }

    #[test]
    fn cwd_basename_handles_a_bare_segment_with_no_separator() {
        assert_eq!(cwd_basename("code"), "/code");
    }

    #[test]
    fn keeps_a_name_the_user_typed_whatever_the_directory() {
        let mut t = tab("my-test-1");
        t.user_renamed = true;
        t.cwd = Some("/Users/example".to_string());
        assert_eq!(session_label(&t, None), "my-test-1");
    }

    #[test]
    fn shows_the_directory_for_a_session_that_was_never_named() {
        let mut t = tab("shell 4");
        t.cwd = Some("/Users/example/code/control-center".to_string());
        assert_eq!(session_label(&t, None), "/control-center");
    }

    #[test]
    fn prefers_the_live_directory_over_the_persisted_one() {
        let mut t = tab("shell");
        t.cwd = Some("/stale".to_string());
        t.last_cwd = Some("/older".to_string());
        assert_eq!(session_label(&t, Some("/live")), "/live");
    }

    #[test]
    fn falls_back_through_cwd_to_last_cwd() {
        let mut t = tab("shell");
        t.cwd = Some("/from-cwd".to_string());
        t.last_cwd = Some("/older".to_string());
        assert_eq!(session_label(&t, None), "/from-cwd");

        let mut only_stored = tab("shell");
        only_stored.last_cwd = Some("/Users/example/only-stored".to_string());
        assert_eq!(session_label(&only_stored, None), "/only-stored");
    }

    #[test]
    fn falls_back_to_the_stored_label_when_no_directory_is_known() {
        assert_eq!(session_label(&tab("shell 2"), None), "shell 2");
    }

    #[test]
    fn an_explicitly_renamed_session_survives_having_no_directory() {
        let mut t = tab("deploy");
        t.user_renamed = true;
        assert_eq!(session_label(&t, None), "deploy");
    }
}
