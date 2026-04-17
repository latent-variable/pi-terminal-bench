# pi-terminal-bench

Self-contained benchmark suite for [pi](https://shittycodingagent.ai). Runs coding tasks locally through your pi CLI — you see the agent work in real time. No Docker, no Python frameworks, no external dependencies beyond what you already have.

## Requirements

| Dependency | Required | Why |
|---|---|---|
| **pi** (CLI) | Yes | Runs the agent under test |
| **Python 3.10+** | Yes | All tasks are Python-based; used for task setup and verification |
| **bash** | Yes | Task orchestration and some bash-specific tasks |
| **numpy, pandas, sympy** | Optional | A handful of data-science / math tasks ported from Terminal-Bench use these. Tasks that need them will fail verification if missing; all other tasks run fine with stdlib Python. |

No Docker, no Harbor, no uv, no pip installs. The benchmark runs against whatever model you have active in Pi — local (OMLX, LM Studio, Ollama) or remote (Anthropic, OpenAI, etc.). No additional API configuration needed.

## Install

```bash
pi install /path/to/pi-terminal-bench
```

Then restart pi or run `/reload` to pick up the new commands.

## Commands

| Command | What it does |
|---|---|
| `/bench-list` | Show all categories with task counts |
| `/bench-list <filter>` | List individual tasks matching a filter |
| `/bench-run <task>` | Run a single task — agent output is fully visible |
| `/bench-run <category>` | Run all tasks in a category (e.g. `quixbugs`, `hard`, `security`) |
| `/bench-run all` | Run every task |
| `/bench-doctor` | Check prerequisites and show category breakdown |
| `/bench-results` | Summary of recent runs |
| `/bench-results <N>` | Detailed per-task breakdown of run N |
| `/bench-cleanup` | Find and kill any stray benchmark processes |

All commands default to your active model. Append `provider/model` to override (e.g. `/bench-run hard omlx/Qwen3.5-122B-A10B-4bit`).

### Categories

| Category | Command | Count | Description |
|---|---|---|---|
| QuixBugs | `/bench-run quixbugs` | 40 | Single-line Python bug fixes |
| Hard | `/bench-run hard` | 7 | Multi-step coding challenges |
| Long Context | `/bench-run long-context` | 6 | Large codebase / multi-file tasks |
| Code Generation | `/bench-run codegen` | 3 | Build programs from a spec |
| Performance | `/bench-run perf` | 2 | Optimize slow code |
| Security | `/bench-run security` | 2 | Find and fix vulnerabilities |
| File Operations | `/bench-run file-operations` | 2 | Read/write/transform files on disk |
| Mathematics | `/bench-run math` | 2 | Symbolic math and numeric puzzles |
| Games | `/bench-run games` | 2 | Game-logic and puzzle solvers |
| Data Science | `/bench-run data-science` | 1 | pandas ETL and analysis |
| Debugging | `/bench-run debugging` | 1 | Diagnose and fix broken code |

## Tasks — 68 total

### QuixBugs — 40 tasks
Single-function Python bug fixes from the [QuixBugs benchmark](https://github.com/jkoppel/QuixBugs). Each program has a known single-line bug. Tests verify the fix against the original test suite.

Run: `/bench-run quixbugs`

### Hard — 7 tasks
Multi-step coding challenges requiring real problem-solving:

| Task | Category | What it tests |
|---|---|---|
| `hard-implement-lru-cache` | Data structure | O(1) LRU cache from scratch |
| `hard-implement-trie` | Data structure | Trie with autocomplete and delete |
| `hard-graph-shortest-path` | Algorithm | Dijkstra's implementation |
| `hard-regex-log-parser` | Parsing | Apache log parsing and analytics |
| `hard-multi-file-bug` | Debugging | Bugs across 3 interacting files |
| `hard-bash-pipeline` | Shell | Data processing with Unix tools |
| `hard-concurrent-bug` | Concurrency | Fix a threading race condition |

Run: `/bench-run hard`

### Long Context — 6 tasks
Tasks that require accumulating and managing a lot of context — reading many files, making coordinated changes across a codebase, or completing multi-step pipelines:

| Task | Category | What it tests |
|---|---|---|
| `long-context-refactor-class` | Refactoring | 10+ method/param renames across a 250-line class |
| `long-context-multi-file-config` | Configuration | Trace a config value through 5 files |
| `long-context-data-pipeline` | Data pipeline | Complete a 6-step CSV ETL pipeline |
| `long-context-test-generation` | Testing | Write 24+ tests for an 8-function module |
| `long-context-code-review-fix` | Code review | Find 6 subtle bugs in 300 lines |
| `long-context-api-migration` | Migration | Convert 4 files from sync to async |

Run: `/bench-run long-context`

### Code Generation — 3 tasks
Build complete programs from a specification:

| Task | Category | What it tests |
|---|---|---|
| `codegen-state-machine` | Design pattern | Implement a configurable finite state machine |
| `codegen-cli-tool` | CLI | Build a word frequency analyzer with flags |
| `codegen-rest-api` | API | Build a REST API server using only stdlib |

Run: `/bench-run codegen`

### Performance Optimization — 2 tasks
Correct-but-slow code that needs to be optimized:

| Task | Category | What it tests |
|---|---|---|
| `perf-slow-sort` | Sorting | Optimize O(n²) bubble sort for 100k records |
| `perf-string-search` | Search | Build an inverted index for fast text search |

Run: `/bench-run perf`

### Security — 2 tasks
Find and fix security vulnerabilities:

| Task | Category | What it tests |
|---|---|---|
| `security-sql-injection` | SQL injection | Fix parameterized query vulnerabilities in SQLite |
| `security-path-traversal` | Path traversal | Prevent directory escape in a file server |

Run: `/bench-run security`

### Terminal-Bench ports — 8 tasks

Tasks adapted from [Terminal-Bench](https://github.com/laude-institute/terminal-bench) and repackaged to run without Docker. Some of these assume `numpy`, `pandas`, `sympy`, or `word2number` are available in the interpreter that runs verification:

| Task | Category | What it tests |
|---|---|---|
| `file-operations-hello-world` | File I/O | Create a file with exact content |
| `file-operations-heterogeneous-dates` | Data join | Normalize mixed date formats across 2 CSVs (`pandas` helpful) |
| `math-countdown-game` | Arithmetic | Build an expression hitting a target value |
| `math-definite-integral` | Symbolic math | Compute `∫₀¹ x²eˣ dx` exactly (`sympy`) |
| `games-mahjong-winning-hand` | Pattern matching | Classify 8 Mahjong hands by winning pattern |
| `games-sha-puzzle` | Self-referential | Phrase whose initials spell the letter count of its own SHA-1 (`word2number`) |
| `data-science-pandas-etl` | ETL | Extract postal code + city, build team_name column (`pandas`) |
| `debugging-logistic-regression-divergence` | ML bug fix | Fix diverging gradient-ascent loop (`numpy`) |

Run: `/bench-run terminal-bench` (uses the shared tag) or individual category names above.

### Category summary

| Category | Count | Tags to filter |
|---|---|---|
| Bug fix (single-line) | 40 | `quixbugs` |
| Long context / multi-step | 6 | `long-context` |
| Graph algorithms | 10 | `graph` |
| Data structure implementation | 2 | `data-structure` |
| Data processing / pipeline | 4 | `data-processing`, `data-pipeline` |
| Multi-file debugging | 3 | `multi-file` |
| Refactoring | 1 | `refactoring` |
| Test generation | 1 | `test-generation` |
| Bash / shell scripting | 1 | `bash` |
| Concurrency / threading | 1 | `concurrency` |
| API migration | 1 | `migration` |
| Parsing / regex | 2 | `parsing`, `regex` |
| Code review | 1 | `code-review` |
| Code generation | 3 | `code-generation` |
| Performance optimization | 2 | `performance` |
| Security | 2 | `security` |
| File operations | 2 | `file-operations` |
| Mathematics | 2 | `mathematics` |
| Games / puzzles | 2 | `games` |
| Data science (pandas) | 1 | `data-science` |
| Debugging (ML) | 1 | `debugging` |
| Terminal-Bench ports | 8 | `terminal-bench` |

## Examples

```bash
# See what's available
/bench-list

# Run a single task — watch the agent work in real time
/bench-run quixbugs-python-flatten

# Run a category
/bench-run quixbugs
/bench-run hard
/bench-run security

# Run multiple specific tasks
/bench-run quixbugs-python-bitcount quixbugs-python-flatten

# Mix categories and tasks
/bench-run security perf

# Run everything (uses active model)
/bench-run all

# View recent run summaries
/bench-results

# View detailed breakdown of the most recent run
/bench-results 1
```

## Results

Results are saved as JSON to `~/.pi/agent/pi-terminal-bench/results/`. Each run records:
- Model used
- Per-task pass/fail status
- Duration per task
- Verification output for failures
- Timestamp

Use `/bench-results` to view summaries and `/bench-results <N>` for per-task breakdowns — all within pi.

## Comparing models

Run the same benchmark with different models and compare:

```bash
/bench-run quixbugs omlx/Qwen3.5-122B-A10B-4bit
/bench-run quixbugs anthropic/claude-sonnet-4-20250514
/bench-results   # see both runs side by side
```

Share your `tasks/` directory with others — they can run the same benchmarks on their local models and compare scores.

## Adding tasks

This benchmark currently includes 68 tasks across 11 categories. It's designed to be extensible — PRs adding new tasks are welcome.

To add a task, create a JSON file in `tasks/`:

```json
{
  "name": "my-task",
  "description": "What this tests",
  "dataset": "custom",
  "difficulty": "medium",
  "instruction": "What the agent sees and should do",
  "setup_files": {
    "buggy.py": "def broken(): return 1 + '2'",
    "test_buggy.py": "from buggy import broken\nassert broken() == 3"
  },
  "verify": "cd $BENCH_WORK_DIR && python3 test_buggy.py",
  "timeout": 180000,
  "tags": ["custom", "python"]
}
```

### Task format

| Field | Description |
|---|---|
| `name` | Unique task identifier (used in `/bench-run`) |
| `description` | Short description shown in task list |
| `instruction` | The prompt the agent sees — describe what to fix/build |
| `setup_files` | Files written to the workspace before the agent runs |
| `verify` | Shell command to check the agent's work. `$BENCH_WORK_DIR` is replaced with the workspace path. Exit 0 = pass. |
| `timeout` | Max time in ms for the agent to work |
| `tags` | Array of tags for filtering (`/bench-list <tag>`) |

### Guidelines for new tasks

- Tasks should be self-contained — all needed files go in `setup_files`
- The `verify` script should be deterministic and test correctness, not style
- Use Python 3.10+ (no external dependencies)
- Name tasks with a category prefix: `quixbugs-`, `hard-`, `codegen-`, `perf-`, `security-`, `long-context-`
- Keep verification fast (under 30s)

## Cleanup and process safety

Each task runs in an isolated temp directory created with a distinctive prefix (`mktemp -d -t pi-bench` → `$TMPDIR/pi-bench.XXXXXX`). Every cleanup path is scoped to that prefix, so no code in this extension can ever `kill` or `rm` a path that doesn't have `pi-bench.` in its basename. Homebrew, Xcode, git, and any other tool's temp dirs are untouchable.

After every task — pass, fail, or abort — the benchmark automatically:

1. **Kills lingering processes** — finds roots both ways (argv mentions the workspace, or cwd is under it), then walks the full descendant tree with `pgrep -P` *before* killing. That ordering matters: once `python3 test_x.py` reparents to launchd, its argv doesn't mention the workspace anymore, so naive `pgrep -f` misses it. Walking descendants first catches it.
2. **Removes the temp directory** — deletes the workspace and unregisters it.

### Registry for crashed-session recovery

Active workspaces are tracked in memory *and* persisted to `~/.pi/agent/pi-terminal-bench/active-workdirs.txt`. If pi itself crashes mid-run (so `session_shutdown` never fires), the next run's `/bench-cleanup` can still find and sweep the orphans via the registry file.

### `/bench-cleanup`

Run manually if anything slips through. It:

1. Sweeps every workspace in the registry (in-memory + persisted) first.
2. Falls back to a broad sweep — but still scoped strictly to paths matching `/pi-bench\.` — for anything that was never registered.
3. Prints the PIDs and command lines it's about to kill, so you can see exactly what's going away.

### Task-level timeouts

Each task has a configurable `timeout` (default 180s; harder tasks use 240s or 360s). When a command hangs (e.g. running tests on buggy code with an infinite loop), the benchmark:

1. **Notifies the model** — sends a steer message explaining the command was killed due to a timeout and likely indicates an infinite loop
2. **Kills the hung process** — terminates the specific process that exceeded the time limit
3. **Lets the model retry** — the model keeps working with an extended time window (2x the original timeout) to fix the code and re-run tests
4. **Verifies normally** — if the model succeeds within the extended window, the task is scored as a pass

Only if the model exhausts the extended timeout is the task recorded as a **TIMEOUT**.

### No-change detection

If the agent fails to modify any files (e.g. due to connection errors or model failures), the task is marked as **FAIL** with "Agent made no changes to any files" — even if the verification script would have passed. This prevents false positives when the agent doesn't actually attempt the task.

### Context between tasks

In a batch run (`/bench-run quixbugs`), all tasks share the same conversation context. The model carries context from previous tasks, which may affect performance on later tasks. For isolated runs with clean context, run tasks individually in separate Pi sessions.

## Safety

- All tasks run in isolated temp directories under `$TMPDIR/pi-bench.XXXXXX`, created with a distinctive prefix so cleanup cannot touch paths owned by other tools
- Every cleanup path — per-task, `/bench-cleanup`, and session-shutdown — is scoped strictly to basenames starting with `pi-bench.`
- Active workspaces are persisted to `~/.pi/agent/pi-terminal-bench/active-workdirs.txt` so orphans from a crashed pi session can be recovered on the next run
- Tasks only contain Python/bash code that reads/writes within their workspace
- No network access, no system modifications, no file operations outside the temp directory
- Verification scripts only read from the workspace directory
- Stray processes (including descendants reparented to launchd) are killed after each task completes

## Contributing

Want to add tasks from [Terminal-Bench](https://github.com/laude-institute/terminal-bench) or other benchmarks? PRs are welcome. The full Terminal-Bench has 241 Docker-based tasks — we've ported a representative subset that runs without Docker and will expand over time.
