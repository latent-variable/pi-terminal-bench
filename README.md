# pi-terminal-bench

Self-contained benchmark suite for [pi](https://shittycodingagent.ai). Runs coding tasks locally through your pi CLI — you see the agent work in real time. No Docker, no Python frameworks, no external dependencies beyond what you already have.

## Requirements

| Dependency | Required | Why |
|---|---|---|
| **pi** (CLI) | Yes | Runs the agent under test |
| **Python 3.10+** | Yes | All tasks are Python-based; used for task setup and verification |
| **bash** | Yes | Task orchestration and some bash-specific tasks |

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

## Tasks — 60 total

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

This benchmark currently includes a subset of 60 tasks across 6 categories. It's designed to be extensible — PRs adding new tasks are welcome.

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
  "timeout": 120000,
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

## Safety

- All tasks run in isolated temp directories (`mktemp -d`)
- Tasks only contain Python/bash code that reads/writes within their workspace
- No network access, no system modifications, no file operations outside the temp directory
- Verification scripts only read from the workspace directory

## Contributing

Want to add tasks from [Terminal-Bench](https://github.com/terminal-bench/terminal-bench) or other benchmarks? PRs are welcome. The full Terminal-Bench has 89 tasks — we've ported a representative subset and will expand over time.
