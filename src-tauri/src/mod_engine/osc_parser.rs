/// Incrementally parses OSC escape sequences from PTY output chunks.
///
/// OSC sequences have the form: `ESC ] <params> BEL` or `ESC ] <params> ESC \`
/// where `<params>` is `<code>[;<arg>]`.
///
/// The parser buffers incomplete sequences across multiple `feed()` calls so
/// that sequences split across chunk boundaries are handled correctly.
pub struct OscParser {
    buf: Vec<u8>,
    in_osc: bool,
    /// If true, the previous byte was ESC and we may be looking at either
    /// `]` (start of OSC) or `\` (ST terminator).
    saw_esc: bool,
}

/// A fully parsed OSC sequence.
pub struct OscSequence {
    /// The numeric code (e.g. 7, 133).
    pub code: u32,
    /// The argument string after `code;` (empty if no argument).
    pub arg: String,
}

/// Safety limit: discard any OSC buffer that grows beyond 8 KB.
const MAX_OSC_BUF: usize = 8 * 1024;

impl OscParser {
    pub fn new() -> Self {
        Self {
            buf: Vec::new(),
            in_osc: false,
            saw_esc: false,
        }
    }

    /// Feed a chunk of PTY output bytes. Returns any completed OSC sequences
    /// found in this chunk (may be empty or more than one).
    pub fn feed(&mut self, data: &[u8]) -> Vec<OscSequence> {
        let mut results = Vec::new();

        for &byte in data {
            if self.in_osc {
                match byte {
                    // BEL terminator
                    0x07 => {
                        self.saw_esc = false;
                        if let Some(seq) = Self::parse_sequence(&self.buf) {
                            results.push(seq);
                        }
                        self.buf.clear();
                        self.in_osc = false;
                    }
                    // ESC — could be the start of ST (ESC \)
                    0x1b => {
                        self.saw_esc = true;
                    }
                    // `\` after ESC = ST terminator
                    b'\\' if self.saw_esc => {
                        self.saw_esc = false;
                        // Remove the trailing ESC that was already pushed
                        if self.buf.last() == Some(&0x1b) {
                            self.buf.pop();
                        }
                        if let Some(seq) = Self::parse_sequence(&self.buf) {
                            results.push(seq);
                        }
                        self.buf.clear();
                        self.in_osc = false;
                    }
                    other => {
                        self.saw_esc = false;
                        self.buf.push(other);
                        // Safety: discard oversized buffers
                        if self.buf.len() > MAX_OSC_BUF {
                            self.buf.clear();
                            self.in_osc = false;
                        }
                    }
                }
            } else {
                // Outside OSC: look for ESC ] to start a sequence
                match byte {
                    0x1b => {
                        self.saw_esc = true;
                    }
                    b']' if self.saw_esc => {
                        self.saw_esc = false;
                        self.in_osc = true;
                        self.buf.clear();
                    }
                    _ => {
                        self.saw_esc = false;
                    }
                }
            }
        }

        results
    }

    /// Parse accumulated buffer bytes as `<code>[;<arg>]`.
    fn parse_sequence(buf: &[u8]) -> Option<OscSequence> {
        let s = std::str::from_utf8(buf).ok()?;
        if let Some(semi) = s.find(';') {
            let code: u32 = s[..semi].parse().ok()?;
            let arg = s[semi + 1..].to_string();
            Some(OscSequence { code, arg })
        } else {
            let code: u32 = s.trim().parse().ok()?;
            Some(OscSequence { code, arg: String::new() })
        }
    }
}

impl Default for OscParser {
    fn default() -> Self {
        Self::new()
    }
}
