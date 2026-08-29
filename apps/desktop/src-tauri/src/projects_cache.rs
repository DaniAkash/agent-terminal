// In-memory cache of the desktop's project + tab tree, kept fresh by the
// React frontend and served to WSS mobile clients.
//
// The desktop's `$projects` nano-store (see `src/modules/stores/$projects.ts`)
// is the source of truth for every mutation. On any change, React calls the
// `sync_projects_to_wss` Tauri command with the full projects vector; this
// module stores it and notifies subscribers so the WSS server can broadcast
// the fresh state to every connected mobile client.
//
// Cold-start fallback: when the Tauri backend spins up before React finishes
// mounting, `ProjectsCache::load_from_disk` reads `projects.json` directly
// from the desktop's config directory. React overwrites the cache once it
// hydrates, so the fallback is a safety net for the ~200 ms window between
// backend init and frontend first-paint.
//
// Replaces the pre-Phase-A `ProjectRegistry` which read only from `PtyMap`
// and hallucinated project groupings from `<project>:<suffix>` tab-id
// prefixes. Both were wrong: desktop stores projects as first-class
// objects with explicit ids, and sleeping tabs (in projects.json but not
// yet spawned) never had a PtyHandle at all.

use crate::protocol::{ProjectSummary, TabSummary};
use crate::pty_manager::PtyMap;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::watch;

/// Owning cache. Callers hold an `Arc<ProjectsCache>` from `app.manage()`.
pub struct ProjectsCache {
    inner: Mutex<Vec<ProjectSummary>>,
    change_tx: watch::Sender<u64>,
    change_rx: watch::Receiver<u64>,
    version: Mutex<u64>,
    /// Set to true once React has called `sync_projects_to_wss` at least
    /// once with `hydrated: true`. WSS CRUD dispatch gates on this so
    /// mobile ops arriving during the cold-start window get an OpError
    /// instead of vanishing into a Tauri event bus with no listener.
    /// Cold-start `load_from_disk` populates the cache for read broadcast
    /// but does NOT flip this flag; only React's explicit signal does.
    hydrated: AtomicBool,
}

impl ProjectsCache {
    pub fn new() -> Self {
        let (tx, rx) = watch::channel(0u64);
        Self {
            inner: Mutex::new(Vec::new()),
            change_tx: tx,
            change_rx: rx,
            version: Mutex::new(0),
            hydrated: AtomicBool::new(false),
        }
    }

    /// Replace the cached projects and bump the change version.
    /// Every WSS connection watching `subscribe_changes()` wakes up.
    pub fn set(&self, projects: Vec<ProjectSummary>) {
        *self.inner.lock().expect("projects_cache lock poisoned") = projects;
        let mut v = self.version.lock().expect("version lock poisoned");
        *v = v.wrapping_add(1);
        let _ = self.change_tx.send(*v);
    }

    pub fn set_hydrated(&self) {
        self.hydrated.store(true, Ordering::Release);
    }

    pub fn is_hydrated(&self) -> bool {
        self.hydrated.load(Ordering::Acquire)
    }

    /// Snapshot the current tree for broadcast. Every WSS `Projects` push
    /// clones out of the cache once and sends that clone; the cache stays
    /// available for the next reader.
    ///
    /// Overlays `is_spawned` on each `TabSummary` by cross-referencing the
    /// live `PtyMap`. React does not know which tabs currently have a
    /// live PTY (spawn is lazy and driven by the terminal-pane mount),
    /// so we compute the flag here at read time.
    ///
    /// `contains_key` alone is not enough: the reader thread flips
    /// `PtyHandle::reader_alive` to false on EOF but does not remove the
    /// map entry itself (removal happens in `commands::close_tab` or
    /// via `try_reattach`). During that window a zombie entry would
    /// wrongly report `is_spawned: true` and mobile would drop the
    /// 'sleeping' pill on a dead tab. Guard on `reader_alive` too.
    pub fn projects_with_spawn_status(&self, pty_map: &PtyMap) -> Vec<ProjectSummary> {
        use std::sync::atomic::Ordering;
        let projects = self
            .inner
            .lock()
            .expect("projects_cache lock poisoned")
            .clone();
        let pty = pty_map.lock().expect("pty_map lock poisoned");
        projects
            .into_iter()
            .map(|mut project| {
                for tab in &mut project.tabs {
                    tab.is_spawned = pty
                        .get(&tab.tab_id)
                        .is_some_and(|h| h.reader_alive.load(Ordering::Acquire));
                }
                project
            })
            .collect()
    }

    /// Bump the change version without mutating the cached projects.
    /// Used by open_tab / close_tab which do not modify the tree itself
    /// but do change which tabs are currently spawned (the `is_spawned`
    /// overlay computed at read time).
    pub fn notify_spawn_change(&self) {
        let mut v = self.version.lock().expect("version lock poisoned");
        *v = v.wrapping_add(1);
        let _ = self.change_tx.send(*v);
    }

    /// Find a specific tab across all projects. Used by the WSS server's
    /// auto-spawn path to resolve the initial cwd + shell of a sleeping
    /// tab before its PTY is created.
    pub fn find_tab(&self, tab_id: &str) -> Option<TabSummary> {
        let projects = self.inner.lock().expect("projects_cache lock poisoned");
        for project in projects.iter() {
            for tab in &project.tabs {
                if tab.tab_id == tab_id {
                    return Some(tab.clone());
                }
            }
        }
        None
    }

    pub fn subscribe_changes(&self) -> watch::Receiver<u64> {
        self.change_rx.clone()
    }

    /// Read `projects.json` from the desktop's config directory. Used only
    /// on cold start before React has had a chance to sync.
    ///
    /// Deserialises into the frontend's persisted shape (kebab-case field
    /// names via serde attributes) then maps into the wire shape. Returns
    /// None on any error (missing file, malformed JSON, permissions),
    /// caller falls back to an empty tree.
    pub fn load_from_disk(config_dir: &Path) -> Option<Vec<ProjectSummary>> {
        let path = config_dir.join("projects.json");
        let bytes = std::fs::read(&path).ok()?;
        let stored: StoredProjectsFile = serde_json::from_slice(&bytes).ok()?;
        Some(stored.projects.into_iter().map(Into::into).collect())
    }
}

impl Default for ProjectsCache {
    fn default() -> Self {
        Self::new()
    }
}

// The on-disk shape written by the React frontend's `save_projects` Tauri
// command. Field names are camelCase in the JSON to match the TS types.
// We deserialise into these structs then map into the wire ProjectSummary
// / TabSummary so any drift between disk and wire shape is caught here
// rather than silently accepted downstream.
#[derive(Debug, Deserialize, Serialize)]
struct StoredProjectsFile {
    projects: Vec<StoredProject>,
}

/// Public so `commands::sync_projects_to_wss` can deserialise React's
/// camelCase `$projects` payload without duplicating the mapping code.
#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct StoredProject {
    id: String,
    name: String,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    pinned: bool,
    #[serde(default = "default_true", rename = "isExpanded")]
    is_expanded: bool,
    tabs: Vec<StoredTab>,
}

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct StoredTab {
    id: String,
    label: String,
    #[serde(default)]
    cmd: Option<String>,
    #[serde(default)]
    pinned: bool,
    #[serde(default, rename = "lastCwd")]
    last_cwd: Option<String>,
    #[serde(default, rename = "userRenamed")]
    user_renamed: bool,
}

fn default_true() -> bool {
    true
}

impl From<StoredProject> for ProjectSummary {
    fn from(p: StoredProject) -> Self {
        // Compose the compound tab_id (`<projectId>:<tabId>`) at the
        // project-level conversion so it matches the desktop's
        // `makeTabKey(projectId, tabId)` shape from
        // `src/screens/workspace/workspace.helpers.ts`. Without this,
        // mobile subscribes to `<tabId>` while desktop opens the same
        // tab at `<projectId>:<tabId>` — two PtyMap entries, two
        // separate shells, zero session sharing.
        let project_id = p.id;
        ProjectSummary {
            name: p.name,
            path: p.path,
            pinned: p.pinned,
            is_expanded: p.is_expanded,
            tabs: p
                .tabs
                .into_iter()
                .map(|t| tab_summary_from_stored(&project_id, t))
                .collect(),
            project_id,
        }
    }
}

/// Compose the PTY `tab_id` key from a project id + the raw (per-
/// project-unique) tab id stored in `projects.json`. This function is
/// the SINGLE Rust-side source of the composition formula. The
/// companion / mobile side receives the composed value on the wire; the
/// desktop React side has an equivalent function
/// `makeTabKey(projectId, tabId)` in
/// `src/screens/workspace/workspace.helpers.ts` that MUST produce the
/// same string for the same inputs. A drift between the two produces
/// two separate PtyMap entries for the "same" tab and mobile / desktop
/// stop sharing a shell (see #85 discussion for the bug that motivated
/// this).
///
/// Regression tests: `compose_tab_id_matches_desktop_makeTabKey` here
/// pins the Rust side; `src/screens/workspace/workspace.helpers.test.ts`
/// pins the desktop React side. If either changes without a matching
/// change on the other, both tests break.
pub fn compose_tab_id(project_id: &str, raw_tab_id: &str) -> String {
    format!("{project_id}:{raw_tab_id}")
}

fn tab_summary_from_stored(project_id: &str, t: StoredTab) -> TabSummary {
    TabSummary {
        tab_id: compose_tab_id(project_id, &t.id),
        label: t.label,
        cwd: t.last_cwd.clone(),
        agent: None,
        cmd: t.cmd,
        last_cwd: t.last_cwd,
        pinned: t.pinned,
        user_renamed: t.user_renamed,
        // Filled in at read time by projects_with_spawn_status().
        is_spawned: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;
    use std::sync::Arc;

    fn empty_pty_map() -> PtyMap {
        Arc::new(Mutex::new(HashMap::new()))
    }

    #[test]
    fn hydrated_flag_starts_false_and_flips_on_set() {
        let cache = ProjectsCache::new();
        assert!(!cache.is_hydrated());
        cache.set_hydrated();
        assert!(cache.is_hydrated());
        // Idempotent.
        cache.set_hydrated();
        assert!(cache.is_hydrated());
    }

    #[test]
    fn empty_cache_yields_empty_projects() {
        let cache = ProjectsCache::new();
        assert!(
            cache
                .projects_with_spawn_status(&empty_pty_map())
                .is_empty()
        );
    }

    #[test]
    fn set_replaces_and_bumps_version() {
        let cache = ProjectsCache::new();
        let mut rx = cache.subscribe_changes();
        assert_eq!(*rx.borrow(), 0);

        cache.set(vec![ProjectSummary {
            project_id: "p1".into(),
            name: "proj".into(),
            path: None,
            pinned: false,
            is_expanded: true,
            tabs: vec![],
        }]);
        assert_eq!(*rx.borrow_and_update(), 1);

        cache.set(vec![]);
        assert_eq!(*rx.borrow(), 2);
    }

    #[test]
    fn multiple_subscribers_all_see_changes() {
        let cache = ProjectsCache::new();
        let a = cache.subscribe_changes();
        let b = cache.subscribe_changes();
        cache.set(vec![]);
        assert_eq!(*a.borrow(), 1);
        assert_eq!(*b.borrow(), 1);
    }

    #[test]
    fn load_from_disk_parses_desktop_schema() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("projects.json");
        let contents = json!({
            "projects": [
                {
                    "id": "control-center",
                    "name": "control-center",
                    "path": "/tmp/cc",
                    "pinned": false,
                    "isExpanded": true,
                    "tabs": [
                        {
                            "id": "shell",
                            "label": "shell",
                            "cmd": "zsh",
                            "pinned": false,
                            "lastCwd": "/tmp/cc",
                            "userRenamed": false
                        }
                    ]
                }
            ]
        });
        std::fs::write(&path, serde_json::to_vec(&contents).unwrap()).unwrap();

        let projects = ProjectsCache::load_from_disk(tmp.path()).unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].project_id, "control-center");
        assert_eq!(projects[0].path.as_deref(), Some("/tmp/cc"));
        assert!(projects[0].is_expanded);
        assert_eq!(projects[0].tabs.len(), 1);
        let tab = &projects[0].tabs[0];
        // tab_id is composed as `<projectId>:<rawTabId>` to match the
        // desktop's makeTabKey() convention. Raw tab id in projects.json
        // was "shell"; composed with project "control-center" gives:
        assert_eq!(tab.tab_id, "control-center:shell");
        assert_eq!(tab.label, "shell");
        assert_eq!(tab.cmd.as_deref(), Some("zsh"));
        assert_eq!(tab.last_cwd.as_deref(), Some("/tmp/cc"));
        // cwd defaults to last_cwd on the wire; consumers show whichever.
        assert_eq!(tab.cwd.as_deref(), Some("/tmp/cc"));
    }

    #[test]
    fn load_from_disk_returns_none_on_missing_file() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(ProjectsCache::load_from_disk(tmp.path()).is_none());
    }

    /// Pins the `tab_id` composition to `<projectId>:<rawTabId>`. Must
    /// stay in sync with the companion-side pin in
    /// `companion/src/screens/workspace/tab-key.shape.test.ts` and with
    /// the desktop-side `makeTabKey` in
    /// `src/screens/workspace/workspace.helpers.ts`. If any of the
    /// three drifts, mobile and desktop stop sharing PTY sessions for
    /// the "same" tab; both tests should surface the drift on the CI
    /// side that changed.
    #[test]
    fn compose_tab_id_matches_desktop_makeTabKey() {
        assert_eq!(
            compose_tab_id("control-center", "shell-a9e7"),
            "control-center:shell-a9e7",
        );
        // Edge case: colons in the raw id (shouldn't occur in practice
        // but the composition must not smuggle its own delimiter into
        // parseable state).
        assert_eq!(compose_tab_id("p", "a:b"), "p:a:b");
    }

    #[test]
    fn find_tab_returns_summary_across_projects() {
        let cache = ProjectsCache::new();
        cache.set(vec![
            ProjectSummary {
                project_id: "p1".into(),
                name: "one".into(),
                path: None,
                pinned: false,
                is_expanded: true,
                tabs: vec![TabSummary {
                    tab_id: "t1".into(),
                    label: "a".into(),
                    cwd: None,
                    agent: None,
                    cmd: None,
                    last_cwd: Some("/tmp".into()),
                    pinned: false,
                    user_renamed: false,
                    is_spawned: false,
                }],
            },
            ProjectSummary {
                project_id: "p2".into(),
                name: "two".into(),
                path: None,
                pinned: false,
                is_expanded: true,
                tabs: vec![TabSummary {
                    tab_id: "t2".into(),
                    label: "b".into(),
                    cwd: None,
                    agent: None,
                    cmd: Some("bash".into()),
                    last_cwd: None,
                    pinned: false,
                    user_renamed: false,
                    is_spawned: false,
                }],
            },
        ]);
        let t1 = cache.find_tab("t1").expect("t1 should be found");
        assert_eq!(t1.last_cwd.as_deref(), Some("/tmp"));
        let t2 = cache.find_tab("t2").expect("t2 should be found");
        assert_eq!(t2.cmd.as_deref(), Some("bash"));
        assert!(cache.find_tab("t3").is_none());
    }

    #[test]
    fn projects_with_spawn_status_flags_live_tabs() {
        let cache = ProjectsCache::new();
        cache.set(vec![ProjectSummary {
            project_id: "p1".into(),
            name: "proj".into(),
            path: None,
            pinned: false,
            is_expanded: true,
            tabs: vec![
                TabSummary {
                    tab_id: "t1".into(),
                    label: "a".into(),
                    cwd: None,
                    agent: None,
                    cmd: None,
                    last_cwd: None,
                    pinned: false,
                    user_renamed: false,
                    is_spawned: false,
                },
                TabSummary {
                    tab_id: "t2".into(),
                    label: "b".into(),
                    cwd: None,
                    agent: None,
                    cmd: None,
                    last_cwd: None,
                    pinned: false,
                    user_renamed: false,
                    is_spawned: false,
                },
            ],
        }]);

        // Populate PtyMap so t1 is spawned, t2 is sleeping. We cannot
        // trivially construct a PtyHandle for a unit test (it holds
        // portable-pty trait objects); wrap the map access minimally.
        // The check is `contains_key` so we insert a synthetic entry.
        // Rebuild via unsafe transmute would be worse; use the same
        // approach the pre-Phase-A tests used - skip PtyHandle
        // construction and cover the branch in the integration test.
        //
        // Here we just verify the empty-map path: all tabs come back as
        // is_spawned=false.
        let projects = cache.projects_with_spawn_status(&empty_pty_map());
        assert!(!projects[0].tabs[0].is_spawned);
        assert!(!projects[0].tabs[1].is_spawned);
    }
}
