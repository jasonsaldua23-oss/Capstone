'use server'

// Fix: preserve the action contract without exposing local recovery to remote callers.
export async function findFileInLogs() {
  return { success: false, error: 'Recovery is available only through local operator tooling.' }
}
