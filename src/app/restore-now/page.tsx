import { notFound } from 'next/navigation'

// Fix: development recovery must never execute filesystem writes during rendering.
export default function RestoreNowPage() {
  notFound()
}
