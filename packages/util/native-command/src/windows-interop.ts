/**
 * Resolution of the Windows executables reached through WSL interop.
 *
 * Interop keeps working when a host disables `appendWindowsPath`; only the
 * PATH entries that name the Windows binaries disappear. A missing PATH name
 * therefore falls back to the executable inside the mounted Windows system
 * directory, which `wslpath` reports for the drive the Windows system lives on.
 * @module @deepseek-ai/dsh-native-command/windows-interop
 */

import type { NativeCommandRunner } from './runner.ts'

/** Whether one runner failure reports a command the host could not find. */
function isMissingExecutable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

/**
 * The Windows directory holding the system executables interop starts.
 *
 * `SystemRoot` and `WINDIR` describe an installation on a drive other than
 * `C:`, but a WSL process inherits neither unless the host passes them through,
 * so the conventional location is the fallback rather than the default.
 * @param env - environment to read the Windows installation from.
 * @returns the drive-rooted directory, without a trailing separator.
 */
export function windowsSystemDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.SystemRoot ?? env.WINDIR
  const directory = configured === undefined || configured === '' ? 'C:\\Windows' : configured
  return directory.replace(/\\+$/, '')
}

/**
 * The mounted Linux path of one Windows executable.
 * @param windowsPath - drive-rooted Windows path.
 * @param signal - caller lifetime.
 * @param run - shell-free command runner.
 * @returns the path `wslpath` reports, or null when the drive is not mounted.
 */
async function mountedExecutable(
  windowsPath: string,
  signal: AbortSignal,
  run: NativeCommandRunner,
): Promise<string | null> {
  let stdout: string
  try {
    ({ stdout } = await run('wslpath', ['-u', windowsPath], signal, 'hidden'))
  } catch {
    // Swallows the translation failure: a host that cannot name a mount point
    // for the Windows system directory has no fallback executable to offer.
    return null
  }
  const mounted = stdout.replace(/[\r\n]+$/, '')
  return mounted === '' ? null : mounted
}

/**
 * Run one Windows interop command, resolving it inside the mounted Windows
 * system directory when PATH does not name it.
 * @param name - PATH name of the executable (`explorer.exe`).
 * @param relative - path under the Windows directory (`System32\\...`).
 * @param args - argv (never a shell string).
 * @param signal - caller lifetime; abort terminates the command.
 * @param run - shell-free command runner.
 * @param window - Windows startup visibility.
 * @param env - environment naming the Windows installation; omitted reads the process environment.
 * @returns captured stdout/stderr on exit 0.
 * @throws The runner's failure: the original one when no mounted executable
 * replaces it, otherwise the fallback command's own failure.
 */
export async function runWindowsInterop(
  name: string,
  relative: string,
  args: readonly string[],
  signal: AbortSignal,
  run: NativeCommandRunner,
  window: 'hidden' | 'visible',
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await run(name, args, signal, window)
  } catch (error: unknown) {
    signal.throwIfAborted()
    if (!isMissingExecutable(error)) throw error
    const executable = await mountedExecutable(
      `${windowsSystemDirectory(env)}\\${relative}`, signal, run,
    )
    if (executable === null) throw error
    return await run(executable, args, signal, window)
  }
}
