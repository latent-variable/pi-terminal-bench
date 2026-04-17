import { mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const PACKAGE_DIR = path.resolve(__dirname, "..");
const TASKS_DIR = path.join(PACKAGE_DIR, "tasks");
const STATE_DIR = path.join(process.env.HOME ?? ".", ".pi", "agent", "pi-terminal-bench");
const RESULTS_DIR = path.join(STATE_DIR, "results");
const STATUS_KEY = "terminal-bench";

// All benchmark workspaces are named with this prefix so cleanup can
// target only directories we created. `mktemp -d -t pi-bench` produces
// $TMPDIR/pi-bench.XXXXXX on macOS — distinct from generic tmp.XXXXXX
// paths that git, homebrew, xcode, and other tools create.
const WORKDIR_PREFIX = "pi-bench";

// Registry of in-flight workspaces, persisted so a crashed pi session's
// orphans can be recovered by /bench-cleanup on the next run.
const REGISTRY_FILE = path.join(STATE_DIR, "active-workdirs.txt");

interface TaskDef {
	name: string;
	description: string;
	dataset?: string;
	instruction: string;
	setup_files: Record<string, string>;
	verify: string;
	timeout: number;
	tags: string[];
}

interface TaskResult {
	task: string;
	status: "pass" | "fail" | "error" | "timeout";
	duration_ms: number;
	verify_output: string;
	model: string;
	timestamp: string;
}

// Category definitions
const CATEGORIES: { key: string; label: string; desc: string; match: (t: TaskDef) => boolean }[] = [
	{ key: "quixbugs", label: "QuixBugs", desc: "Single-line Python bug fixes", match: (t) => t.name.startsWith("quixbugs-") },
	{ key: "hard", label: "Hard", desc: "Multi-step coding challenges", match: (t) => t.name.startsWith("hard-") },
	{ key: "long-context", label: "Long Context", desc: "Large codebase / multi-file tasks", match: (t) => t.name.startsWith("long-context-") },
	{ key: "codegen", label: "Code Generation", desc: "Build programs from a spec", match: (t) => t.name.startsWith("codegen-") },
	{ key: "perf", label: "Performance", desc: "Optimize slow code", match: (t) => t.name.startsWith("perf-") },
	{ key: "security", label: "Security", desc: "Find and fix vulnerabilities", match: (t) => t.name.startsWith("security-") },
];

function loadTask(name: string): TaskDef | null {
	const candidates = [
		path.join(TASKS_DIR, `${name}.json`),
		path.join(TASKS_DIR, name),
	];
	for (const p of candidates) {
		if (existsSync(p)) {
			return JSON.parse(readFileSync(p, "utf-8"));
		}
	}
	return null;
}

function listTasks(filter?: string): TaskDef[] {
	if (!existsSync(TASKS_DIR)) return [];
	const files = readdirSync(TASKS_DIR).filter((f) => f.endsWith(".json")).sort();
	const tasks: TaskDef[] = [];
	for (const file of files) {
		const task: TaskDef = JSON.parse(readFileSync(path.join(TASKS_DIR, file), "utf-8"));
		if (filter) {
			const q = filter.toLowerCase();
			if (
				task.name.toLowerCase().includes(q) ||
				(task.dataset ?? "").toLowerCase().includes(q) ||
				task.tags.some((t) => t.toLowerCase().includes(q))
			) {
				tasks.push(task);
			}
		} else {
			tasks.push(task);
		}
	}
	return tasks;
}

function getAllTasks(): TaskDef[] {
	return listTasks();
}

function formatCategorySummary(): string {
	const all = getAllTasks();
	const lines: string[] = [];
	for (const cat of CATEGORIES) {
		const count = all.filter(cat.match).length;
		if (count > 0) {
			lines.push(`  ${cat.key} (${count}) — ${cat.desc}`);
		}
	}
	const categorized = all.filter((t) => CATEGORIES.some((c) => c.match(t)));
	const uncategorized = all.length - categorized.length;
	if (uncategorized > 0) {
		lines.push(`  other (${uncategorized}) — Uncategorized tasks`);
	}
	return `${all.length} tasks in ${CATEGORIES.length} categories:\n${lines.join("\n")}\n\nRun a category:  /bench-run quixbugs\nRun a single task:  /bench-run quixbugs-python-flatten\nRun everything:  /bench-run all`;
}

// ── Cleanup helpers ──────────────────────────────────────────────────────────

/** Workspaces currently owned by a running task. Swept on session shutdown. */
const activeWorkDirs = new Set<string>();

/** Only treat a path as benchmark-owned if it carries our prefix. */
function isOwnedWorkDir(dir: string): boolean {
	if (!dir) return false;
	const base = path.basename(dir);
	return base.startsWith(`${WORKDIR_PREFIX}.`);
}

function registerWorkDir(dir: string): void {
	if (!isOwnedWorkDir(dir)) return;
	activeWorkDirs.add(dir);
	try {
		mkdirSync(STATE_DIR, { recursive: true });
		appendFileSync(REGISTRY_FILE, dir + "\n");
	} catch {
		// Best-effort; registry is a recovery aid, not a correctness invariant.
	}
}

function unregisterWorkDir(dir: string): void {
	activeWorkDirs.delete(dir);
	try {
		if (!existsSync(REGISTRY_FILE)) return;
		const remaining = readFileSync(REGISTRY_FILE, "utf-8")
			.split("\n")
			.filter((line) => line && line !== dir);
		writeFileSync(REGISTRY_FILE, remaining.length ? remaining.join("\n") + "\n" : "");
	} catch {
		// Best-effort
	}
}

/** Read the persisted registry — used to recover orphans from crashed sessions. */
function readRegistry(): string[] {
	try {
		if (!existsSync(REGISTRY_FILE)) return [];
		return readFileSync(REGISTRY_FILE, "utf-8")
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l && isOwnedWorkDir(l));
	} catch {
		return [];
	}
}

/**
 * Kill processes associated with `dir`. Finds roots two ways — argv references
 * the dir, or cwd is under the dir — then walks descendants with pgrep -P
 * before killing, so orphaned grandchildren (e.g. `python3 test_x.py` spawned
 * by `cd $DIR && python3 test_x.py`, whose argv no longer mentions the dir)
 * are caught before reparenting to launchd loses them.
 */
async function killProcessesInDir(pi: ExtensionAPI, dir: string): Promise<void> {
	if (!dir) return;
	const script = `
		set +e
		dir=${JSON.stringify(dir)}
		# macOS resolves /var/folders -> /private/var/folders for process cwd,
		# so also match the realpath form.
		dir_real=$(cd "$dir" 2>/dev/null && pwd -P || echo "$dir")
		# Roots: argv mentions the dir, OR cwd is under the dir (either form).
		roots=$(pgrep -f "$dir" 2>/dev/null; pgrep -f "$dir_real" 2>/dev/null)
		cwd_roots=$(lsof -d cwd -Fpn 2>/dev/null | awk -v d1="$dir" -v d2="$dir_real" '
			/^p/ { pid = substr($0, 2); next }
			/^n/ { cwd = substr($0, 2); if (index(cwd, d1) == 1 || index(cwd, d2) == 1) print pid }
		')
		roots=$(printf '%s\\n%s\\n' "$roots" "$cwd_roots" | grep -E '^[0-9]+$' | sort -u)
		[ -z "$roots" ] && exit 0
		# Walk descendants BEFORE killing so reparenting doesn't drop them.
		all="$roots"
		frontier="$roots"
		for _ in 1 2 3 4 5 6 7 8; do
			[ -z "$frontier" ] && break
			kids=$(printf '%s\\n' $frontier | xargs -n1 pgrep -P 2>/dev/null | grep -E '^[0-9]+$' | sort -u)
			[ -z "$kids" ] && break
			new=$(printf '%s\\n' $kids | grep -vxF -f <(printf '%s\\n' $all) 2>/dev/null)
			[ -z "$new" ] && break
			all=$(printf '%s\\n%s\\n' "$all" "$new" | sort -u)
			frontier="$new"
		done
		printf '%s\\n' $all | xargs kill 2>/dev/null
		sleep 0.5
		printf '%s\\n' $all | xargs kill -9 2>/dev/null
		exit 0
	`;
	try {
		await pi.exec("bash", ["-lc", script], { timeout: 10000 });
	} catch {
		// Best-effort cleanup
	}
}

/** Remove a temp workspace directory and drop it from the registry. */
function cleanupWorkDir(dir: string): void {
	unregisterWorkDir(dir);
	// Only delete directories we own. The prefix guard is the single rule —
	// we will never rm -rf a path without `pi-bench.` in its basename.
	if (!isOwnedWorkDir(dir)) return;
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch {
		// Best-effort cleanup
	}
}

export default function terminalBench(pi: ExtensionAPI) {
	mkdirSync(RESULTS_DIR, { recursive: true });

	// ── /bench-list ──────────────────────────────────────────────────────
	pi.registerCommand("bench-list", {
		description: "List available benchmark tasks. No args = category summary. Pass a category or filter to see individual tasks.",
		handler: async (args, ctx) => {
			const filter = args.trim() || undefined;
			if (!filter) {
				ctx.ui.notify(formatCategorySummary(), "info");
				return;
			}
			const tasks = listTasks(filter);
			if (tasks.length === 0) {
				ctx.ui.notify(`No tasks found matching '${filter}'`, "warning");
				return;
			}
			const lines = tasks.map((t) => `  ${t.name}  (${t.tags.join(", ")})`);
			ctx.ui.notify(`${tasks.length} tasks matching '${filter}':\n${lines.join("\n")}`, "info");
		},
	});

	// ── /bench-run ───────────────────────────────────────────────────────
	pi.registerCommand("bench-run", {
		description: "Run benchmark tasks. Usage: /bench-run <task|category|all> [...more tasks] [provider/model]",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			if (parts.length === 0) {
				ctx.ui.notify(
					`Usage: /bench-run <task|category|all> [...more tasks] [provider/model]\n\n${formatCategorySummary()}`,
					"warning",
				);
				return;
			}

			// Separate targets from model (model contains '/')
			const targets: string[] = [];
			let requestedModel = "";
			for (const part of parts) {
				if (part.includes("/")) {
					requestedModel = part;
				} else {
					targets.push(part);
				}
			}

			const activeModel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "";
			const selectedModel = requestedModel || activeModel;

			if (!selectedModel) {
				ctx.ui.notify("No model specified and no active model. Pass provider/model or select one in Pi.", "error");
				return;
			}

			// Resolve targets to task list — supports multiple task names, categories, or "all"
			let tasks: TaskDef[] = [];
			let runLabel: string = targets.join(" ");

			if (targets.length === 1 && targets[0]!.toLowerCase() === "all") {
				tasks = getAllTasks();
				runLabel = "all";
			} else {
				for (const target of targets) {
					// Try exact task match first
					const exactTask = loadTask(target);
					if (exactTask) {
						// Avoid duplicates
						if (!tasks.some((t) => t.name === exactTask.name)) {
							tasks.push(exactTask);
						}
					} else {
						// Try as category/filter
						const matched = listTasks(target);
						for (const t of matched) {
							if (!tasks.some((existing) => existing.name === t.name)) {
								tasks.push(t);
							}
						}
					}
				}
			}

			if (tasks.length === 0) {
				ctx.ui.notify(`No tasks found matching '${runLabel}'. Use /bench-list to see available tasks and categories.`, "error");
				return;
			}

			const results: TaskResult[] = [];
			let passed = 0;
			let failed = 0;
			const total = tasks.length;
			const isBatch = total > 1;

			if (isBatch) {
				ctx.ui.notify(
					`Running ${total} tasks [${runLabel}] with ${selectedModel}\n${"═".repeat(60)}`,
					"info",
				);
				ctx.ui.setStatus(STATUS_KEY, `bench: 0/${total} passed | starting...`);
			}

			for (let i = 0; i < total; i++) {
				const task = tasks[i]!;
				const progress = isBatch ? `[${i + 1}/${total}] ` : "";

				// ── Task header ──
				ctx.ui.notify(
					`\n${"═".repeat(60)}\n${progress}TASK: ${task.name}\n${task.description}\n${"═".repeat(60)}`,
					"info",
				);

				if (isBatch) {
					ctx.ui.setStatus(STATUS_KEY, `bench: ${passed}/${i} passed | running ${task.name} (${i + 1}/${total})`);
				}

				const result = await runSingleTask(pi, ctx, task, selectedModel);
				results.push(result);

				if (result.status === "pass") {
					passed++;
				} else {
					failed++;
				}

				// ── Assessment block — clearly separated from agent output ──
				const dur = result.duration_ms < 1000 ? `${result.duration_ms}ms` : `${Math.round(result.duration_ms / 1000)}s`;
				const border = result.status === "pass" ? "=" : "!";
				const line = border.repeat(60);

				let assessment = `\n${line}\n`;
				if (result.status === "pass") {
					assessment += `  PASS  ${task.name}  (${dur})`;
				} else if (result.status === "timeout") {
					assessment += `  TIMEOUT  ${task.name}  (${dur})`;
				} else {
					assessment += `  FAIL  ${task.name}  (${dur})`;
				}

				// Show verification output (test results)
				if (result.verify_output) {
					assessment += `\n\n  Verification:\n`;
					for (const vline of result.verify_output.split("\n").slice(0, 15)) {
						assessment += `    ${vline}\n`;
					}
				}

				if (isBatch) {
					assessment += `\n  Score: ${passed} passed, ${failed} failed out of ${i + 1} completed (${total - i - 1} remaining)`;
				}
				assessment += `\n${line}`;

				ctx.ui.notify(assessment, result.status === "pass" ? "info" : "error");

				// Update live scoreboard in status bar
				if (isBatch) {
					const pct = Math.round((passed / (i + 1)) * 100);
					ctx.ui.setStatus(STATUS_KEY, `bench: ${passed}/${i + 1} passed (${pct}%) | ${total - i - 1} remaining`);
				}

				// Check if user aborted
				if (ctx.signal?.aborted) {
					ctx.ui.notify("Benchmark aborted by user.", "warning");
					break;
				}
			}

			if (isBatch) {
				ctx.ui.setStatus(STATUS_KEY, undefined);

				const ts = new Date().toISOString().replace(/[:.]/g, "-");
				const resultFile = path.join(RESULTS_DIR, `run-${ts}.json`);
				const pct = Math.round((passed / total) * 100);
				writeFileSync(resultFile, JSON.stringify({
					model: selectedModel,
					filter: runLabel,
					timestamp: new Date().toISOString(),
					summary: { total, passed, failed },
					results,
				}, null, 2));

				ctx.ui.notify(
					`\n${"═".repeat(60)}\n` +
					`  FINAL SCORE: ${passed}/${total} passed (${pct}%)\n` +
					`  Model: ${selectedModel}\n` +
					`  Failed: ${failed}\n` +
					`  Results: ${resultFile}\n` +
					`${"═".repeat(60)}`,
					failed === 0 ? "info" : "error",
				);
			}
		},
	});

	// ── /bench-doctor ────────────────────────────────────────────────────
	pi.registerCommand("bench-doctor", {
		description: "Check prerequisites for running benchmarks.",
		handler: async (_args, ctx) => {
			const allTasks = getAllTasks();
			const catSummary = CATEGORIES.map((c) => {
				const n = allTasks.filter(c.match).length;
				return `  ${c.label}: ${n}`;
			}).join("\n");

			const script = [
				"set -e",
				`echo "python3: $(command -v python3 >/dev/null 2>&1 && python3 --version 2>/dev/null || echo 'not found')"`,
			].join("; ");

			const result = await pi.exec("bash", ["-lc", script]);
			const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "(none)";
			ctx.ui.notify(
				`${result.stdout.trim()}\nmodel: ${model}\ntasks: ${allTasks.length} total\n${catSummary}`,
				result.code === 0 ? "info" : "error",
			);
		},
	});

	// ── /bench-results ───────────────────────────────────────────────────
	pi.registerCommand("bench-results", {
		description: "Show benchmark results. No args = summary of recent runs. Pass index (1-10) for detailed breakdown.",
		handler: async (args, ctx) => {
			if (!existsSync(RESULTS_DIR)) {
				ctx.ui.notify("No results yet. Run /bench-run first.", "info");
				return;
			}
			const files = readdirSync(RESULTS_DIR)
				.filter((f) => f.endsWith(".json"))
				.sort()
				.reverse()
				.slice(0, 10);

			if (files.length === 0) {
				ctx.ui.notify("No results yet.", "info");
				return;
			}

			const runIndex = parseInt(args.trim(), 10);

			if (!isNaN(runIndex) && runIndex >= 1 && runIndex <= files.length) {
				const data = JSON.parse(readFileSync(path.join(RESULTS_DIR, files[runIndex - 1]!), "utf-8"));
				const s = data.summary;
				const header = `${data.model} — ${s.passed}/${s.total} passed (${Math.round((s.passed / s.total) * 100)}%)\n${data.timestamp}\n${data.filter ? `Filter: ${data.filter}` : "All tasks"}\n`;

				const passedTasks: string[] = [];
				const failedTasks: string[] = [];

				for (const r of data.results) {
					const tag = r.status === "pass" ? "PASS" : r.status === "timeout" ? "TIME" : "FAIL";
					const dur = r.duration_ms < 1000 ? `${r.duration_ms}ms` : `${Math.round(r.duration_ms / 1000)}s`;
					const line = `  [${tag}] ${r.task} (${dur})`;

					if (r.status === "pass") {
						passedTasks.push(line);
					} else {
						const reason = r.verify_output ? ` — ${r.verify_output.split("\n")[0]?.slice(0, 80)}` : "";
						failedTasks.push(`${line}${reason}`);
					}
				}

				let output = header;
				if (failedTasks.length > 0) {
					output += `\nFailed (${failedTasks.length}):\n${failedTasks.join("\n")}`;
				}
				if (passedTasks.length > 0) {
					output += `\nPassed (${passedTasks.length}):\n${passedTasks.join("\n")}`;
				}

				ctx.ui.notify(output, failedTasks.length > 0 ? "error" : "info");
			} else {
				const lines: string[] = [];
				for (let i = 0; i < files.length; i++) {
					const data = JSON.parse(readFileSync(path.join(RESULTS_DIR, files[i]!), "utf-8"));
					const s = data.summary;
					const pct = Math.round((s.passed / s.total) * 100);
					const filter = data.filter ? ` [${data.filter}]` : "";
					lines.push(`  ${i + 1}. ${data.model}${filter} — ${s.passed}/${s.total} (${pct}%) — ${data.timestamp}`);
				}
				ctx.ui.notify(`Recent runs (use /bench-results <N> for details):\n${lines.join("\n")}`, "info");
			}
		},
	});

	// ── /bench-cleanup ──────────────────────────────────────────────────
	pi.registerCommand("bench-cleanup", {
		description: "Find and kill any stray benchmark processes running under pi-bench.* workspaces (leftovers from aborted tasks or crashed sessions).",
		handler: async (_args, ctx) => {
			// Sweep per-workspace first — this is the narrowest scope.
			// Dirs come from (a) the in-memory set and (b) the persisted registry,
			// so crashed-session leftovers are recovered.
			const registryDirs = readRegistry();
			const allDirs = Array.from(new Set([...activeWorkDirs, ...registryDirs])).filter(isOwnedWorkDir);
			const perDirReports: string[] = [];
			for (const dir of allDirs) {
				await killProcessesInDir(pi, dir).catch(() => {});
				cleanupWorkDir(dir);
				perDirReports.push(`  swept ${dir}`);
			}
			// Broad sweep scoped ONLY to our prefix — catches anything we never
			// tracked (e.g. if a task failed before registration). Cannot touch
			// other tools' temp dirs: only `*/pi-bench.*` paths match.
			const result = await pi.exec("bash", ["-lc", `
				set +e
				# Roots: any process with ${WORKDIR_PREFIX}. in its argv or cwd.
				arg_roots=$(pgrep -f '/${WORKDIR_PREFIX}\\.' 2>/dev/null)
				cwd_roots=$(lsof -d cwd -Fpn 2>/dev/null | awk '
					/^p/ { pid = substr($0, 2); next }
					/^n/ { cwd = substr($0, 2); if (cwd ~ /\\/${WORKDIR_PREFIX}\\./) print pid }
				')
				roots=$(printf '%s\\n%s\\n' "$arg_roots" "$cwd_roots" | grep -E '^[0-9]+$' | sort -u)
				if [ -z "$roots" ]; then
					echo "No stray ${WORKDIR_PREFIX}.* processes found."
					exit 0
				fi
				# Walk descendants BEFORE killing so orphans don't escape reparenting.
				all="$roots"
				frontier="$roots"
				for _ in 1 2 3 4 5 6 7 8; do
					[ -z "$frontier" ] && break
					kids=$(printf '%s\\n' $frontier | xargs -n1 pgrep -P 2>/dev/null | grep -E '^[0-9]+$' | sort -u)
					[ -z "$kids" ] && break
					new=$(printf '%s\\n' $kids | grep -vxF -f <(printf '%s\\n' $all) 2>/dev/null)
					[ -z "$new" ] && break
					all=$(printf '%s\\n%s\\n' "$all" "$new" | sort -u)
					frontier="$new"
				done
				echo "Killing processes under ${WORKDIR_PREFIX}.* workspaces:"
				for pid in $all; do
					cmd=$(ps -p "$pid" -o args= 2>/dev/null)
					[ -n "$cmd" ] && echo "  PID $pid: $cmd"
				done
				printf '%s\\n' $all | xargs kill 2>/dev/null
				sleep 0.5
				printf '%s\\n' $all | xargs kill -9 2>/dev/null
				echo "Killed."
			`], { timeout: 15000 });
			const header = perDirReports.length > 0
				? `Swept ${perDirReports.length} registered workspace(s):\n${perDirReports.join("\n")}\n\n`
				: "";
			ctx.ui.notify(header + (result.stdout.trim() || "Cleanup complete."), "info");
		},
	});

	// ── session_shutdown sweep ─────────────────────────────────────────
	// Fires on Ctrl+C, Ctrl+D, SIGHUP, SIGTERM. Any task that didn't reach
	// its Step 7 cleanup (user killed pi mid-run, crash, etc.) would leave
	// python children orphaned to launchd. Sweep every tracked workspace
	// plus a broad fallback for anything we never tracked.
	pi.on("session_shutdown", async () => {
		const dirs = Array.from(activeWorkDirs);
		for (const dir of dirs) {
			await killProcessesInDir(pi, dir).catch(() => {});
			cleanupWorkDir(dir);
		}
		try {
			// Broad fallback — scoped strictly to our prefix. Other tools'
			// temp dirs (tmp.XXXXXX, homebrew-*, xcode-*) are never touched.
			await pi.exec("bash", ["-lc", `
				set +e
				arg_roots=$(pgrep -f '/${WORKDIR_PREFIX}\\.' 2>/dev/null)
				cwd_roots=$(lsof -d cwd -Fpn 2>/dev/null | awk '
					/^p/ { pid = substr($0, 2); next }
					/^n/ { cwd = substr($0, 2); if (cwd ~ /\\/${WORKDIR_PREFIX}\\./) print pid }
				')
				roots=$(printf '%s\\n%s\\n' "$arg_roots" "$cwd_roots" | grep -E '^[0-9]+$' | sort -u)
				[ -z "$roots" ] && exit 0
				all="$roots"; frontier="$roots"
				for _ in 1 2 3 4 5 6 7 8; do
					[ -z "$frontier" ] && break
					kids=$(printf '%s\\n' $frontier | xargs -n1 pgrep -P 2>/dev/null | grep -E '^[0-9]+$' | sort -u)
					[ -z "$kids" ] && break
					new=$(printf '%s\\n' $kids | grep -vxF -f <(printf '%s\\n' $all) 2>/dev/null)
					[ -z "$new" ] && break
					all=$(printf '%s\\n%s\\n' "$all" "$new" | sort -u)
					frontier="$new"
				done
				printf '%s\\n' $all | xargs kill 2>/dev/null
				sleep 0.3
				printf '%s\\n' $all | xargs kill -9 2>/dev/null
			`], { timeout: 5000 });
		} catch {
			// Best-effort; shutdown path may close pi.exec early.
		}
	});
}

// ── Task runner ────────────────────────────────────────────────────────────

/**
 * Run a single benchmark task using Pi's native agent execution.
 *
 * Instead of spawning a child pi process, we:
 * 1. Set up the workspace with task files
 * 2. Send the instruction as a user message via pi.sendUserMessage()
 * 3. Wait for the agent to finish via ctx.waitForIdle()
 * 4. Run the verification script
 *
 * This means the user sees the agent work exactly like normal Pi usage —
 * thinking, tool calls, file edits, command output — all rendered natively.
 * Escape works to abort. No subprocess management.
 */
async function runSingleTask(
	pi: ExtensionAPI,
	ctx: any,
	task: TaskDef,
	model: string,
): Promise<TaskResult> {
	const start = Date.now();
	const timestamp = new Date().toISOString();

	// Step 1: Create a temp workspace with our distinctive prefix so cleanup
	// can target only directories we own. Produces $TMPDIR/pi-bench.XXXXXX.
	const mkdirResult = await pi.exec("bash", ["-lc", `mktemp -d -t ${WORKDIR_PREFIX}`]);
	const workDir = mkdirResult.stdout.trim();

	if (!workDir || mkdirResult.code !== 0 || !isOwnedWorkDir(workDir)) {
		return {
			task: task.name,
			status: "error",
			duration_ms: Date.now() - start,
			verify_output: "Failed to create temp directory",
			model,
			timestamp,
		};
	}

	// Record in memory + persist to registry so a crashed pi session's
	// orphans can be recovered by /bench-cleanup on the next run.
	registerWorkDir(workDir);

	// Step 2: Write setup files
	for (const [filename, content] of Object.entries(task.setup_files)) {
		const filePath = path.join(workDir, filename);
		const dir = path.dirname(filePath);
		mkdirSync(dir, { recursive: true });
		writeFileSync(filePath, content);
	}

	// Fingerprint setup files so we can detect if the agent made any changes
	const setupFingerprints: Record<string, string> = {};
	for (const [filename, content] of Object.entries(task.setup_files)) {
		setupFingerprints[filename] = createHash("md5").update(content).digest("hex");
	}

	// Step 3: Send the task instruction as a user message.
	// Use deliverAs: "followUp" so it queues properly if the agent is still finishing.
	// The agent processes it natively — the user sees everything in Pi's UI.
	const instruction = [
		`[Benchmark Task: ${task.name}]`,
		"",
		task.instruction,
		"",
		`All files are in: ${workDir}`,
		`Work only within that directory. Do not modify files outside it.`,
	].join("\n");

	pi.sendUserMessage(instruction, { deliverAs: "followUp" });

	// Step 4: Wait for the agent to actually pick up the message and finish,
	// with a timeout to prevent runaway tasks (e.g. infinite loops in tests).
	const taskTimeout = task.timeout || 180000; // default 3 minutes
	let timedOut = false;

	// Brief yield to let the message get queued
	await new Promise((r) => setTimeout(r, 100));

	// Wait for agent to start processing (not idle) or for message to be consumed
	const waitStart = Date.now();
	while (ctx.isIdle() && ctx.hasPendingMessages() && Date.now() - waitStart < 10000) {
		if (Date.now() - start > taskTimeout) { timedOut = true; break; }
		await new Promise((r) => setTimeout(r, 100));
	}

	// Now wait for the agent to actually finish, polling with timeout checks
	if (!timedOut) {
		while (!ctx.isIdle() || ctx.hasPendingMessages()) {
			if (Date.now() - start > taskTimeout || ctx.signal?.aborted) break;
			// Poll in short intervals so we can check the timeout
			await new Promise((r) => setTimeout(r, 500));
		}
		if (Date.now() - start > taskTimeout) timedOut = true;
	}

	// Process timeout: a command the model ran likely hung (e.g. running
	// tests on buggy code with an infinite loop).  Kill the hung process
	// and tell the model what happened so it can fix the code and retry.
	// Keep waiting — don't end the task yet.
	if (timedOut) {
		// Queue the steer message BEFORE killing the process.
		// "steer" messages are held while a tool call is active and
		// delivered the instant it finishes.  By queuing first, the
		// model sees the timeout explanation immediately after the
		// empty tool result — no gap where it's confused by "(no output)".
		pi.sendUserMessage(
			[
				`[Benchmark] The command you just ran was killed because it exceeded the ${Math.round(taskTimeout / 1000)}s time limit.`,
				`This usually means the code has an infinite loop or hangs on certain inputs.`,
				`Fix the bug and try again. The files are in: ${workDir}`,
			].join(" "),
			{ deliverAs: "steer" },
		);

		await killProcessesInDir(pi, workDir);

		// Give the model more time to fix the code and re-run tests.
		// Extended timeout = 2x the original task timeout.
		const extendedTimeout = taskTimeout * 2;
		const extendedDeadline = start + extendedTimeout;

		while (!ctx.isIdle() || ctx.hasPendingMessages()) {
			if (Date.now() > extendedDeadline || ctx.signal?.aborted) break;
			await new Promise((r) => setTimeout(r, 500));
		}

		// If we hit the extended timeout, the model is truly stuck.
		if (Date.now() > extendedDeadline && (!ctx.isIdle() || ctx.hasPendingMessages())) {
			await killProcessesInDir(pi, workDir);
			cleanupWorkDir(workDir);
			return {
				task: task.name,
				status: "timeout",
				duration_ms: Date.now() - start,
				verify_output: `Task timed out after ${Math.round(extendedTimeout / 1000)}s (including retry window)`,
				model,
				timestamp,
			};
		}

		// Model finished — fall through to the normal verification below.
	}

	// Check if user aborted
	if (ctx.signal?.aborted) {
		await killProcessesInDir(pi, workDir);
		cleanupWorkDir(workDir);
		return {
			task: task.name,
			status: "error",
			duration_ms: Date.now() - start,
			verify_output: "Aborted by user",
			model,
			timestamp,
		};
	}

	// Step 5: Check if the agent actually modified any files.
	// If nothing changed, the agent failed to do its job (e.g. connection errors).
	let filesChanged = false;
	for (const [filename, originalHash] of Object.entries(setupFingerprints)) {
		const filePath = path.join(workDir, filename);
		if (existsSync(filePath)) {
			const currentHash = createHash("md5").update(readFileSync(filePath)).digest("hex");
			if (currentHash !== originalHash) {
				filesChanged = true;
				break;
			}
		} else {
			// File was deleted — that counts as a change
			filesChanged = true;
			break;
		}
	}

	if (!filesChanged) {
		await killProcessesInDir(pi, workDir);
		cleanupWorkDir(workDir);
		return {
			task: task.name,
			status: "fail",
			duration_ms: Date.now() - start,
			verify_output: "Agent made no changes to any files",
			model,
			timestamp,
		};
	}

	// Step 6: Run verification — even if we timed out, the agent may have
	// applied the fix before the timeout.  Give it credit if tests pass.
	const verifyCmd = task.verify.replace(/\$BENCH_WORK_DIR/g, workDir);
	const verifyResult = await pi.exec("bash", ["-lc", verifyCmd], { timeout: 30000 });
	const verifyOutput = `${verifyResult.stdout}\n${verifyResult.stderr}`.trim();

	// Step 7: Cleanup
	await killProcessesInDir(pi, workDir);
	cleanupWorkDir(workDir);

	return {
		task: task.name,
		status: verifyResult.code === 0 ? "pass" : "fail",
		duration_ms: Date.now() - start,
		verify_output: verifyOutput.slice(0, 500),
		model,
		timestamp,
	};
}
