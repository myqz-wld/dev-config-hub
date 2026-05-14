//! REVIEW_7 H2/H3/H4 落地：spawn 子进程并强制限时收割，杀整个 process group 防孙子持 pipe。
//!
//! ## 解决的问题
//!
//! 1. **H2**：`Command::output()` 同步等子进程 EOF 无 timeout，hook detach 子进程持 stdio pipe FD
//!    时永挂。
//! 2. **H3**：双 thread `read_to_end` 写法 OK，但 `join()` 在 detach 场景下仍卡到孙子关 fd ——
//!    "返回 partial output" 做不到。本模块用 `Arc<Mutex<Vec<u8>>>` 增量收 + 主线程超时**不 await
//!    join** 直接 take snapshot 返回。
//! 3. **H4**：`std::process::Child::kill()` 在 Unix 是 SIGKILL，但**只杀 direct child**（user
//!    shell 包 bun），bun 孙子 + hook 曾孙仍持 pipe FD。本模块 spawn 前 `setsid()` 让子进程开
//!    新 session/pgid（pgid == child pid），timeout 时 `killpg(pgid, SIGKILL)` 杀整组。
//!
//! ## Windows 路径
//!
//! Windows 无 fork+exec 模型 / 无 `(... &)` detach 语法 / 无 process group。fallback 到
//! `child.kill()` 已经够用（Bun runtime 默认用 `TerminateProcess`，进程能立即死）。

use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct CommandOutcome {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    /// 进程 exit code；timeout / 拿不到 code 时为 -2 / -1。
    /// **-2 = timed_out**：上层用这个判断是不是被 watchdog 杀的（vs 子进程自己非零退出）。
    pub code: i32,
    /// 内部状态：lib.rs 当前只透传 `code`（caller 已用 -2 判定）；保留字段方便日后 UI
    /// 想区分「watchdog 杀」vs「子进程自己 -2 exit」。
    #[allow(dead_code)]
    pub timed_out: bool,
    /// REVIEW_8 M5 / Group C3：stdout/stderr 任一被 5MB cap 截断时为 true。caller 可据此
    /// 在 UI 提示「输出已截断」+ 引导用户重定向到文件。lib.rs 当前未透传给 bridge —
    /// 后续可在 DchCommandResult 加 `truncated: bool` 字段把它送到 TS。
    #[allow(dead_code)]
    pub truncated: bool,
}

const KILL_CODE: i32 = -2;

/// REVIEW_8 M5 / Group C3：单流 buffer 上限 5MB。
///
/// 旧实现 reader thread 一直 `extend_from_slice` 不设上限，恶意 / 失控 hook (`yes 'x' &`)
/// 几秒就把 Rust 进程涨到 GB 级。给上限后超出部分直接 discard（仍 read 到 4KB chunk 让
/// pipe drain，否则 reader 阻塞 → child 在 write 上 block → 进程 hang）。
const MAX_BUF_BYTES: usize = 5 * 1024 * 1024;

/// Spawn `cmd` 并在 `timeout` 内强制收割：
/// - Unix：spawn 前 `setsid()` 开新 pgid，超时 `killpg(SIGKILL)` 杀整组（含 hook detach 孙子）
/// - Windows：fallback 到 `child.kill()`（无 process group 概念，且 detach 触发面窄）
/// - **不 await reader thread join**：detach 场景孙子持 pipe fd 让 reader 永不 EOF；超时即拿 snapshot
///
/// `cmd` 由 caller 配好 args / env / cwd。本函数会强制设 `stdout/stderr = piped()`。
pub fn spawn_with_timeout(mut cmd: Command, timeout: Duration) -> Result<CommandOutcome, String> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    // Unix：fork 后立即 setsid 让 child 成为新 session leader（pgid = child pid）。
    // setsid() 是 async-signal-safe，pre_exec 中调用安全。
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            cmd.pre_exec(|| {
                // 失败仅日志（无法在 pre_exec 内打印；返 Err 让 spawn 失败更糟）。
                // 极少数失败场景：当前进程已是 session leader（不可能，spawn child 必新 fork）。
                let _ = libc::setsid();
                Ok(())
            });
        }
    }

    let mut child = cmd.spawn().map_err(|e| format!("spawn 失败: {e}"))?;
    let pid = child.id() as i32;

    // take stdout/stderr handle 让 reader thread 拥有所有权。
    let stdout = child.stdout.take().ok_or("child.stdout None")?;
    let stderr = child.stderr.take().ok_or("child.stderr None")?;

    // 增量收：reader thread 4KB 一段读到共享 Vec；主线程超时后随时 take 当前快照。
    // 注意：reader 用 `read_to_end` 等价行为是 loop 直到 read 返回 0（EOF）；detach 孙子持 fd 时
    // **永不 EOF**，reader 会无限挂着 —— 所以主线程**超时后绝不 join reader**，让 thread 自然
    // detach 跟随进程 cleanup（OS 在主进程退出时清理）。
    let stdout_buf: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
    let stderr_buf: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
    // REVIEW_8 M5：任一 reader 触顶就 set，主线程 take outcome 时透传给 caller。
    let truncated_flag = Arc::new(AtomicBool::new(false));

    let stdout_buf_w = Arc::clone(&stdout_buf);
    let trunc_w1 = Arc::clone(&truncated_flag);
    thread::spawn(move || drain_to(stdout, stdout_buf_w, trunc_w1));
    let stderr_buf_w = Arc::clone(&stderr_buf);
    let trunc_w2 = Arc::clone(&truncated_flag);
    thread::spawn(move || drain_to(stderr, stderr_buf_w, trunc_w2));

    // 主线程 try_wait polling，超时杀整组。
    let start = Instant::now();
    let mut timed_out = false;
    let exit_code: i32 = loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                // 子进程自然退出。short grace 让 reader thread 把 EOF 后剩余字节收完。
                // 注意：仅当 stdio pipe 真 EOF（无 detach 孙子持 fd）才能短时间收齐；detach 场景
                // grace 也收不全 —— 那就是 partial output，可接受。
                thread::sleep(Duration::from_millis(50));
                break status.code().unwrap_or(-1);
            }
            Ok(None) => {
                if start.elapsed() >= timeout {
                    timed_out = true;
                    kill_process_group(&mut child, pid);
                    // 杀 group 后给 reader 一点时间收尾（fd 关闭后 read 立即 EOF）。
                    // 50ms 足够把已 buffered 的字节收完。
                    thread::sleep(Duration::from_millis(50));
                    break KILL_CODE;
                }
                thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(format!("try_wait 失败: {e}")),
        }
    };

    // take 当前 snapshot — 不 join reader thread（H3 关键）。
    let stdout_bytes = stdout_buf.lock().map(|v| v.clone()).unwrap_or_default();
    let stderr_bytes = stderr_buf.lock().map(|v| v.clone()).unwrap_or_default();

    Ok(CommandOutcome {
        stdout: stdout_bytes,
        stderr: stderr_bytes,
        code: exit_code,
        timed_out,
        truncated: truncated_flag.load(Ordering::Acquire),
    })
}

/// 增量读 4KB chunk 到共享 buffer 直到 EOF / read err。每次 read 后立即 lock+append，让主线程
/// 中途 take snapshot 也能拿到部分字节。失败 / EOF 后线程自然结束。
///
/// REVIEW_8 M5：buffer 触 MAX_BUF_BYTES 后停止 append，但**继续 read 走 chunk** 让 pipe drain
/// （否则 reader 阻塞 → child 在 write 上 block → 进程 hang）。
fn drain_to<R: Read>(mut r: R, buf: Arc<Mutex<Vec<u8>>>, truncated: Arc<AtomicBool>) {
    let mut chunk = [0u8; 4096];
    loop {
        match r.read(&mut chunk) {
            Ok(0) => return, // EOF
            Ok(n) => {
                if let Ok(mut b) = buf.lock() {
                    let remaining = MAX_BUF_BYTES.saturating_sub(b.len());
                    if remaining == 0 {
                        truncated.store(true, Ordering::Release);
                        // 已 cap：本 chunk 不 append，但仍读后续 chunk 让 pipe drain
                    } else if remaining < n {
                        b.extend_from_slice(&chunk[..remaining]);
                        truncated.store(true, Ordering::Release);
                    } else {
                        b.extend_from_slice(&chunk[..n]);
                    }
                }
            }
            Err(_) => return,
        }
    }
}

#[cfg(unix)]
fn kill_process_group(child: &mut Child, pid: i32) {
    // pid 既是 child pid 也是 pgid（pre_exec setsid 让它成为新 session leader）。
    // killpg(pgid, SIGKILL) 杀整组：bun + hook 子进程 + 任何 detach 孙子全死。
    unsafe {
        libc::killpg(pid, libc::SIGKILL);
    }
    // 同时调 child.kill 兜底（极少数 setsid 失败 / pgid 漂移场景）。
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(windows)]
fn kill_process_group(child: &mut Child, _pid: i32) {
    // Windows fallback：无 process group 概念，child.kill() 用 TerminateProcess，进程立即死。
    // detach 触发面窄（无 `(... &)` 语法），fallback 已够。
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 双大输出（stdout 100KB + stderr 100KB）正常返回完整 bytes，不死锁。
    /// 验 H3 反驳点：双 thread 增量读 vs 单 thread 串行读会死锁。
    #[test]
    #[cfg(unix)]
    fn double_large_output_no_deadlock() {
        let size = 100_000;
        let script = format!(
            "yes 'x' | head -c {size}; yes 'y' | head -c {size} 1>&2; exit 0"
        );
        let mut cmd = Command::new("/bin/sh");
        cmd.args(["-c", &script]);
        let r = spawn_with_timeout(cmd, Duration::from_secs(10)).unwrap();
        assert_eq!(r.code, 0, "双大输出应正常 exit 0");
        assert!(!r.timed_out);
        assert_eq!(r.stdout.len(), size);
        assert_eq!(r.stderr.len(), size);
    }

    /// detach 孙子持 pipe FD 场景：父 sh 立即 exit 0，本函数应**几乎立即返回** code=0 +
    /// stdout 含 "immediate"，**不等 detach 孙子死**（H3 关键 — 不 await reader join）。
    /// 旧实现 `cmd.output()` 会等 30s（孙子持 pipe 让 read_to_end 永挂）。
    #[test]
    #[cfg(unix)]
    fn detach_child_does_not_block_after_parent_exits() {
        let mut cmd = Command::new("/bin/sh");
        cmd.args(["-c", "(sleep 30 &); echo immediate; exit 0"]);
        let start = Instant::now();
        let r = spawn_with_timeout(cmd, Duration::from_secs(60)).unwrap();
        let elapsed = start.elapsed();
        // 父 sh 立即 exit + 50ms grace；松到 1.5s 给 CI 抖动余量。
        // 旧实现（cmd.output()）会等 30s（detach 孙子持 pipe FD 让 read_to_end 永挂）。
        assert!(
            elapsed < Duration::from_millis(1500),
            "detach 孙子不应拖住 helper，实际 elapsed={elapsed:?}（旧实现会卡 30s）"
        );
        assert_eq!(r.code, 0, "父 sh 正常 exit 0");
        assert!(!r.timed_out, "不是 watchdog 杀的（父进程主动退）");
        let stdout_str = String::from_utf8_lossy(&r.stdout);
        assert!(stdout_str.contains("immediate"), "应在 grace 内拿到 stdout: {stdout_str:?}");
    }

    /// 真 timeout 场景：父进程也卡（不只是 detach 孙子）—— watchdog 必须 killpg 杀整组。
    /// 验 H4：child.kill 只杀 direct child，killpg 才能杀整个 process tree。
    #[test]
    #[cfg(unix)]
    fn watchdog_kills_process_group_on_timeout() {
        let mut cmd = Command::new("/bin/sh");
        // 父 sh 自己也跑 sleep，超 timeout 触发 watchdog
        cmd.args(["-c", "echo before; sleep 60; echo after"]);
        let start = Instant::now();
        let r = spawn_with_timeout(cmd, Duration::from_millis(500)).unwrap();
        let elapsed = start.elapsed();
        // timeout 500ms + 2× 50ms grace = ~600ms；松到 2s
        assert!(
            elapsed < Duration::from_secs(2),
            "watchdog 应在 timeout+grace 内返回，实际 elapsed={elapsed:?}"
        );
        assert!(r.timed_out, "应被 watchdog timeout 杀");
        assert_eq!(r.code, KILL_CODE, "code 应 = -2 表 timeout 杀");
        let stdout_str = String::from_utf8_lossy(&r.stdout);
        assert!(stdout_str.contains("before"), "应拿到杀前 partial output: {stdout_str:?}");
        assert!(!stdout_str.contains("after"), "after 不应被执行（已被 killpg）");
    }

    /// 正常退出 + grace 期收完 stdout（无 detach 干扰）。
    #[test]
    #[cfg(unix)]
    fn normal_exit_collects_stdout() {
        let mut cmd = Command::new("/bin/sh");
        cmd.args(["-c", "echo hello; echo world 1>&2; exit 0"]);
        let r = spawn_with_timeout(cmd, Duration::from_secs(5)).unwrap();
        assert_eq!(r.code, 0);
        assert!(!r.timed_out);
        assert_eq!(String::from_utf8_lossy(&r.stdout).trim(), "hello");
        assert_eq!(String::from_utf8_lossy(&r.stderr).trim(), "world");
    }

    /// 非零 exit code 透传。
    #[test]
    #[cfg(unix)]
    fn nonzero_exit_preserved() {
        let mut cmd = Command::new("/bin/sh");
        cmd.args(["-c", "exit 42"]);
        let r = spawn_with_timeout(cmd, Duration::from_secs(5)).unwrap();
        assert_eq!(r.code, 42);
        assert!(!r.timed_out);
    }

    /// REVIEW_8 M5 / Group C3：单流写超 5MB → buffer cap 到 5MB + truncated=true，进程仍正常退出。
    /// 关键：cap 后 reader 必须继续 drain pipe，否则 child 在 write 上 block → 进程 hang。
    #[test]
    #[cfg(unix)]
    fn buffer_cap_truncates_oversize_stdout() {
        // 写 6MB（超 5MB cap），yes 流式写不会一下子全发，需要 reader 持续 drain
        let mut cmd = Command::new("/bin/sh");
        // dd 比 yes 更稳定可控；6 * 1024 * 1024 / 4096 = 1536 个 4KB block
        cmd.args(["-c", "dd if=/dev/zero bs=4096 count=1536 2>/dev/null; exit 0"]);
        let start = Instant::now();
        let r = spawn_with_timeout(cmd, Duration::from_secs(15)).unwrap();
        let elapsed = start.elapsed();
        // 应在合理时间内完成（不 hang）— dd 写 6MB 远小于 1s
        assert!(
            elapsed < Duration::from_secs(5),
            "buffer cap 后应继续 drain pipe，不让 child hang。实际 elapsed={:?}",
            elapsed
        );
        assert_eq!(r.code, 0, "child 应正常 exit 0");
        assert!(!r.timed_out, "不是 watchdog 杀的");
        assert!(r.truncated, "stdout 超 5MB 应标 truncated=true");
        assert_eq!(r.stdout.len(), MAX_BUF_BYTES, "buffer 应正好 cap 到 MAX_BUF_BYTES");
    }

    /// 小输出（<5MB）不应误标 truncated。
    #[test]
    #[cfg(unix)]
    fn small_output_not_truncated() {
        let mut cmd = Command::new("/bin/sh");
        cmd.args(["-c", "echo small; exit 0"]);
        let r = spawn_with_timeout(cmd, Duration::from_secs(5)).unwrap();
        assert!(!r.truncated, "小输出不应标 truncated");
        assert_eq!(r.code, 0);
    }
}
