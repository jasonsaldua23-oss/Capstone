import assert from 'node:assert/strict'
import test from 'node:test'
import { createLatestLocationUploader, LocationUploadRejected } from './driver-location-upload.ts'

test('slow uploads coalesce intermediate fixes and preserve send order', async () => {
  const sent: number[] = []
  let finishFirst!: () => void
  let finishSecond!: () => void
  const second = new Promise<void>((resolve) => { finishSecond = resolve })
  const uploader = createLatestLocationUploader<number>(async (value) => {
    sent.push(value)
    if (value === 1) await new Promise<void>((resolve) => { finishFirst = resolve })
    else finishSecond()
  })
  uploader.enqueue(1); uploader.enqueue(2); uploader.enqueue(3)
  assert.deepEqual(sent, [1])
  finishFirst()
  await second
  assert.deepEqual(sent, [1, 3])
  uploader.clear()
})

test('an offline upload retries automatically and stops on logout', async () => {
  let count = 0
  let complete!: () => void
  const recovered = new Promise<void>((resolve) => { complete = resolve })
  const uploader = createLatestLocationUploader(async () => {
    if (++count === 1) throw new Error('offline')
    complete()
  }, 1)
  uploader.enqueue('latest GPS')
  await recovered
  uploader.clear()
  uploader.enqueue('after logout')
  assert.equal(count, 2)
})

test('stop aborts a pending network request and validation failures do not retry forever', async () => {
  let signal!: AbortSignal
  const uploader = createLatestLocationUploader(async (_value: number, requestSignal) => {
    signal = requestSignal
    throw new LocationUploadRejected('invalid sample')
  })
  uploader.enqueue(1)
  await Promise.resolve()
  uploader.resume()
  uploader.clear()
  assert.equal(signal.aborted, true)
})
