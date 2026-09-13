import { NextResponse } from 'next/server'

// Fix: repository scanning belongs to local operator tooling, never a public GET.
export async function GET() {
  return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
}
