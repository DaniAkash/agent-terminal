# @agent-terminal/core-ui

Rules the desktop app and the mobile companion have to agree on, in one place.

Both apps draw the same sessions: the same agent marks, the same state badges, the same ordering. Written twice they drift, and the two surfaces stop describing the same machine. So the vocabulary, the state machine and the ordering live here, and each app keeps only its renderer.

**This package contains no components.** A React DOM `<svg>` and a `react-native-svg` `<Svg>` cannot be the same element, so what is shared is the path geometry, the colours and the decisions; each app spends about twenty lines turning those into its own elements. There is no `react`, `react-dom` or `react-native` import anywhere here, and no `document` or `window`. That is what lets Vite and Metro both read it as plain source with no build step.

Adding an agent means adding one entry to `AGENT_BRANDS` and one to `AGENT_MARKS`. A test fails if you do one and forget the other.
