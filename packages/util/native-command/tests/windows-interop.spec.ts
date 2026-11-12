/**
 * Windows interop command resolution over a deterministic runner: the PATH
 * name first, and the mounted Windows executable when PATH does not name it.
 */
import { describe, expect, it, vi } from 'vitest'
import { runWindowsInterop, windowsSystemDirectory } from '../src/windows-interop.ts'

/** Failure a runner reports for a command the host cannot find. */
function missing(): Error & { code: string } {
  return Object.assign(new Error('spawn explorer.exe ENOENT'), { code: 'ENOENT' })
}

/** Runner that records every command and answers from a per-command table. */
function recordingRunner(answer: (command: string) => { stdout: string; stderr: string }): ReturnType<typeof vi.fn> {
  return vi.fn(async (command: string) => answer(command))
}

describe('runWindowsInterop', () => {
  it('runs the PATH name and never translates when it resolves', async () => {
    const run = recordingRunner(command => ({ stdout: `ran ${command}`, stderr: '' }))
    const result = await runWindowsInterop(
      'explorer.exe', 'explorer.exe', ['/select,x'], new AbortController().signal, run, 'visible', {},
    )
    expect(result.stdout).toBe('ran explorer.exe')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('falls back to the mounted Windows executable when PATH does not name it', async () => {
    const run = recordingRunner((command) => {
      if (command === 'wslpath') return { stdout: '/mnt/c/Windows/explorer.exe\n', stderr: '' }
      if (command === 'explorer.exe') throw missing()
      return { stdout: `ran ${command}`, stderr: '' }
    })
    const result = await runWindowsInterop(
      'explorer.exe', 'explorer.exe', ['/select,x'], new AbortController().signal, run, 'visible', {},
    )
    expect(result.stdout).toBe('ran /mnt/c/Windows/explorer.exe')
    expect(run).toHaveBeenNthCalledWith(
      2, 'wslpath', ['-u', 'C:\\Windows\\explorer.exe'], expect.anything(), 'hidden',
    )
  })

  it('rethrows the original failure when the Windows drive is not mounted', async () => {
    const run = recordingRunner((command) => {
      if (command === 'wslpath') throw new Error('wslpath: invalid argument')
      throw missing()
    })
    await expect(runWindowsInterop(
      'explorer.exe', 'explorer.exe', [], new AbortController().signal, run, 'visible', {},
    )).rejects.toThrow(/ENOENT/)
  })

  it('rethrows the original failure when wslpath answers no path', async () => {
    const run = recordingRunner((command) => {
      if (command === 'wslpath') return { stdout: '\n', stderr: '' }
      throw missing()
    })
    await expect(runWindowsInterop(
      'explorer.exe', 'explorer.exe', [], new AbortController().signal, run, 'visible', {},
    )).rejects.toThrow(/ENOENT/)
  })

  it('propagates a non-missing failure without translating', async () => {
    const run = recordingRunner(() => {
      throw Object.assign(new Error('explorer exited with code 2'), { code: 2 })
    })
    await expect(runWindowsInterop(
      'explorer.exe', 'explorer.exe', [], new AbortController().signal, run, 'visible', {},
    )).rejects.toThrow(/code 2/)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('reports cancellation rather than the missing executable', async () => {
    const controller = new AbortController()
    const run = recordingRunner(() => {
      controller.abort()
      throw missing()
    })
    await expect(runWindowsInterop(
      'explorer.exe', 'explorer.exe', [], controller.signal, run, 'visible', {},
    )).rejects.toThrow(/abort/i)
  })
})

describe('windowsSystemDirectory', () => {
  it('prefers SystemRoot, then WINDIR, then the conventional location', () => {
    expect(windowsSystemDirectory({ SystemRoot: 'D:\\Win' })).toBe('D:\\Win')
    expect(windowsSystemDirectory({ WINDIR: 'E:\\Windows' })).toBe('E:\\Windows')
    expect(windowsSystemDirectory({})).toBe('C:\\Windows')
  })

  it('drops a trailing separator and ignores an empty value', () => {
    expect(windowsSystemDirectory({ SystemRoot: 'D:\\Win\\' })).toBe('D:\\Win')
    expect(windowsSystemDirectory({ SystemRoot: '' })).toBe('C:\\Windows')
  })
})

describe('runWindowsInterop with a configured Windows directory', () => {
  it('translates the path under the configured installation', async () => {
    const run = recordingRunner((command) => {
      if (command === 'wslpath') return { stdout: '/d/Win/explorer.exe\n', stderr: '' }
      if (command === 'explorer.exe') throw missing()
      return { stdout: `ran ${command}`, stderr: '' }
    })
    await runWindowsInterop(
      'explorer.exe', 'explorer.exe', [], new AbortController().signal, run, 'visible', { SystemRoot: 'D:\\Win' },
    )
    expect(run).toHaveBeenNthCalledWith(
      2, 'wslpath', ['-u', 'D:\\Win\\explorer.exe'], expect.anything(), 'hidden',
    )
  })

  it('reports the fallback command failure rather than the missing PATH name', async () => {
    const run = recordingRunner((command) => {
      if (command === 'wslpath') return { stdout: '/mnt/c/Windows/explorer.exe\n', stderr: '' }
      if (command === 'explorer.exe') throw missing()
      throw Object.assign(new Error('mounted executable exited with code 3'), { code: 3 })
    })
    await expect(runWindowsInterop(
      'explorer.exe', 'explorer.exe', [], new AbortController().signal, run, 'visible', {},
    )).rejects.toThrow(/code 3/)
  })
})
